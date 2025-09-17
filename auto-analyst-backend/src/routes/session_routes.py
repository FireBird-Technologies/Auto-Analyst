import io
import logging
import json
import re
import os
from io import StringIO
from typing import Optional, List, Dict
import random
import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.security import APIKeyHeader

import numpy as np
from src.managers.session_manager import get_session_id
from src.schemas.model_settings_schema import ModelSettings
from src.utils.logger import Logger
from pydantic import BaseModel
from fastapi.responses import JSONResponse
# data context is for excelsheets with multiple sheets and dataset_descrp is for single sheet or csv
from src.agents.agents import data_context_gen, dataset_description_agent
from src.utils.model_registry import MODEL_OBJECTS, mid_lm
from src.utils.dataset_description_generator import generate_dataset_description
import dspy
import re
# from fastapi.responses import JSONResponse

logger = Logger("session_routes", see_time=False, console_log=False)

# Add session header for dependency
X_SESSION_ID = APIKeyHeader(name="X-Session-ID", auto_error=False)

router = APIRouter(tags=["session"])

# Dependency to get app state
def get_app_state(request: Request):
    return request.app.state

# Update session dependency for FastAPI
async def get_session_id_dependency(request: Request):
    """Dependency to get session ID, wrapped for FastAPI"""
    app_state = get_app_state(request)
    return await get_session_id(request, app_state._session_manager)

# Define a model for message tracking
class MessageInfo(BaseModel):
    chat_id: Optional[int] = None
    message_id: Optional[int] = None
    user_id: Optional[int] = None

# Define a model for reset session request
class ResetSessionRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    preserveModelSettings: Optional[bool] = False

# Define a response model for Excel sheets
class ExcelSheetsResponse(BaseModel):
    sheets: List[str]

@router.post("/api/excel-sheets")
async def get_excel_sheets(
    file: UploadFile = File(...),
    app_state = Depends(get_app_state),
    session_id: str = Depends(get_session_id_dependency)
):
    """Get the list of sheet names from an Excel file"""
    try:
        # Read the uploaded Excel file
        contents = await file.read()
        
        # Load Excel file using pandas
        excel_file = pd.ExcelFile(io.BytesIO(contents))
        
        # Get sheet names
        sheet_names = excel_file.sheet_names
        
        # Log the sheets found
        # logger.log_message(f"Found {len(sheet_names)} sheets in Excel file: {', '.join(sheet_names)}", level=logging.INFO)
        
        # Return the sheet names
        return {"sheets": sheet_names}
    except Exception as e:
        logger.log_message(f"Error getting Excel sheets: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=400, detail=f"Error reading Excel file: {str(e)}")




@router.post("/upload_excel")
async def upload_excel(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(...),
    selected_sheets: Optional[str] = Form(None),  # JSON array of strings
    fill_nulls: bool = Form(True),  # NEW: Fill null values
    convert_types: bool = Form(True),  # NEW: Convert data types
    app_state = Depends(get_app_state),
    session_id: str = Depends(get_session_id_dependency),
    request: Request = None
):
    """Upload and process an Excel file with a specific sheet"""
    try:
        logger.log_message(f"Excel upload: fill_nulls={fill_nulls}, convert_types={convert_types}", level=logging.INFO)
        
        # Log the incoming request details
        # logger.log_message(f"Excel upload request for session {session_id}: name='{name}', description='{description}', sheet='{sheet_name}'", level=logging.INFO)
        
        # Check if we need to force a complete session reset before upload
        force_refresh = request.headers.get("X-Force-Refresh") == "true" if request else False
        
        if force_refresh:
            # logger.log_message(f"Force refresh requested for session {session_id} before Excel upload", level=logging.INFO)
            # Reset the session but don't completely wipe it, so we maintain user association
            app_state.reset_session_to_default(session_id)
        
        # Read the uploaded Excel file
        contents = await file.read()
        
        try:
            # Load Excel file to get all sheet names
            excel_file = pd.ExcelFile(io.BytesIO(contents))
            sheet_names = excel_file.sheet_names
            
            # Parse selected sheets if provided; else use all sheets
            target_sheets = sheet_names
            if selected_sheets:
                try:
                    sel = json.loads(selected_sheets)
                    if isinstance(sel, list):
                        target_sheets = [s for s in sheet_names if s in sel]
                except Exception:
                    pass

            # Get session state and DuckDB connection
            session_state = app_state.get_session_state(session_id)

            datasets = {}
            

            
            # Process all sheets and register them in DuckDB
            processed_sheets = []
            
            for sheet_name in target_sheets:
                try:
                    # Read each sheet
                    sheet_df = pd.read_excel(io.BytesIO(contents), sheet_name=sheet_name)
                    
                    # Preprocessing steps
                    # 1. Drop empty rows and columns
                    sheet_df.dropna(how='all', inplace=True)
                    sheet_df.dropna(how='all', axis=1, inplace=True)
                    
                    # 2. Clean column names
                    sheet_df.columns = sheet_df.columns.str.strip()
                    
                    # 3. Skip empty sheets
                    if sheet_df.empty:
                        continue
                    
                    # Register each sheet in DuckDB with a clean table name
                    clean_sheet_name = clean_dataset_name(sheet_name)
                    # Check if the clean_sheet_name is a safe Python variable name; if not, append a random int

                    # First drop the table if it exists


                    # Then register the new table
                    datasets[clean_sheet_name] = sheet_df  # Store the DataFrame, not the name

                    
                    processed_sheets.append(clean_sheet_name)
                        
                except Exception as e:
                    logger.log_message(f"Error processing sheet '{sheet_name}': {str(e)}", level=logging.WARNING)
                    continue
            
            if not processed_sheets:
                raise HTTPException(status_code=400, detail="No valid sheets found in Excel file")
            
            # Update the session description (no primary dataset needed)
            desc = description
            app_state.update_session_dataset(session_id,datasets,processed_sheets,desc)


            
            logger.log_message(f"Processed Excel file with {len(processed_sheets)} sheets: {', '.join(processed_sheets)}", level=logging.INFO)
            
            return {
                "message": "Excel file processed successfully", 
                "session_id": session_id, 
                "sheets_processed": processed_sheets,
                "total_sheets": len(processed_sheets)
            }
            
        except Exception as e:
            logger.log_message(f"Error processing Excel file: {str(e)}", level=logging.ERROR)
            raise HTTPException(status_code=400, detail=f"Error processing Excel file: {str(e)}")
            
    except Exception as e:
        logger.log_message(f"Error in upload_excel: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=400, detail=str(e))


def clean_dataset_name(name: str) -> str:
    """
    Clean dataset name to be a safe Python identifier.
    Removes all characters that would cause issues in Python code execution.
    """
    if not name:
        return "dataset"
    
    # Convert to string and strip whitespace
    name = str(name).strip()
    
    # Replace spaces and common separators with underscores
    name = re.sub(r'[\s\-\.]+', '_', name)
    
    # Remove all non-alphanumeric characters except underscores
    name = re.sub(r'[^a-zA-Z0-9_]', '', name)
    
    # Remove multiple consecutive underscores
    name = re.sub(r'_+', '_', name)
    
    # Remove leading/trailing underscores
    name = name.strip('_')
    
    # Ensure it starts with a letter or underscore (Python identifier rule)
    if name and not re.match(r'^[a-zA-Z_]', name):
        name = f"dataset_{name}"
    
    # If empty after cleaning, use default
    if not name:
        name = "dataset"
    
    # Limit length to 30 characters
    if len(name) > 30:
        name = name[:30]
    
    # Ensure it's still a valid identifier after truncation
    if not re.match(r'^[a-zA-Z_]', name):
        name = f"dataset_{name}"
    

    
    return name
@router.post("/upload_dataframe")
async def upload_dataframe(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(...),
    fill_nulls: bool = Form(True),  # NEW: Fill null values  
    convert_types: bool = Form(True),  # NEW: Convert data types
    app_state = Depends(get_app_state),
    session_id: str = Depends(get_session_id_dependency),
    request: Request = None
):
    try:
        logger.log_message(f"CSV upload: fill_nulls={fill_nulls}, convert_types={convert_types}", level=logging.INFO)
        
        # Log the incoming request details
        logger.log_message(f"Upload request for session {session_id}: name='{name}', description='{description}'", level=logging.INFO)
        
        # Check if we need to force a complete session reset before upload
        force_refresh = request.headers.get("X-Force-Refresh") == "true" if request else False
        
        # Log session state BEFORE any changes
        session_state_before = app_state.get_session_state(session_id)
        datasets_before = session_state_before.get("datasets", {})
        logger.log_message(f"Session state BEFORE upload - datasets: {list(datasets_before.keys())}", level=logging.INFO)
        
        if force_refresh:
            logger.log_message(f"Force refresh requested for session {session_id} before CSV upload", level=logging.INFO)
            # Reset the session but don't completely wipe it, so we maintain user association
            app_state.reset_session_to_default(session_id)
            
            # Log session state AFTER reset
            session_state_after_reset = app_state.get_session_state(session_id)
            datasets_after_reset = session_state_after_reset.get("datasets", {})
            logger.log_message(f"Session state AFTER reset - datasets: {list(datasets_after_reset.keys())}", level=logging.INFO)
        
        # Clean and validate the name
        name = clean_dataset_name(name)
        
        # Validate name length and create safe variable name
        if len(name) > 30:
            name = name[:30]
        
        # Ensure it's a safe Python identifier

        
        # Read and process the CSV file
        content = await file.read()
        new_df = None
        last_exception = None
        
        # Try different encodings
        encodings_to_try = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']
        
        for encoding in encodings_to_try:
            try:
                csv_content = content.decode(encoding)
                new_df = pd.read_csv(io.StringIO(csv_content))
                logger.log_message(f"Successfully read CSV with encoding: {encoding}", level=logging.INFO)
                break
            except Exception as e:
                last_exception = e
                logger.log_message(f"Failed to read CSV with encoding {encoding}: {str(e)}", level=logging.WARNING)
                continue
        
        if new_df is None:
            raise HTTPException(status_code=400, detail=f"Error reading file with tried encodings: {encodings_to_try}. Last error: {str(last_exception)}")
        
        # Format the description
        desc = f" exact_python_name: `{name}` Dataset: {description}"
        
        # Create datasets dictionary with the new dataset
        datasets = {name: new_df}
        
        # Update the session with the new dataset (this will replace any existing datasets) but not update desc, as that is passed already
        app_state.update_session_dataset(session_id, datasets, [name], desc, pre_generated=True)
        
        # Log session state AFTER upload
        session_state_after_upload = app_state.get_session_state(session_id)
        datasets_after_upload = session_state_after_upload.get("datasets", {})
        logger.log_message(f"Session state AFTER upload - datasets: {list(datasets_after_upload.keys())}", level=logging.INFO)
        
        logger.log_message(f"Successfully uploaded dataset '{name}' for session {session_id}", level=logging.INFO)
        
        return {"message": "Dataframe uploaded successfully", "session_id": session_id}
        
    except Exception as e:
        logger.log_message(f"Error in upload_dataframe: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/settings/model")
async def update_model_settings(
    settings: ModelSettings,
    app_state = Depends(get_app_state),
    session_id: str = Depends(get_session_id_dependency)
):
    try:
        # If no API key provided, use default
        if not settings.api_key:
            if settings.provider.lower() == "groq":
                settings.api_key = os.getenv("GROQ_API_KEY")
            elif settings.provider.lower() == "openai":
                settings.api_key = os.getenv("OPENAI_API_KEY")
            elif settings.provider.lower() == "anthropic":
                settings.api_key = os.getenv("ANTHROPIC_API_KEY")
            elif settings.provider.lower() == "gemini":
                settings.api_key = os.getenv("GEMINI_API_KEY")
        
        # Get session state to update model config
        session_state = app_state.get_session_state(session_id)
        
        # Create the model config
        if 'gpt-5' in str(settings.model):
            model_config = {
                "provider": settings.provider,
                "model": settings.model,
                "api_key": settings.api_key,
                "temperature": settings.temperature,
                "max_tokens":None,
                "max_completion_tokens": 2500
            }
        elif 'o1-' in str(settings.model):
            model_config = {
                "provider": settings.provider,
                "model": settings.model,
                "api_key": settings.api_key,
                "temperature": 1,
                "max_tokens":5001
            }
            
        
        else:
            model_config = {
                "provider": settings.provider,
                "model": settings.model,
                "api_key": settings.api_key,
                "temperature": settings.temperature,
                "max_tokens": settings.max_tokens
            }
            
        # Update only the session's model config
        session_state["model_config"] = model_config
        
        # Also update the global model_config in app_state
        app_state.model_config = model_config
        
        # Update SessionManager's app_model_config
        app_state._session_manager._app_model_config = model_config

        # Create the LM instance to test the configuration, but don't set it globally
        lm = MODEL_OBJECTS[str(settings.model)]
        

        

        # Test the model configuration without setting it globally
        try:
            # resp = lm("Hello, are you working?")
            # logger.log_message(f"Model Response: {resp}", level=logging.INFO)
            # REMOVED: dspy.configure(lm=lm) - no longer set globally
            return {"message": "Model settings updated successfully"}
        except Exception as model_error:
            if "auth" in str(model_error).lower() or "api" in str(model_error).lower():
                raise HTTPException(
                    status_code=401,
                    detail=f"Invalid API key for {settings.model}. Please check your API key and try again."
                )
            elif "model" in str(model_error).lower():
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid model selection: {settings.model}. Please check if you have access to this model. {model_error}"
                )
            else:
                raise HTTPException(
                    status_code=500,
                    detail=f"Error configuring model: {str(model_error)}"
                )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}. Please check your model selection and API key."
        )

@router.get("/api/model-settings")
async def get_model_settings(
    app_state = Depends(get_app_state),
    session_id: str = Depends(get_session_id_dependency)
):
    """Get current model settings for the specific session"""
    # Get the session state for this specific user
    session_state = app_state.get_session_state(session_id)
    
    # Get model config from session state, with default fallbacks if needed
    model_config = session_state.get("model_config", {})
    
    # Use values from model_config with fallbacks to defaults
    return {
        "provider": model_config.get("provider", "anthropic"),
        "model": model_config.get("model", "claude-3-5-sonnet-latest"),
        "hasCustomKey": bool(model_config.get("api_key")) or bool(os.getenv("CUSTOM_API_KEY")),
        "temperature": model_config.get("temperature", 0.7),
        "maxTokens": model_config.get("max_tokens", 6000)
    }



@router.get("/api/default-dataset")
async def get_default_dataset(
    app_state = Depends(get_app_state),
    session_id: str = Depends(get_session_id_dependency)
):
    """Get default dataset and ensure session is using it"""
    # try:
        # First ensure the session is reset to default
    # app_state.reset_session_to_default(session_id)
    
    # Get the session state to ensure we're using the default dataset
    session_state = app_state.get_session_state(session_id)
    datasets = session_state["datasets"]
    keys = list(datasets.keys())
    if "df" in keys:
        df = datasets['df']
    else:
        df = pd.read_csv('Housing.csv')

    # Load Housing.csv from the data directory (relative to backend root)
 
    desc = "Housing data"
    
    # Replace NaN values with None (which becomes null in JSON)
    df = df.where(pd.notna(df), None)
    
    preview_data = {
        "headers": df.columns.tolist(),
        "rows": df.head(10).values.tolist(),
        "name": "Housing Dataset",
        "description": desc
    }
    return preview_data
    # except Exception as e:
    #     raise HTTPException(status_code=400, detail=str(e))

@router.post("/reset-session")
async def reset_session(
    request_data: Optional[ResetSessionRequest] = None,
    app_state = Depends(get_app_state),
    session_id: str = Depends(get_session_id_dependency),
    names: List[str] = None,
    description: str = None
):
    """Reset session to use default dataset with optional new description"""
    try:
        # Check if we need to preserve model settings
        preserve_settings = False
        if request_data and request_data.preserveModelSettings:
            preserve_settings = True
            
        # Get the current model settings before reset if needed
        model_config = None
        if preserve_settings:
            try:
                session_state = app_state.get_session_state(session_id)
                if "model_config" in session_state:
                    model_config = session_state["model_config"]
            except Exception as e:
                logger.log_message(f"Failed to get model settings: {str(e)}", level=logging.WARNING)
        
        # Now reset the session
        app_state.reset_session_to_default(session_id)
        
        # Restore model settings if requested
        if preserve_settings and model_config:
            try:
                session_state = app_state.get_session_state(session_id)
                session_state["model_config"] = model_config
                # logger.log_message(f"Preserved model settings for session {session_id}", level=logging.INFO)
            except Exception as e:
                logger.log_message(f"Failed to restore model settings: {str(e)}", level=logging.ERROR)
        
        # Get name and description from either query params or request body
        if request_data:
            name = request_data.name or name
            description = request_data.description or description
        
        # If name and description are provided, update the dataset description
        if names and description:
            session_state = app_state.get_session_state(session_id)
            datasets = session_state["datasets"]
            desc = f"{description}"
            # Ensure datasets is a Dict[str, pd.DataFrame]
            if not isinstance(datasets, dict) or not all(isinstance(v, pd.DataFrame) for v in datasets.values()):

                raise HTTPException(status_code=500, detail="Session datasets are not valid DataFrames")
            
            # Update the session dataset with the new description
            app_state.update_session_dataset(session_id, datasets, names, desc)
        
        return {
            "message": "Session reset to default dataset",
            "session_id": session_id,
            "dataset": "Housing.csv",
            "model_settings_preserved": preserve_settings
        }
    except Exception as e:
        logger.log_message(f"Failed to reset session: {str(e)}", level=logging.ERROR)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to reset session: {str(e)}"
        )



@router.post("/generate-description-from-preview")
async def generate_description_from_preview(
    request: dict,
    app_state = Depends(get_app_state)
):
    
    try:
        headers = request.get("headers", [])
        rows = request.get("rows", [])
        user_description = request.get("description", "")
        dataset_name = request.get("name", "Dataset")
        
        # Clean the dataset name
        dataset_name = clean_dataset_name(dataset_name)
        
        if not headers or not rows:
            raise HTTPException(status_code=400, detail="Headers and rows are required")

        # Convert rows to DataFrame
        df = pd.DataFrame(rows, columns=headers)
        
        # Infer data types from the sample data
        for col in df.columns:
            try:
                # Try to convert to numeric
                pd.to_numeric(df[col], errors='raise')
                df[col] = pd.to_numeric(df[col], errors='coerce')
            except:
                try:
                    # Try to convert to datetime (suppress warnings)
                    import warnings
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", UserWarning)
                        df[col] = pd.to_datetime(df[col], errors='coerce')
                    # If all values became NaT, it's probably not a date column
                    if df[col].isna().all():
                        df[col] = df[col].astype(str)
                except:
                    # Keep as string
                    df[col] = df[col].astype(str)
        
        # Build dataset view for description generation
        dataset_view = ""
        head_data = df.head(3)
        columns = [{col: str(head_data[col].dtype)} for col in head_data.columns]
        dataset_view += f"exact_table_name={dataset_name}\n:columns:{str(columns)}\n{head_data.to_markdown()}\n"
        
        # Generate description using AI
        with dspy.context(lm=mid_lm):
            data_context = dspy.Predict(dataset_description_agent)(
                existing_description=user_description,
                dataset=dataset_view
            )
            generated_desc = data_context.description
        
        # Clean the generated description to ensure it's valid JSON if it's JSON
        try:
            # Try to parse as JSON to validate it
            import json
            parsed_desc = json.loads(generated_desc)
            # If it's valid JSON, format it properly
            cleaned_desc = json.dumps(parsed_desc, indent=2)
        except json.JSONDecodeError:
            # If it's not JSON, use as-is but clean any problematic characters
            cleaned_desc = generated_desc.replace('\\r\\n', '\n').replace('\\n', '\n').replace("\\'", "'")
        
        # Format the description with exact_python_name
        formatted_desc = f" exact_python_name: `{dataset_name}` Dataset: {cleaned_desc}"
        
        return {"description": formatted_desc}
        
    except Exception as e:
        logger.log_message(f"Failed to generate description from preview: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=500, detail=f"Failed to generate description: {str(e)}")

@router.get("/api/session-info")
async def get_session_info(
    app_state = Depends(get_app_state),
    session_id: str = Depends(get_session_id_dependency)
):
    """Get information about the current session including dataset status"""
    try:
        # Get the session state
        session_state = app_state.get_session_state(session_id)
        
        # Get session manager reference for default name
        session_manager = app_state._session_manager
        
        # Get more detailed dataset information
        current_name = session_state.get("name", "")
        current_description = session_state.get("description", "")
        default_name = getattr(session_manager, "_default_name", "Housing Dataset")
        
        # More robust detection of custom dataset
        is_custom = False
        
        # Check by name
        if current_name and current_name != default_name:
            is_custom = True
                    
        # Also check by checking if we have a dataframe that's different from default
        if "datasets" in session_state and session_state["datasets"] is not None:
            try:
                # This is just a basic check - we could make it more sophisticated if needed
                key_count = len(session_state["datasets"].keys)
                if key_count > 1:
                    is_custom = True
            except Exception as e:
                logger.log_message(f"Error comparing datasets: {str(e)}", level=logging.ERROR)
        
        # Return session information
        response_data = {
            "session_id": session_id,
            "is_custom_dataset": is_custom,
            "dataset_name": current_name,
            "dataset_description": current_description,
            "default_name": default_name,
            "has_session": True,
            "session_keys": list(session_state.keys())  # For debugging
        }
        
        
        return response_data
    except Exception as e:
        logger.log_message(f"Error getting session info: {str(e)}", level=logging.ERROR)
        return {
            "session_id": session_id,
            "is_custom_dataset": False,
            "has_session": False,
            "error": str(e)
        }

# Add a new route to set the current message ID in the session
@router.post("/set-message-info")
async def set_message_info(
    message_info: MessageInfo,
    app_state = Depends(get_app_state),
    session_id: str = Depends(get_session_id_dependency)
):
    """Set the current message ID, chat ID, and user ID in the session"""
    try:
        # Get the session state
        session_state = app_state.get_session_state(session_id)
        
        # Make a copy of previous values for logging
        previous_message_id = session_state.get("current_message_id")
        previous_chat_id = session_state.get("chat_id")
        previous_user_id = session_state.get("user_id")
        
        # Update the session with message information
        if message_info.message_id is not None:
            session_state["current_message_id"] = message_info.message_id
        if message_info.chat_id is not None:
            session_state["chat_id"] = message_info.chat_id
        if message_info.user_id is not None:
            session_state["user_id"] = message_info.user_id
            
        # Get updated values for logging
        current_message_id = session_state.get("current_message_id")
        current_chat_id = session_state.get("chat_id")
        current_user_id = session_state.get("user_id")
        
        # # Log changes
        # logger.log_message(
        #     f"Message info updated for session {session_id}:\n"
        #     f"  message_id: {previous_message_id} -> {current_message_id}\n"
        #     f"  chat_id: {previous_chat_id} -> {current_chat_id}\n"
        #     f"  user_id: {previous_user_id} -> {current_user_id}",
        #     level=logging.INFO
        # )
        
        # Verify session state was updated
        updated_session_state = app_state.get_session_state(session_id)
        # logger.log_message(
        #     f"Verified session state after update:\n"
        #     f"  current_message_id: {updated_session_state.get('current_message_id')}\n"
        #     f"  chat_id: {updated_session_state.get('chat_id')}\n"
        #     f"  user_id: {updated_session_state.get('user_id')}",
        #     level=logging.INFO
        # )
        
        return {
            "success": True,
            "session_id": session_id,
            "message_id": current_message_id,
            "chat_id": current_chat_id,
            "user_id": current_user_id
        }
    except Exception as e:
        logger.log_message(f"Error setting message info: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/preview-csv-upload")
async def preview_csv_upload(
    file: UploadFile = File(...),
):
    """Preview CSV file without modifying session"""
    try:
        # Process file and return preview data only
        content = await file.read()
        # Try different encodings
        encodings_to_try = ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']
        new_df = None
        last_exception = None
        
        for encoding in encodings_to_try:
            try:
                csv_content = content.decode(encoding)
                new_df = pd.read_csv(io.StringIO(csv_content))
                logger.log_message(f"Successfully read CSV with encoding: {encoding}", level=logging.INFO)
                break
            except Exception as e:
                last_exception = e
                logger.log_message(f"Failed to read CSV with encoding {encoding}: {str(e)}", level=logging.WARNING)
                continue
        
        if new_df is None:
            raise HTTPException(status_code=400, detail=f"Error reading file with tried encodings: {encodings_to_try}. Last error: {str(last_exception)}")
        
        # Clean and validate the name
        name = file.filename.replace('.csv', '').replace(' ', '_').lower().strip()
        
        # Validate name length and create safe variable name
        name = clean_dataset_name(name)
        
        # Ensure it's a safe Python identifier

        
        # Format the description
        desc = f" exact_python_name: `{name}` Dataset: {file.filename}"
        
        # Create datasets dictionary with the new dataset
        
        
        # Update the session with the new dataset (this will replace any existing datasets)
        
        logger.log_message(f"Successfully previewed dataset '{name}'", level=logging.INFO)
        
        # Inline this in your CSV preview endpoint right before returning JSONResponse

        # df is your DataFrame built from the uploaded CSV

        # JSON-safe cleanup (no separate helper)
        new_df = new_df.replace([np.inf, -np.inf], None)         # Infs → null
        new_df = new_df.where(pd.notna(new_df), None)            # NaN → null
        new_df = new_df.dropna(how="all")                        # Drop fully-empty rows
        new_df = new_df.applymap(lambda x: None if isinstance(x, str) and x.strip() == "" else x)

        # Limit preview rows
        return {
            "headers": new_df.columns.tolist(),
            "rows": new_df.head(10).values.tolist(),
            "name": name,
            "description": desc
        }
        
    except Exception as e:
        logger.log_message(f"Error in preview_csv_upload: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/generate-session")
async def generate_session():
    """Generate a new session ID and initialize it with default dataset"""
    try:
        import uuid
        session_id = str(uuid.uuid4())
        
        # Initialize the session with default dataset
        # This will be handled by the first request to any endpoint that uses get_session_id_dependency
        
        logger.log_message(f"Generated new session ID: {session_id}", level=logging.INFO)
        
        return {
            "session_id": session_id,
            "message": "Session created successfully"
        }
    except Exception as e:
        logger.log_message(f"Error generating session: {str(e)}", level=logging.ERROR)
        raise HTTPException(status_code=500, detail=f"Failed to generate session: {str(e)}")
