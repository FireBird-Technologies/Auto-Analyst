import io
import logging
import re
import json
from fastapi import APIRouter, Depends, HTTPException, Request
from typing import Dict, Optional, List, Tuple
from pydantic import BaseModel

from scripts.format_response import execute_code_from_markdown, format_code_block
from src.utils.logger import Logger
from src.routes.session_routes import get_session_id_dependency
from src.agents.agents import code_edit, code_fix
from src.db.schemas.models import CodeExecution
from src.db.init_db import get_session
import dspy
import textwrap
import os
from src.schemas.code_schema import CodeExecuteRequest, CodeEditRequest, CodeFixRequest, CodeCleanRequest, GetLatestCodeRequest
from src.utils.model_registry import MODEL_OBJECTS
import asyncio
import traceback

def clean_print_statements(code_block):
    """
    This function cleans up any `print()` statements that might contain unwanted `\n` characters.
    It ensures print statements are properly formatted without unnecessary newlines.
    """
    # This regex targets print statements, even if they have newlines inside
    return re.sub(r'print\((.*?)(\\n.*?)(.*?)\)', r'print(\1\3)', code_block, flags=re.DOTALL)


def remove_main_block(code):
    # Match the __main__ block
    pattern = r'(?m)^if\s+__name__\s*==\s*["\']__main__["\']\s*:\s*\n((?:\s+.*\n?)*)'
    
    match = re.search(pattern, code)
    if match:
        main_block = match.group(1)
        
        # Dedent the code block inside __main__
        dedented_block = textwrap.dedent(main_block)
        
        # Remove \n from any print statements in the block (also handling multiline print cases)
        dedented_block = clean_print_statements(dedented_block)
        # Replace the block in the code
        cleaned_code = re.sub(pattern, dedented_block, code)
        
        # Optional: Remove leading newlines if any
        cleaned_code = cleaned_code.strip()
        
        return cleaned_code
    return code

# Initialize router
router = APIRouter(
    prefix="/code",
    tags=["code"],
    responses={404: {"description": "Not found"}},
)

# Initialize logger
logger = Logger("code_routes", see_time=True, console_log=False)
try_logger = Logger("try_code_routes", see_time=True, console_log=False)


def score_code(args, code, datasets=None):
    """
    Simple code scorer that checks if code runs successfully.
    Handles both deep analysis (combined_code) and fix (fixed_code) scenarios.
    
    Args:
        args: Arguments (unused but required for dspy.Refine)
        code: Code object with combined_code, fixed_code, or string content
        datasets: Dictionary of datasets from session state (optional)
    
    Returns:
        int: Score (0=error, 1=success)
    """
    try:
        # Handle different attribute names based on context
        if hasattr(code, 'combined_code'):
            code_to_execute = code.combined_code  # Deep analysis
        elif hasattr(code, 'fixed_code'):
            code_to_execute = code.fixed_code     # Code fix
        else:
            code_to_execute = str(code)           # Fallback to string
        
        # Make datasets available if provided
        local_vars = {}
        if datasets:
            local_vars.update(datasets)
            
        # Execute the code to test if it works
        exec(code_to_execute, local_vars)
        return 1  # Success
    except Exception as e:
        return 0  # Error
   

# Remove the global refine_fixer declaration


def format_code(code: str) -> str:
    """
    Clean the code by organizing imports and ensuring code blocks are properly formatted.
    
    Args:
        code (str): The raw Python code as a string.
        
    Returns:
        str: The cleaned code.
    """
    # Move imports to top
    code = move_imports_to_top(code)
    
    # Split code into blocks if they exist (based on comments like '# agent_name code start')
    code_blocks = []
    current_block = []
    current_agent = None
    
    for line in code.splitlines():
        if re.search(r'#\s+\w+\s+code\s+start', line.lower()):
            if current_agent and current_block:
                code_blocks.append((current_agent, '\n'.join(current_block)))
                current_block = []
            current_agent = re.search(r'#\s+(\w+)\s+code\s+start', line.lower()).group(1)
            current_block.append(line)
        elif re.search(r'#\s+\w+\s+code\s+end', line.lower()):
            if current_block:
                current_block.append(line)
                code_blocks.append((current_agent, '\n'.join(current_block)))
                current_agent = None
                current_block = []
        else:
            current_block.append(line)
    
    # If there's remaining code not in a block
    if current_block:
        if current_agent:
            code_blocks.append((current_agent, '\n'.join(current_block)))
        else:
            code_blocks.append(('main', '\n'.join(current_block)))
    
    # If no blocks were identified, return the original cleaned code
    if not code_blocks:
        return code
    # Reconstruct the code with the identified blocks
    return '\n\n'.join([block[1] for block in code_blocks])

def extract_code_blocks(code: str) -> Dict[str, str]:
    """
    Extract code blocks from the code based on agent name comments.
    
    Args:
        code (str): The code containing multiple blocks
        
    Returns:
        Dict[str, str]: Dictionary mapping agent names to their code blocks
    """
    # Find code blocks with start and end markers
    block_pattern = r'(#\s+(\w+)\s+code\s+start[\s\S]*?#\s+\w+\s+code\s+end)'
    blocks_with_markers = re.findall(block_pattern, code, re.DOTALL)
    
    if not blocks_with_markers:
        # If no blocks found, treat the entire code as one block
        return {'main': code}
    
    result = {}
    for full_block, agent_name in blocks_with_markers:
        result[agent_name.lower()] = full_block.strip()
    
    return result

def identify_error_blocks(code: str, error_output: str) -> List[Tuple[str, str, str]]:
    """
    Identify code blocks that have errors during execution.
    
    Args:
        code (str): The full code containing multiple agent blocks
        error_output (str): The error output from execution
        
    Returns:
        List[Tuple[str, str, str]]: List of tuples containing (agent_name, block_code, error_message)
    """
    # Parse the error output to find which agents had errors
    faulty_blocks = []
    
    # Find error patterns like "=== ERROR IN AGENT_NAME ===" or "=== ERROR IN UNKNOWN_AGENT ==="
    error_matches = []
    for match in re.finditer(
        r'^===\s+ERROR\s+IN\s+([A-Za-z0-9_]+)\s+===\s*([\s\S]*?)(?=^===\s+[A-Z]+\s+IN\s+[A-Za-z0-9_]+\s+===|\Z)',
        error_output,
        re.MULTILINE
    ):
        error_matches.append((match.group(1), match.group(2)))
    
    if not error_matches:
        return []
    
    # Find all code blocks in the given code
    blocks = {}
    for agent_match in re.finditer(r'#\s+(\w+)\s+code\s+start([\s\S]*?)#\s+\w+\s+code\s+end', code, re.DOTALL):
        agent_name = agent_match.group(1).lower()
        full_block = agent_match.group(0)
        blocks[agent_name] = full_block
    
    # Match errors with their corresponding code blocks
    matched_blocks = set()
    for agent_name, error_message in error_matches:
        # Format from error output is AGENT_NAME_AGENT, we need to extract the base name
        # Remove '_AGENT' suffix if present and convert to lowercase
        normalized_name = agent_name.lower()
        if normalized_name.endswith('_agent'):
            normalized_name = normalized_name[:-6]  # Remove '_agent' suffix
        
        # Try direct match first
        if normalized_name in blocks:
            # Extract the relevant error information
            processed_error = extract_relevant_error_section(error_message)
            faulty_blocks.append((normalized_name, blocks[normalized_name], processed_error))
            matched_blocks.add(normalized_name)
        else:
            # Try fuzzy matching for agent names
            for block_name, block_code in blocks.items():
                if block_name not in matched_blocks and (normalized_name in block_name or block_name in normalized_name):
                    # Extract the relevant error information
                    processed_error = extract_relevant_error_section(error_message)
                    faulty_blocks.append((block_name, block_code, processed_error))
                    matched_blocks.add(block_name)
                    break
    
    # logger.log_message(f"Faulty blocks found: {len(faulty_blocks)}", level=logging.INFO)
    # logger.log_message(f"Faulty blocks: {faulty_blocks}", level=logging.INFO)
    return faulty_blocks

def extract_relevant_error_section(error_message: str) -> str:
    """
    Extract the most relevant parts of the error message to help with fixing.
    
    Args:
        error_message (str): The full error message
        
    Returns:
        str: The processed error message with the most relevant information
    """
    error_lines = error_message.strip().split('\n')
    
    # If "Problem at this location" is in the error, focus on that section
    if 'Problem at this location:' in error_message:
        problem_idx = -1
        for i, line in enumerate(error_lines):
            if 'Problem at this location:' in line:
                problem_idx = i
                break
        
        if problem_idx >= 0:
            # Include the "Problem at this location" section and a few lines after
            end_idx = min(problem_idx + 10, len(error_lines))
            problem_section = error_lines[problem_idx:end_idx]
            
            # Also include the error type from the end
            error_type_lines = []
            for line in reversed(error_lines):
                if line.startswith('TypeError:') or line.startswith('ValueError:') or line.startswith('AttributeError:'):
                    error_type_lines = [line]
                    break
            
            return '\n'.join(problem_section + error_type_lines)
    
    # If we couldn't find "Problem at this location", include first few and last few lines
    if len(error_lines) > 10:
        return '\n'.join(error_lines[:5] + error_lines[-7:])
    
    # If the error is short enough, return as is
    return error_message

async def fix_code_with_dspy(code: str, error: str, dataset_context: str = "", datasets: dict = None):
    """
    Fix code using DSPy Refine with datasets-aware reward function
    """
    try:
        # Wrap score_code to fix datasets argument
        reward_fn_with_datasets = lambda args, pred: score_code(args, pred, datasets=datasets)

        refine_fixer = dspy.Refine(
            module=dspy.Predict(code_fix),
            N=3,
            threshold=1.0,
            reward_fn=reward_fn_with_datasets,
            fail_count=3
        )
        
        # Check if we have valid API key
        anthropic_key = os.environ.get('ANTHROPIC_API_KEY')
        if not anthropic_key:
            raise ValueError("ANTHROPIC_API_KEY environment variable is not set")
        
        # Fix the entire code using refine
        try:
            # Create the LM instance that will be used
            thread_lm = MODEL_OBJECTS['claude-sonnet-4-5-20250929']
            
            # Define the blocking function to run in thread
            def run_refine_fixer():
                with dspy.context(lm=thread_lm):
                    return refine_fixer(
                        dataset_context=str(dataset_context) or "",
                        faulty_code=str(code) or "",
                        error=str(error) or "",
                    )
            
            # Use asyncio.to_thread for better async integration with timeout
            result = await asyncio.wait_for(
                asyncio.to_thread(run_refine_fixer), 
                timeout=60.0  # 60 second timeout
            )
            
            if not hasattr(result, 'fixed_code'):
                raise ValueError("DSPy Refine did not return a result with 'fixed_code' attribute")
            
            return result.fixed_code
            
        except Exception as e:
            logger.log_message(f"🔧 DETAILED ERROR in fix_code_with_dspy: {str(e)}", level=logging.ERROR)
            logger.log_message(f"�� ERROR TYPE: {type(e).__name__}", level=logging.ERROR)
            logger.log_message(f"�� ERROR TRACEBACK: {traceback.format_exc()}", level=logging.ERROR)
            
            # Instead of returning original code, raise the error so we can see what's wrong
            raise HTTPException(status_code=500, detail=f"Fix failed: {str(e)}")
            
    except Exception as e:
        logger.log_message(f"Error in fix_code_with_dspy: {str(e)}", level=logging.ERROR)
        raise RuntimeError(f"Fix code setup failed: {str(e)}") from e

def get_dataset_context(df):
    """
    Generate context information about the dataset
    
    Args:
        df: The pandas dataframe
         
    Returns:
        String with dataset information (columns, types, null values)
    """
    if df is None:
        return "No dataset is currently loaded."
    
    try:
        # Get basic dataframe info
        col_types = df.dtypes.to_dict()
        null_counts = df.isnull().sum().to_dict()
        
        # Format the context string
        context = "Dataset context:\n"
        context += f"- Shape: {df.shape[0]} rows, {df.shape[1]} columns\n"
        context += "- Columns and types:\n"
        
        for col, dtype in col_types.items():
            null_count = null_counts.get(col, 0)
            null_percent = (null_count / len(df)) * 100 if len(df) > 0 else 0
            context += f"  * {col} ({dtype}): {null_count} null values\n"
        
        # Add sample values for each column (first 2 non-null values)
        context += "- Sample values:\n"
        for col in df.columns:
            sample_values = df[col].dropna().head(2).tolist()
            # if float, round to 2 decimal places
            if df[col].dtype == "float64":
                sample_values = [round(v, 1) for v in sample_values]
            sample_str = ", ".join(str(v) for v in sample_values)
            context += f"  * {col}: {sample_str}\n"
        return context
    except Exception as e:
        return "Could not generate dataset context information."

def edit_code_with_dspy(original_code: str, user_prompt: str, dataset_context: str = ""):
    thread_lm = MODEL_OBJECTS['claude-sonnet-4-5-20250929']
    with dspy.context(lm=thread_lm):
        code_editor = dspy.Predict(code_edit)
        
        result = code_editor(
            dataset_context=dataset_context,
            original_code=original_code,
            user_prompt=user_prompt,
        )
        return result.edited_code

def move_imports_to_top(code: str) -> str:
    """
    Moves all import statements to the top of the Python code.

    Args:
        code (str): The raw Python code as a string.

    Returns:
        str: The cleaned code with import statements at the top.
    """
    # Extract import statements
    import_statements = re.findall(
        r'^\s*(import\s+[^\n]+|from\s+[^\n]+import\s+[^\n]+)', code, flags=re.MULTILINE
    )
    
    # Remove import statements from original code
    code_without_imports = re.sub(
        r'^\s*(import\s+[^\n]+|from\s+[^\n]+import\s+[^\n]+)\n?', '', code, flags=re.MULTILINE
    )
    
    # Deduplicate and sort imports
    sorted_imports = sorted(set(import_statements))
    
    # Combine cleaned imports and remaining code
    cleaned_code = '\n'.join(sorted_imports) + '\n\n' + code_without_imports.strip()
    
    return cleaned_code


@router.post("/execute")
async def execute_code(
    request_data: CodeExecuteRequest,
    request: Request,
    session_id: str = Depends(get_session_id_dependency)
):
    """
    Execute code provided in the request against the session's dataframe
    
    Args:
        request_data: Body containing code to execute
        request: FastAPI Request object
        session_id: Session identifier
        
    Returns:
        Dictionary containing execution output and any plot outputs
    """
    # Access app state via request
    app_state = request.app.state
    session_state = app_state.get_session_state(session_id)
    # logger.log_message(f"Session State: {session_state}", level=logging.INFO)
    
    if session_state["datasets"] is None:
        raise HTTPException(
            status_code=400,
            detail="No dataset is currently loaded. Please link a dataset before executing code."
        )
        
    try:
        code = request_data.code
        if not code:
            raise HTTPException(status_code=400, detail="No code provided")
            
        # Get the user_id and chat_id from session state if available
        user_id = session_state.get("user_id")
        chat_id = session_state.get("chat_id")
        message_id = request_data.message_id
        
        # If message_id was not provided in the request, try to get it from the session state
        if message_id is None:
            message_id = session_state.get("current_message_id")
        else:
            # Update the session state with the provided message_id
            session_state["current_message_id"] = message_id
        
        # Get model configuration
        model_config = session_state.get("model_config", {})
        model_provider = model_config.get("provider", "")
        model_name = model_config.get("model", "")
        model_temperature = model_config.get("temperature", 0.0)
        model_max_tokens = model_config.get("max_tokens", 0)
        
        # Get database session
        db = get_session()
        
        # Check if we have an existing execution record for this message
        existing_execution = None
        if message_id:
            try:
                existing_execution = db.query(CodeExecution).filter(
                    CodeExecution.message_id == message_id
                ).first()
                
            except Exception as query_error:
                logger.log_message(f"Error querying for existing execution: {str(query_error)}", level=logging.ERROR)
                # Continue without existing execution
        else:
            logger.log_message("No message_id provided in session state", level=logging.WARNING)
            
        # Execute the code with the dataframe from session state
        full_output = ""
        json_outputs = []
        matplotlib_outputs = []
        is_successful = True
        failed_agents = None
        error_messages = None
        
        try:
            full_output, json_outputs, matplotlib_outputs = execute_code_from_markdown(code, session_state["datasets"])
            
            # Even with "successful" execution, check for agent failures in the output
            failed_blocks = identify_error_blocks(code, full_output)
            
            if failed_blocks:
                # We have some failed agents even though no exception was thrown
                is_successful = False  # Mark as failed if any agent failed
                failed_agents = json.dumps([block[0] for block in failed_blocks])
                error_messages = json.dumps({
                    block[0]: block[2] for block in failed_blocks
                })
                logger.log_message(f"Partial execution failure. Failed agents: {failed_agents}", level=logging.WARNING)
            
        except Exception as exec_error:
            full_output = str(exec_error)
            json_outputs = []
            matplotlib_outputs = []
            is_successful = False
            
            # Identify which agents failed
            failed_blocks = identify_error_blocks(code, full_output)
            
            # Format the failed agents and error messages
            if failed_blocks:
                failed_agents = json.dumps([block[0] for block in failed_blocks])
                error_messages = json.dumps({
                    block[0]: block[2] for block in failed_blocks
                })
                logger.log_message(f"Execution threw exception. Failed agents: {failed_agents}", level=logging.ERROR)
            
            # Don't re-raise the error - we want to capture the error and send it back to the client
            # return error details in the response instead
        
        # Create or update the execution record regardless of success/failure
        try:
            if existing_execution:
                # Update existing record
                existing_execution.latest_code = code
                existing_execution.is_successful = is_successful
                existing_execution.output = full_output
                
                if not is_successful:
                    existing_execution.failed_agents = failed_agents
                    existing_execution.error_messages = error_messages
                    
                db.commit()
            else:
                # Create new record
                logger.log_message(f"Creating new CodeExecution record for message_id: {message_id}", level=logging.INFO)
                new_execution = CodeExecution(
                    message_id=message_id,
                    chat_id=chat_id,
                    user_id=user_id,
                    initial_code=code,
                    latest_code=code,
                    is_successful=is_successful,
                    output=full_output,
                    model_provider=model_provider,
                    model_name=model_name,
                    model_temperature=model_temperature,
                    model_max_tokens=model_max_tokens,
                    failed_agents=failed_agents,
                    error_messages=error_messages
                )
                db.add(new_execution)
                db.commit()
                logger.log_message(f"Successfully created CodeExecution record with ID: {new_execution.execution_id} for message_id: {message_id}", level=logging.INFO)
        except Exception as db_error:
            db.rollback()
            logger.log_message(f"Error saving code execution: {str(db_error)}", level=logging.ERROR)
        finally:
            db.close()
        
        # Format plotly outputs for frontend
        plotly_outputs = [f"```plotly\n{json_output}\n```\n" for json_output in json_outputs]
        
        # Format matplotlib outputs for frontend
        matplotlib_chart_outputs = [f"```matplotlib\n{img_base64}\n```\n" for img_base64 in matplotlib_outputs]
        
        # Include execution status in the response
        return {
            "output": full_output,
            "plotly_outputs": plotly_outputs if json_outputs else None,
            "matplotlib_outputs": matplotlib_chart_outputs if matplotlib_outputs else None,
            "is_successful": is_successful,
            "failed_agents": failed_agents
        }
    except Exception as e:
        logger.log_message(f"Error executing code: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/edit")
async def edit_code(
    request_data: CodeEditRequest,
    request: Request,
    session_id: str = Depends(get_session_id_dependency)
):
    """
    Edit code provided in the request using AI
    
    Args:
        request_data: Body containing original code and user prompt
        request: FastAPI Request object
        session_id: Session identifier
        
    Returns:
        Dictionary containing the edited code
    """
    try:
        # Check if code and prompt are provided
        if not request_data.original_code or not request_data.user_prompt:
            raise HTTPException(status_code=400, detail="Both original code and editing instructions are required")
            
        # Access app state via request
        app_state = request.app.state
        session_state = app_state.get_session_state(session_id)
        
        # Get dataset context
        dataset_context = get_dataset_context(session_state["datasets"])
        try:
            # Use the configured language model with dataset context
            edited_code = edit_code_with_dspy(
                request_data.original_code, 
                request_data.user_prompt,
                dataset_context
            )
            edited_code = format_code_block(edited_code)
            return {
                "edited_code": edited_code,
            }
        except Exception as e:
            # Fallback if DSPy models are not initialized or there's an error
            logger.log_message(f"Error with DSPy models: {str(e)}", level=logging.ERROR)
            
            # Return a helpful error message that doesn't expose implementation details
            return {
                "edited_code": request_data.original_code,
                "error": "Could not process edit request. Please try again later."
            }
    except Exception as e:
        logger.log_message(f"Error editing code: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/fix")
async def fix_code(
    request_data: CodeFixRequest,
    request: Request,
    session_id: str = Depends(get_session_id_dependency)
):
    """
    Fix code with errors using block-by-block approach
    
    Args:
        request_data: Body containing code and error message
        request: FastAPI Request object
        session_id: Session identifier
        
    Returns:
        Dictionary containing the fixed code and information about fixed blocks
    """
    try:
        # Add debugging at the start
        logger.log_message(f"🔧 /fix endpoint called with session_id: {session_id}", level=logging.INFO)
        logger.log_message(f"🔧 Code length: {len(request_data.code) if request_data.code else 0}", level=logging.INFO)
        logger.log_message(f"🔧 Error length: {len(request_data.error) if request_data.error else 0}", level=logging.INFO)
        
        # Check if code and error are provided
        if not request_data.code or not request_data.error:
            logger.log_message(f"Error fixing code: Both code and error message are required {request_data.code} {request_data.error}", level=logging.ERROR)
            raise HTTPException(status_code=400, detail="Both code and error message are required")
            
        # Access app state via request
        app_state = request.app.state
        session_state = app_state.get_session_state(session_id)
        
        logger.log_message(f"🔧 Session state keys: {list(session_state.keys()) if session_state else 'None'}", level=logging.INFO)
        
        # Get the user_id from session state if available (for logging/tracking)
        user_id = session_state.get("user_id")
        logger.log_message(f"Code fix request from user_id: {user_id}, session_id: {session_id}", level=logging.INFO)
        
        # Get dataset context
        logger.log_message(f"🔧 Getting dataset context...", level=logging.INFO)
        dataset_context = get_dataset_context(session_state["datasets"])
        logger.log_message(f"🔧 Dataset context length: {len(dataset_context)}", level=logging.INFO)
        
        try:
            logger.log_message(f"🔧 Calling fix_code_with_dspy...", level=logging.INFO)
            # Use the code_fix agent to fix the code, with dataset context
            fixed_code = await fix_code_with_dspy(
                request_data.code, 
                request_data.error,
                dataset_context,
                session_state["datasets"]  # Pass the actual datasets
            )
            
            logger.log_message(f"🔧 fix_code_with_dspy returned, formatting...", level=logging.INFO)
            fixed_code = format_code_block(fixed_code)
            
            logger.log_message(f"Code fix completed successfully for user_id: {user_id}", level=logging.INFO)
            logger.log_message(f"🔧 Fixed code length: {len(fixed_code)}", level=logging.INFO)
                
            return {
                "fixed_code": fixed_code,
            }
        except Exception as e:
            logger.log_message(f"🔧 Error in fix_code_with_dspy: {str(e)}", level=logging.ERROR)
            # Fallback if DSPy models are not initialized or there's an error
            logger.log_message(f"Error with DSPy models for user_id {user_id}: {str(e)}", level=logging.ERROR)
            
            # Return the actual error details instead of generic message
            error_message = str(e)
            
            # Sanitize sensitive information but keep useful details
            if "API key" in error_message.lower():
                error_message = "API configuration error. Please contact support."
            elif "timeout" in error_message.lower():
                error_message = "Request timed out. Please try again."
            elif "rate limit" in error_message.lower():
                error_message = "Rate limit exceeded. Please wait a moment and try again."
            elif len(error_message) > 200:
                # Truncate very long error messages
                error_message = error_message[:200] + "..."
            
            return {
                "fixed_code": request_data.code,
                "error": error_message  # Return actual error instead of generic message
            }
    except Exception as e:
        logger.log_message(f"Error fixing code: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=500, detail=str(e))
    
    
@router.post("/clean-code")
async def clean_code(
    request_data: CodeCleanRequest,
    request: Request,
    session_id: str = Depends(get_session_id_dependency)
):
    """
    Clean code provided in the request
    
    Args:
        request_data: Body containing code to clean
        request: FastAPI Request object
        session_id: Session identifier
        
    Returns:
        Dictionary containing the cleaned code
    """
    try:
        # Check if code is provided
        if not request_data.code:
            raise HTTPException(status_code=400, detail="Code is required")

        # Clean the code using the format_code function
        cleaned = format_code(request_data.code)
        
        return {
            "cleaned_code": cleaned,
        }
    except Exception as e:
        logger.log_message(f"Error cleaning code: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/get-latest-code")
async def get_latest_code(
    request_data: GetLatestCodeRequest,
    request: Request,
    session_id: str = Depends(get_session_id_dependency)
):
    """
    Retrieve the latest code for a specific message_id
    
    Args:
        request_data: Body containing message_id
        request: FastAPI Request object
        session_id: Session identifier
        
    Returns:
        Dictionary containing the latest code and execution status
    """
    try:
        message_id = request_data.message_id
        
        if not message_id:
            raise HTTPException(status_code=400, detail="Message ID is required")
            
        # Get database session
        db = get_session()
        
        try:
            # Query the database for the latest code execution record (ordered by created_at desc)
            logger.log_message(f"Searching for execution records with message_id: {message_id}", level=logging.INFO)
            
            execution_record = db.query(CodeExecution).filter(
                CodeExecution.message_id == message_id
            ).order_by(CodeExecution.created_at.desc()).first()
            
            # Also log total count of records for this message_id
            total_records = db.query(CodeExecution).filter(
                CodeExecution.message_id == message_id
            ).count()
            logger.log_message(f"Found {total_records} execution records for message_id: {message_id}", level=logging.INFO)
            
            if execution_record:
                logger.log_message(f"Latest execution record found - success: {execution_record.is_successful}, latest_code length: {len(execution_record.latest_code or '') if execution_record.latest_code else 0}", level=logging.INFO)

                # Return the latest code and execution status
                return {
                    "found": True,
                    "message_id": message_id,
                    "latest_code": execution_record.latest_code,
                    "initial_code": execution_record.initial_code,
                    "is_successful": execution_record.is_successful,
                    "failed_agents": execution_record.failed_agents
                }
            else:
                logger.log_message(f"No execution record found for message_id: {message_id}", level=logging.INFO)
                return {
                    "found": False,
                    "message_id": message_id
                }
                
        except Exception as db_error:
            logger.log_message(f"Database error retrieving latest code: {str(db_error)}", level=logging.ERROR)
            raise HTTPException(status_code=500, detail=f"Database error: {str(db_error)}")
        finally:
            db.close()
            
    except Exception as e:
        logger.log_message(f"Error retrieving latest code: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=500, detail=str(e))