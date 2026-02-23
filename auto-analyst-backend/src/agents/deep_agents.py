import asyncio
import ast
import json
import os
import dspy
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from src.utils.logger import Logger
import logging
import datetime
import re
import textwrap

def clean_print_statements(code_block):
    """
    This function cleans up any `print()` statements that might contain unwanted `\n` characters.
    It ensures print statements are properly formatted without unnecessary newlines.
    """
    # This regex targets print statements, even if they have newlines inside
    return re.sub(r'print\((.*?)(\\n.*?)(.*?)\)', r'print(\1\3)', code_block, flags=re.DOTALL)


def clean_unicode_chars(text):
    """
    Clean Unicode characters that might cause encoding issues.
    Replaces common Unicode characters with ASCII equivalents.
    """
    if not isinstance(text, str):
        return text
    
    # Replace common Unicode characters with ASCII equivalents
    replacements = {
        '\u2192': ' -> ',  # Right arrow
        '\u2190': ' <- ',  # Left arrow
        '\u2194': ' <-> ', # Left-right arrow
        '\u2500': '-',     # Box drawing horizontal
        '\u2502': '|',     # Box drawing vertical
        '\u2026': '...',   # Ellipsis
        '\u2013': '-',     # En dash
        '\u2014': '-',     # Em dash
        '\u201c': '"',     # Left double quotation mark
        '\u201d': '"',     # Right double quotation mark
        '\u2018': "'",     # Left single quotation mark
        '\u2019': "'",     # Right single quotation mark
    }
    
    for unicode_char, ascii_replacement in replacements.items():
        text = text.replace(unicode_char, ascii_replacement)
    
    # Remove any remaining non-ASCII characters
    text = text.encode('ascii', 'ignore').decode('ascii')
    
    return text


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


# Configure Plotly to prevent auto-display
def configure_plotly_no_display():
    """Configure Plotly to prevent automatic browser display"""
    try:
        import plotly.io as pio
        
        # Set environment variables to prevent browser opening
        os.environ['BROWSER'] = ''
        os.environ['PLOTLY_RENDERER'] = 'json'
        
        # Configure Plotly renderers
        pio.renderers.default = 'json'
        pio.templates.default = 'plotly_white'
        
        # Disable Kaleido auto-display if available
        try:
            import plotly.graph_objects as go
            # Configure figure defaults to not auto-display
            go.Figure.show = lambda self, *args, **kwargs: None
        except ImportError:
            pass
            
    except ImportError:
        print("Warning: Plotly not available for configuration")

# Call the configuration function immediately
configure_plotly_no_display()

logger = Logger("deep_agents", see_time=True, console_log=True, level=logging.DEBUG)
load_dotenv()

class deep_questions(dspy.Signature):
    """
You are a data analysis assistant.
Your role is to take a user's high-level analytical goal and generate a set of deep, targeted follow-up questions. These questions should guide an analyst toward a more thorough understanding of the goal by encouraging exploration, segmentation, and causal reasoning.
Instructions:
- Generate up to 5 insightful, data-relevant questions.
- Use the dataset structure to tailor your questions (e.g., look at the available columns, data types, and what kind of information they can reveal).
- The questions should help the user decompose their analytic goal and explore it from multiple angles (e.g., time trends, customer segments, usage behavior, external factors, feedback).
- Each question should be specific enough to guide actionable analysis or investigation.
- Use a clear and concise style, but maintain depth.
Inputs:
- goal: The user's analytical goal or main question they want to explore
- dataset_info: A description of the dataset the user is querying, including:
    - What the dataset represents
    - Key columns and their data types
Output:
- deep_questions: A list of up to 5 specific, data-driven questions that support the analytic goal
---
Example:
Analytical Goal:
Understand why churn has been rising
Dataset Info:
Customer Retention Dataset tracking subscription activity over time.  
Columns:
- customer_id (string)
- join_date (date)
- churn_date (date, nullable)
- is_churned (boolean)
- plan_type (string: 'basic', 'premium', 'enterprise')
- region (string)
- last_login_date (date)
- avg_weekly_logins (float)
- support_tickets_last_30d (int)
- satisfaction_score (float, 0–10 scale)
Decomposed Questions:
1. How has the churn rate changed month-over-month, and during which periods was the increase most pronounced?
2. Are specific plan types or regions showing a higher churn rate relative to others?
3. What is the average satisfaction score and support ticket count among churned users compared to retained users?
4. Do churned users exhibit different login behavior (e.g., avg_weekly_logins) in the weeks leading up to their churn date?
5. What is the tenure distribution (time from join_date to churn_date) among churned customers, and are short-tenure users more likely to churn?
    """
    goal = dspy.InputField(desc="User analytical goal — what main insight or question they want to answer")
    dataset_info = dspy.InputField(desc="A description of the dataset: what it represents, and the main columns with data types")
    deep_questions:str = dspy.OutputField(desc="A list of up to five questions that help deeply explore the analytical goal using the dataset")

class deep_synthesizer(dspy.Signature):
    """
You are a data analysis synthesis expert.
Your job is to take the outputs from a multi-agent data analytics system - including the original user query, the code summaries from each agent, and the actual printed results from running those code blocks - and synthesize them into a comprehensive, well-structured final report.
This report should:
- Explain what steps were taken and why (based on the query)
- Summarize the code logic used by each agent, without including raw code
- Highlight key findings and results from the code outputs
- Offer clear, actionable insights tied back to the user's original question
- Be structured, readable, and suitable for decision-makers or analysts
Instructions:
- Begin with a brief restatement of the original query and what it aimed to solve
- Organize your report step-by-step or by analytical theme (e.g., segmentation, trend analysis, etc.)
- For each part, summarize what was analyzed, how (based on code summaries), and what the result was (based on printed output)
- End with a final set of synthesized conclusions and potential next steps or recommendations
Inputs:
- query: The user's original analytical question or goal
- summaries: A list of natural language descriptions of what each agent's code did
- print_outputs: A list of printed outputs (results) from running each agent's code
Output:
- synthesized_report: A structured and readable report that ties all parts together, grounded in the code logic and results
Example use:
You are not just summarizing outputs - you're telling a story that answers the user's query using real data.
    """

    query = dspy.InputField(desc="The original user query or analytical goal")
    summaries = dspy.InputField(desc="List of code summaries - each describing what a particular agent's code did")
    print_outputs = dspy.InputField(desc="List of print outputs - the actual data insights generated by the code")
    synthesized_report = dspy.OutputField(desc="The final, structured report that synthesizes all the information into clear insights")

def clean_and_store_code(code, session_datasets=None):
    """
    Cleans and stores code execution results in a standardized format.
    
    Args:
        code (str): Raw code text to execute
        session_datasets (dict): Dictionary of datasets from session state
        
    Returns:
        dict: Execution results containing printed_output, plotly_figs, and error info
    """
    import io
    import sys
    import re
    import plotly.express as px
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    import plotly.io as pio
    
    # Make all session datasets available globally if provided
    if session_datasets is not None:
        for dataset_name, dataset_df in session_datasets.items():
            globals()[dataset_name] = dataset_df
    
    # Initialize output containers
    output_dict = {
        'exec_result': None,
        'printed_output': '',
        'plotly_figs': [],
        'error': None
    }
    
    try:
        # Clean the code
        cleaned_code = code.strip()
        
        cleaned_code = cleaned_code.replace('```python', '').replace('```', '')

    
        # Fix try statement syntax
        cleaned_code = cleaned_code.replace('try\n', 'try:\n')
    
        # Remove code patterns that would make the code unrunnable
        invalid_patterns = [
            '```', # Code block markers
            '\\n', # Raw newlines
            '\\t', # Raw tabs
            '\\r', # Raw carriage returns
        ]
        
        for pattern in invalid_patterns:
            if pattern in cleaned_code:
                cleaned_code = cleaned_code.replace(pattern, '')
        
        
        # Remove reading the csv file if it's already in the context
        cleaned_code = re.sub(r"df\s*=\s*pd\.read_csv\([\"\'].*?[\"\']\).*?(\n|$)", '', cleaned_code)
        
        # Only match assignments at top level (not indented)
        # 1. Remove 'df = pd.DataFrame()' if it's at the top level
        cleaned_code = re.sub(
            r"^df\s*=\s*pd\.DataFrame\(\s*\)\s*(#.*)?$",
            '',
        cleaned_code,
            flags=re.MULTILINE
        )
        cleaned_code = re.sub(r"plt\.show\(\).*?(\n|$)", '', cleaned_code)
        # Remove all .show() method calls more comprehensively
        cleaned_code = re.sub(r'\b\w*\.show\(\)', '', cleaned_code)
        cleaned_code = re.sub(r'^\s*\w*fig\w*\.show\(\)\s*;?\s*$', '', cleaned_code, flags=re.MULTILINE)
        
        # Additional patterns to catch more .show() variations
        cleaned_code = re.sub(r'\.show\(\s*\)', '', cleaned_code)  # .show() with optional spaces
        cleaned_code = re.sub(r'\.show\(\s*renderer\s*=\s*[\'"][^\'\"]*[\'"]\s*\)', '', cleaned_code)  # .show(renderer='...')
        cleaned_code = re.sub(r'plotly_figs\[\d+\]\.show\(\)', '', cleaned_code)  # plotly_figs[0].show()
        
        # More comprehensive patterns
        cleaned_code = re.sub(r'\.show\([^)]*\)', '', cleaned_code)  # .show(any_args)
        cleaned_code = re.sub(r'fig\w*\.show\(\s*[^)]*\s*\)', '', cleaned_code)  # fig*.show(any_args)
        cleaned_code = re.sub(r'\w+_fig\w*\.show\(\s*[^)]*\s*\)', '', cleaned_code)  # *_fig*.show(any_args)
        
        cleaned_code = remove_main_block(cleaned_code)
        
        # Clean Unicode characters that might cause encoding issues
        cleaned_code = clean_unicode_chars(cleaned_code)
        
        # Capture printed output
        old_stdout = sys.stdout
        captured_output = io.StringIO()
        sys.stdout = captured_output
        
        # Create execution environment with common imports and session data
        exec_globals = {
            '__builtins__': __builtins__,
            'pd': __import__('pandas'),
            'np': __import__('numpy'),
            'px': px,
            'go': go,
            'make_subplots': make_subplots,
            'plotly_figs': [],
            'print': print,
        }
        
        # Add session DataFrame if available
        if session_datasets is not None:
            for dataset_name, dataset_df in session_datasets.items():
                exec_globals[dataset_name] = dataset_df
        
        # Add other common libraries that might be needed
        try:
            exec_globals['sm'] = __import__('statsmodels.api', fromlist=[''])
            exec_globals['train_test_split'] = __import__('sklearn.model_selection', fromlist=['train_test_split']).train_test_split
            exec_globals['LinearRegression'] = __import__('sklearn.linear_model', fromlist=['LinearRegression']).LinearRegression
            exec_globals['mean_absolute_error'] = __import__('sklearn.metrics', fromlist=['mean_absolute_error']).mean_absolute_error
            exec_globals['r2_score'] = __import__('sklearn.metrics', fromlist=['r2_score']).r2_score
            exec_globals['LabelEncoder'] = __import__('sklearn.preprocessing', fromlist=['LabelEncoder']).LabelEncoder
            exec_globals['warnings'] = __import__('warnings')
        except ImportError as e:
            print(f"Warning: Could not import some optional libraries: {e}")
        
        # Execute the code
        exec(cleaned_code, exec_globals)
        
        # Restore stdout
        sys.stdout = old_stdout
        
        # Get the captured output
        printed_output = captured_output.getvalue()
        output_dict['printed_output'] = printed_output
        # Extract plotly figures from the execution environment
        if 'plotly_figs' in exec_globals:
            plotly_figs = exec_globals['plotly_figs']
            if isinstance(plotly_figs, list):
                output_dict['plotly_figs'] = plotly_figs
            else:
                output_dict['plotly_figs'] = [plotly_figs] if plotly_figs else []
        
        # Also check for any figure variables that might have been created
        for var_name, var_value in exec_globals.items():
            if hasattr(var_value, 'to_json') and hasattr(var_value, 'show'):
                # This looks like a Plotly figure
                if var_value not in output_dict['plotly_figs']:
                    output_dict['plotly_figs'].append(var_value)
        
    except Exception as e:
        # Restore stdout in case of error
        sys.stdout = old_stdout
        error_msg = str(e)
        output_dict['error'] = error_msg
        output_dict['printed_output'] = f"Error executing code: {error_msg}"
        print(f"Code execution error: {error_msg}")
        
    return output_dict

def score_code(args, code, datasets=None):
    """
    Cleans and stores code execution results in a standardized format.
    Safely handles execution errors and returns clean output even if execution fails.
    Ensures plotly figures are properly created and captured.
    
    Args:
        args: Arguments (unused but required for dspy.Refine)
        code: Code object with combined_code attribute
        datasets: Dictionary of datasets from session state (optional)
        
    Returns:
        int: Score (0=error, 1=success, 2=success with plots)
    """

    code_text = code.combined_code
    try:
        # Fix try statement syntax
        code_text = code_text.replace('try\n', 'try:\n')
        code_text = code_text.replace('```python', '').replace('```', '')
        
        
        # Remove code patterns that would make the code unrunnable
        invalid_patterns = [
            '```', '\\n', '\\t', '\\r'
        ]
        
        for pattern in invalid_patterns:
            if pattern in code_text:
                code_text = code_text.replace(pattern, '')

        cleaned_code = re.sub(r"plt\.show\(\).*?(\n|$)", '', code_text)
        # Remove all .show() method calls more comprehensively
        cleaned_code = re.sub(r'\b\w*\.show\(\)', '', cleaned_code)
        cleaned_code = re.sub(r'^\s*\w*fig\w*\.show\(\)\s*;?\s*$', '', cleaned_code, flags=re.MULTILINE)
        
        # Additional patterns to catch more .show() variations
        cleaned_code = re.sub(r'\.show\(\s*\)', '', cleaned_code)  # .show() with optional spaces
        cleaned_code = re.sub(r'\.show\(\s*renderer\s*=\s*[\'"][^\'\"]*[\'"]\s*\)', '', cleaned_code)  # .show(renderer='...')
        cleaned_code = re.sub(r'plotly_figs\[\d+\]\.show\(\)', '', cleaned_code)  # plotly_figs[0].show()
        
        # More comprehensive patterns
        cleaned_code = re.sub(r'\.show\([^)]*\)', '', cleaned_code)  # .show(any_args)
        cleaned_code = re.sub(r'fig\w*\.show\(\s*[^)]*\s*\)', '', cleaned_code)  # fig*.show(any_args)
        cleaned_code = re.sub(r'\w+_fig\w*\.show\(\s*[^)]*\s*\)', '', cleaned_code)  # *_fig*.show(any_args)
            
        cleaned_code = remove_main_block(cleaned_code)
        
        # Capture stdout using StringIO
        from io import StringIO
        import sys
        import plotly.graph_objects as go
        import pandas as pd
        import numpy as np
        
        stdout_capture = StringIO()
        original_stdout = sys.stdout
        sys.stdout = stdout_capture
        
        # Execute code in a new namespace with datasets available
        local_vars = {}
        
        # Add datasets to the execution context if provided
        if datasets:
            local_vars.update(datasets)
        
        # Add common imports to the execution context
        local_vars.update({
            'pd': pd,
            'np': np,
            'go': go,
            'plt': __import__('matplotlib.pyplot'),
            'sns': __import__('seaborn'),
        })
        
        exec(cleaned_code, globals(), local_vars)
        
        # Capture any plotly figures from local namespace
        plotly_figs = []
        for var_name, var in local_vars.items():
            if isinstance(var, go.Figure):
                if not var.layout.title:
                    var.update_layout(title=f"Figure {len(plotly_figs) + 1}")
                if not var.layout.template:
                    var.update_layout(template="plotly_white")
                plotly_figs.append(var)
            elif isinstance(var, (list, tuple)):
                for item in var:
                    if isinstance(item, go.Figure):
                        if not item.layout.title:
                            item.update_layout(title=f"Figure {len(plotly_figs) + 1}")
                        if not item.layout.template:
                            item.update_layout(template="plotly_white")
                        plotly_figs.append(item)
        
        # Restore stdout and get captured output
        sys.stdout = original_stdout
        captured_output = stdout_capture.getvalue()
        stdout_capture.close()
        
        # Calculate score based on execution and plot generation
        score = 2 if plotly_figs else 1
        
        return score
    
    except Exception as e:
        # Restore stdout in case of error
        if 'stdout_capture' in locals():
            sys.stdout = original_stdout
            stdout_capture.close()
            
        return 0
    

class deep_planner(dspy.Signature):
    """
    You are an advanced multi-question planning agent. Your task is to generate the most optimized and minimal plan
    to answer up to 5 analytical questions using available agents.
    Your responsibilities:
    1. Feasibility: Verify that the goal is achievable using the provided datasets and agent descriptions.
    2. Optimization: 
       - Batch up to 2 similar questions per agent call.
       - Reuse outputs across questions wherever possible.
       - Avoid unnecessary agents or redundant processing.
       - Minimize total agent calls while preserving correctness.
    3. Clarity: 
       - Define clear variable usage (create/use).
       - Specify concise step-by-step instructions per agent.
       - Use dependency arrows (->) to indicate required agent outputs used by others.
    Inputs:
    - deep_questions: A list of up to 5 deep analytical questions (e.g., ["q1", "q2", ..., "q5"])
    - dataset: The available dataset(s) in memory or context
    - agents_desc: Dictionary containing each agent's name and its capabilities or descriptions
    Outputs:
    - plan_instructions: Detailed per-agent variable flow and functionality in the format:
        {
            "agent_x": {
                "create": ["cleaned_data: DataFrame - cleaned version of the input dataset"],
                "use": ["df: DataFrame - raw input dataset"],
                "instruction": "Clean the dataset by handling null values and standardizing formats."
            },
            "agent_y": {
                "create": ["analysis_results: dict - results of correlation analysis"],
                "use": ["cleaned_data: DataFrame - output from @agent_x"],
                "instruction": "Perform correlation analysis to identify strong predictors."
            }
        }
    Output Goal:
    Generate a small, clean, optimized execution plan using minimal agent calls, reusable outputs, and well-structured dependencies.
    USE THE EXACT NAME OF THE AGENTS IN THE INSTRUCTIONS
    """

    deep_questions = dspy.InputField(desc="List of up to 5 deep analytical questions to answer")
    dataset = dspy.InputField(desc="Available datasets, use 'df' as the working dataset")
    agents_desc = dspy.InputField(desc="Descriptions of available agents and their functions")
    plan_instructions = dspy.OutputField(desc="Variable-level instructions for each agent used in the plan")

class deep_plan_fixer(dspy.Signature):
    """
    You are a plan instruction fixer agent. Your task is to take potentially malformed plan instructions
    and convert them into a properly structured dictionary format that can be safely evaluated.
    Your responsibilities:
    1. Parse and validate the input plan instructions
    2. Convert the instructions into a proper dictionary format
    3. Ensure all agent instructions follow the required structure:
       {
           "@agent_name": {
               "create": ["variable: type - description"],
               "use": ["variable: type - description"],
               "instruction": "clear instruction text"
           }
       }
    4. Handle any malformed or missing components
    5. Return a properly formatted dictionary string that can be safely evaluated
    Inputs:
    - plan_instructions: The potentially malformed plan instructions to fix
    Outputs:
    - fixed_plan: A properly formatted dictionary string that can be safely evaluated
    """

    plan_instructions = dspy.InputField(desc="The potentially malformed plan instructions to fix")
    fixed_plan = dspy.OutputField(desc="Properly formatted dictionary string that can be safely evaluated")

class final_conclusion(dspy.Signature):
    """
You are a high-level analytics reasoning engine.
Your task is to take multiple synthesized analytical results (each answering part of the original query) and produce a cohesive final conclusion that directly addresses the user's original question.
This is not just a summary — it's a judgment. Use evidence from the synthesized findings to:
- Answer the original question with clarity
- Highlight the most important insights
- Offer any causal reasoning or patterns discovered
- Suggest next steps or strategic recommendations where appropriate
Instructions:
- Focus on relevance to the original query
- Do not just repeat what the synthesized sections say — instead, infer, interpret, and connect dots
- Prioritize clarity and insight over detail
- End with a brief "Next Steps" section if applicable
Inputs:
- query: The original user question or goal
- synthesized_sections: A list of synthesized result sections from the deep_synthesizer step (each covering part of the analysis)
Output:
- final_summary: A cohesive final conclusion that addresses the query, draws insight, and offers high-level guidance
---
Example Output Structure:
**Conclusion**  
Summarize the overall answer to the user's question, using the most compelling evidence across the synthesized sections.
**Key Takeaways**  
- Bullet 1  
- Bullet 2  
- Bullet 3  
**Recommended Next Steps**  
(Optional based on context)
    """

    query = dspy.InputField(desc="The user's original query or analytical goal")
    synthesized_sections = dspy.InputField(desc="List of synthesized outputs — each one corresponding to a sub-part of the analysis")
    final_conclusion = dspy.OutputField(desc="A cohesive, conclusive answer that addresses the query and integrates key insights")




class deep_code_synthesizer(dspy.Signature):
    """
You are a code synthesis and optimization engine that combines and fixes code from multiple analytical agents.
Your task is to take code outputs from preprocessing, statistical analysis, machine learning, and visualization agents, then:
- Combine them into a single, coherent analysis pipeline
- Fix any errors or inconsistencies between agent outputs
- Ensure proper data flow between steps
- Optimize the combined code for efficiency
- Add necessary imports and dependencies
- Handle any data type mismatches or conversion issues
- Validate and normalize data types between agent outputs (e.g., ensure DataFrame operations maintain DataFrame type)
- Convert between common data structures (lists, dicts, DataFrames) as needed
- Add type hints and validation checks
- Ensure consistent variable naming across agents
- Ensure all visualizations use Plotly exclusively
- Create comprehensive visualizations that show all important variables and relationships
- Store all Plotly figures in a list for later use in the report
Instructions:
- Review each agent's code for correctness and completeness
- Ensure variables are properly passed between steps with consistent types
- Fix any syntax errors or logical issues
- Add error handling and type validation where needed
- Optimize code structure and performance
- Maintain consistent coding style
- Add clear comments explaining the analysis flow
- Add data type conversion functions where needed
- Validate input/output types between agent steps
- Handle edge cases where agents might return different data structures
- Convert any non-Plotly visualizations to Plotly format
- Ensure all important variables are visualized appropriately
- Store all Plotly figures in a list called plotly_figs
- Include appropriate titles, labels, and legends for all visualizations
- Use consistent styling across all Plotly visualizations
- DONOT COMMENT OUT ANYTHING AS THE CODE SHOULD RUN & SHOW OUTPUTS
- THE DATASET IS ALREADY LOADED, DON'T CREATE FAKE DATA. 'df' is always loaded
Inputs:
- deep_questions- The five deep questions this system is answering
- dataset_info - Information about the dataset structure and types
- planner_instructions - the plan according to the planner, ensure that the final code makes everything coherent
- code - List of all agent code
Output:
- combined_code: - A single, optimized Python script that combines all analysis steps with proper type handling and Plotly visualizations
"""
    deep_questions = dspy.InputField(desc="The five deep questions this system is answering")
    dataset_info = dspy.InputField(desc="Information about the dataset")
    planner_instructions = dspy.InputField(desc="The planner instructions for each")
    code = dspy.InputField(desc="The code generated by all agents")
    combined_code = dspy.OutputField(desc="A single, optimized Python script that combines all analysis steps")

class deep_code_fix(dspy.Signature):
    """
    You are a code debugging and fixing agent that analyzes and repairs code errors.
    
    Your task is to:
    - Analyze error messages and identify root causes
    - Fix syntax errors, logical issues, and runtime problems
    - Ensure proper data type handling and conversions
    - Add appropriate error handling and validation
    - Maintain code style and documentation
    - Preserve the original analysis intent
    
    Instructions:
    - Carefully analyze the error message and stack trace
    - Identify the specific line(s) causing the error
    - Determine if the issue is syntax, logic, or runtime related
    - Fix the code while maintaining its original purpose
    - Add appropriate error handling if needed
    - Ensure the fix doesn't introduce new issues
    - Document the changes made
    
    Inputs:
    - code: The code that generated the error
    - error: The error message and stack trace
    
    Output:
    - fixed_code: The repaired code with error handling
    - fix_explanation: Explanation of what was fixed and why
    """
    code = dspy.InputField(desc="The code that generated the error")
    error = dspy.InputField(desc="The error message and stack trace")
    fixed_code = dspy.OutputField(desc="The repaired code with error handling")
    fix_explanation = dspy.OutputField(desc="Explanation of what was fixed and why")


chart_instructions = """
Chart Styling Guidelines:
1. General Styling:
   - Use a clean, professional color palette (e.g., Tableau, ColorBrewer)
   - Include clear titles and axis labels
   - Add appropriate legends
   - Use consistent font sizes and styles
   - Include grid lines where helpful
   - Add hover information for interactive plots
2. Specific Chart Types:
   - Bar Charts:
     * Use horizontal bars for many categories
     * Sort bars by value when appropriate
     * Use consistent bar widths
     * Add value labels on bars
   
   - Line Charts:
     * Use distinct line styles/colors
     * Add markers at data points
     * Include trend lines when relevant
     * Show confidence intervals if applicable
   
   - Scatter Plots:
     * Use appropriate marker sizes
     * Add regression lines when needed
     * Use color to show additional dimensions
     * Include density contours for large datasets
   
   - Heatmaps:
     * Use diverging color schemes for correlation
     * Include value annotations
     * Sort rows/columns by similarity
     * Add clear color scale legend
3. Data Visualization Best Practices:
   - Start axes at zero when appropriate
   - Use log scales for wide-ranging data
   - Include reference lines/benchmarks
   - Add annotations for important points
   - Show uncertainty where relevant
   - Use consistent color encoding
   - Include data source and timestamp
   - Add clear figure captions
4. Interactive Features:
   - Enable zooming and panning
   - Add tooltips with detailed information
   - Include download options
   - Allow toggling of data series
   - Enable cross-filtering between charts
5. Accessibility:
   - Use colorblind-friendly palettes
   - Include alt text for all visualizations
   - Ensure sufficient contrast
   - Make interactive elements keyboard accessible
   - Provide text alternatives for key insights
"""




class deep_analysis_module(dspy.Module):
    def __init__(self,agents, agents_desc):
        # logger.log_message(f"Initializing deep_analysis_module with {agents} agents: {list(agents.keys())}", level=logging.INFO)
        
        # self.agent = agents
        self.agents = {}
        for key in agents.keys():
            self.agents[key] = dspy.asyncify(dspy.Predict(agents[key]))

        # for sig in self.agen
        # Make all dspy operations async using asyncify
        self.deep_questions = dspy.asyncify(dspy.Predict(deep_questions))
        self.deep_planner = dspy.asyncify(dspy.Predict(deep_planner))
        self.deep_synthesizer = dspy.asyncify(dspy.Predict(deep_synthesizer))
        # Keep both asyncified and non-asyncified versions for code synthesizer
        self.deep_code_synthesizer_sync = dspy.Predict(deep_code_synthesizer)  # For dspy.Refine
        self.deep_code_synthesizer = dspy.asyncify(dspy.Predict(deep_code_synthesizer))  # For async use
        self.deep_plan_fixer = dspy.asyncify(dspy.Predict(deep_plan_fixer))
        self.deep_code_fixer = dspy.asyncify(dspy.Predict(deep_code_fix))
        self.styling_instructions = chart_instructions
        self.agents_desc = agents_desc
        self.final_conclusion = dspy.asyncify(dspy.ChainOfThought(final_conclusion))
        
        # logger.log_message(f"Deep analysis module initialized successfully with agents: {list(self.agents.keys())}", level=logging.INFO)

    async def execute_deep_analysis_streaming(self, goal, dataset_info, session_datasets=None):
        """
        Execute deep analysis with streaming progress updates.
        This is an async generator that yields progress updates incrementally.
        """
        logger.log_message(f"🔍 DEEP ANALYSIS STREAMING START - goal: {goal[:100]}...", level=logging.DEBUG)
        logger.log_message(f"🔍 DEEP ANALYSIS STREAMING START - dataset_info type: {type(dataset_info)}, length: {len(dataset_info) if isinstance(dataset_info, str) else 'N/A'}", level=logging.DEBUG)
        logger.log_message(f"🔍 DEEP ANALYSIS STREAMING START - session_datasets type: {type(session_datasets)}, keys: {list(session_datasets.keys()) if session_datasets else 'None'}", level=logging.DEBUG)
        
        # Make all session datasets available globally for code execution
        if session_datasets is not None:
            for dataset_name, dataset_df in session_datasets.items():
                globals()[dataset_name] = dataset_df
                logger.log_message(f"🔍 MADE DATASET AVAILABLE GLOBALLY - {dataset_name}: shape {dataset_df.shape}", level=logging.DEBUG)
        
        try:
            # Step 1: Generate deep questions (20% progress)
            yield {
                "step": "questions",
                "status": "processing",
                "message": "Generating analytical questions...",
                "progress": 10
            }
            
            logger.log_message(f"🔍 CALLING DEEP_QUESTIONS - dataset_info type: {type(dataset_info)}, length: {len(dataset_info) if isinstance(dataset_info, str) else 'N/A'}", level=logging.DEBUG)
            questions = await self.deep_questions(goal=goal, dataset_info=dataset_info)
            logger.log_message("Questions generated")
            
            yield {
                "step": "questions", 
                "status": "completed",
                "content": questions.deep_questions,
                "progress": 20
            }
            
            # Step 2: Create analysis plan (40% progress)
            yield {
                "step": "planning",
                "status": "processing", 
                "message": "Creating analysis plan...",
                "progress": 25
            }
            
            question_list = [q.strip() for q in questions.deep_questions.split('\n') if q.strip()]
            logger.log_message(f" CALLING DEEP_PLANNER - dataset_info type: {type(dataset_info)}, length: {len(dataset_info) if isinstance(dataset_info, str) else 'N/A'}", level=logging.DEBUG)
            deep_plan = await self.deep_planner(
                deep_questions=questions.deep_questions, 
                dataset=dataset_info, 
                agents_desc=str(self.agents_desc)
            )
            logger.log_message("Plan created")
            
            # Parse plan instructions
            try:
                plan_instructions = ast.literal_eval(deep_plan.plan_instructions)
                if not isinstance(plan_instructions, dict):
                    plan_instructions = json.loads(deep_plan.plan_instructions)
                keys = [key for key in plan_instructions.keys()]
                
                if not all(key in self.agents for key in keys):
                    raise ValueError(f"Invalid agent key(s) in plan instructions. Available agents: {list(self.agents.keys())}")
                logger.log_message(f"Plan instructions: {plan_instructions}", logging.INFO)
                logger.log_message(f"Keys: {keys}", logging.INFO)
            except (ValueError, SyntaxError, json.JSONDecodeError) as e:
                try:
                    deep_plan = await self.deep_plan_fixer(plan_instructions=deep_plan.plan_instructions)
                    plan_instructions = ast.literal_eval(deep_plan.fixed_plan)
                    if not isinstance(plan_instructions, dict):
                        plan_instructions = json.loads(deep_plan.fixed_plan)
                    keys = [key for key in plan_instructions.keys()]
                except (ValueError, SyntaxError, json.JSONDecodeError) as e:
                    logger.log_message(f"Error parsing plan instructions: {e}", logging.ERROR)
                    raise e
            
            logger.log_message("Instructions parsed")
            
            yield {
                "step": "planning",
                "status": "completed",
                "content": deep_plan.plan_instructions,
                "progress": 40
            }
            
            # Step 3: Execute agent tasks (60% progress)
            yield {
                "step": "agent_execution",
                "status": "processing",
                "message": "Executing analysis agents...",
                "progress": 45
            }
            
            logger.log_message(f"🔍 CREATING DSPY EXAMPLES - dataset_info type: {type(dataset_info)}, length: {len(dataset_info) if isinstance(dataset_info, str) else 'N/A'}", level=logging.DEBUG)


            # tasks = [self.agents[key](**q) for q, key in zip(queries, keys)]
            tasks = []
            for key in  keys:
                logger.log_message(f"Preparing agent task for key: {key}", level=logging.DEBUG)
                logger.log_message(f"Plan instructions for {key}: {plan_instructions[key]}", level=logging.DEBUG)
                if "data_viz" in key or "viz" in key.lower() or "visual" in key.lower() or "plot" in key.lower() or "chart" in key.lower():
                    logger.log_message(f"Agent {key} identified as visualization agent. Adding styling_index.", level=logging.DEBUG)
                    task = self.agents[key](
                        goal=questions.deep_questions,
                        dataset=dataset_info,
                        plan_instructions=str(plan_instructions[key]),
                        styling_index=self.styling_instructions
                    )
                    logger.log_message(f"Visualization agent task for {key} created.", level=logging.DEBUG)
                    tasks.append(task)
                else:
                    logger.log_message(f"Agent {key} identified as non-visualization agent.", level=logging.DEBUG)
                    task = self.agents[key](
                        goal=questions.deep_questions,
                        dataset=dataset_info,
                        plan_instructions=str(plan_instructions[key])
                    )
                    logger.log_message(f"Non-visualization agent task for {key} created.", level=logging.DEBUG)
                    tasks.append(task)






            logger.log_message("Passed that stage")
            # DEBUG: Log what parameters each agent will receive
                  
            # Await all tasks to complete
            summaries = []
            codes = []
            logger.log_message("Tasks started")
            
            completed_tasks = 0
            for task in asyncio.as_completed(tasks):
                result = await task
                summaries.append(result.summary)
                codes.append(result.code)
                completed_tasks += 1
                
                # Update progress for each completed agent
                agent_progress = 45 + (completed_tasks / len(tasks)) * 15  # 45% to 60%
                yield {
                    "step": "agent_execution",
                    "status": "processing",
                    "message": f"Completed {completed_tasks}/{len(tasks)} analysis agents...",
                    "progress": int(agent_progress)
                }
                logger.log_message(f"Done with agent {completed_tasks}/{len(tasks)}")

            yield {
                "step": "agent_execution",
                "status": "completed", 
                "message": "All analysis agents completed",
                "progress": 60
            }
            
            # Step 4: Code synthesis (80% progress)
            yield {
                "step": "code_synthesis",
                "status": "processing",
                "message": "Analyzing code...",
                "progress": 65
            }
            
            # Safely extract code from agent outputs
            code = []
            for c in codes:
                try:
                    cleaned_code = remove_main_block(c)
                    if "```python" in cleaned_code:
                        parts = cleaned_code.split("```python")
                        if len(parts) > 1:
                            extracted = parts[1].split("```")[0] if "```" in parts[1] else parts[1]
                            code.append(extracted.replace('try\n','try:\n'))
                        else:
                            code.append(cleaned_code.replace('try\n','try:\n'))
                    else:
                        code.append(cleaned_code.replace('try\n','try:\n'))
                except Exception as e:
                    logger.log_message(f"Warning: Error processing code block: {e}", logging.WARNING)
                    code.append(c.replace('try\n','try:\n'))
            
            # Create deep coder without asyncify to avoid source inspection issues
            def create_score_code_with_datasets(datasets):
                """
                Creates a score function that includes the session datasets.
                
                Args:
                    datasets: Dictionary of datasets from session_state['datasets']
                    
                Returns:
                    A reward function compatible with dspy.Refine
                """
                def score_code_with_datasets(args, pred):
                    return score_code(args, pred, datasets)  # FIXED: Use positional argument
                
                return score_code_with_datasets

            # Then in your deep analysis method:
            # Create score function with datasets
            score_fn = create_score_code_with_datasets(self.datasets)
            deep_coder = dspy.Refine(module=self.deep_code_synthesizer_sync, N=5, reward_fn=score_fn, threshold=1.0, fail_count=10)
            
            # Check if we have valid API key
            anthropic_key = os.environ.get('ANTHROPIC_API_KEY')
            if not anthropic_key:
                raise ValueError("ANTHROPIC_API_KEY environment variable is not set")
            
            try:
                # Create the LM instance that will be used
                thread_lm = dspy.LM("anthropic/claude-sonnet-4-20250514", api_key=anthropic_key, max_tokens=17000)
                
                logger.log_message("Starting code generation...")
                start_time = datetime.datetime.now()
                logger.log_message(f"Code generation started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
                
                # Define the blocking function to run in thread
                def run_deep_coder():
                    with dspy.context(lm=thread_lm):
                        return deep_coder(
                            deep_questions=str(questions.deep_questions), 
                            dataset_info=dataset_info,
                            planner_instructions=str(plan_instructions), 
                            code=str(code)
                        )
                
                # Use asyncio.to_thread for better async integration
                deep_code = await asyncio.to_thread(run_deep_coder)
                
                logger.log_message(f"Code generation completed at: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            except Exception as e:
                logger.log_message(f"Error during code generation: {str(e)}", logging.ERROR)
                raise e

            code = deep_code.combined_code
            code = code.replace('```python', '').replace('```', '')
            
            # Clean Unicode characters that might cause encoding issues
            code = clean_unicode_chars(code)
            
            yield {
                "step": "code_synthesis",
                "status": "completed",
                "message": "Code synthesis completed",
                "progress": 80
            }
            
            # Step 5: Execute code (85% progress)
            yield {
                "step": "code_execution",
                "status": "processing",
                "message": "Executing code...",
                "progress": 82
            }
            
            # Execute the code with error handling and session DataFrame
            try:
                # Run code execution in thread pool to avoid blocking
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(clean_and_store_code, code, session_datasets)
                    output = future.result(timeout=300)  # 5 minute timeout
                
                logger.log_message(f"Deep Code executed")
                
                if output.get('error'):
                    logger.log_message(f"Warning: Code execution had errors: {output['error']}", logging.ERROR)
                
                print_outputs = [output['printed_output']]
                plotly_figs = [output['plotly_figs']]
                
            except Exception as e:
                logger.log_message(f"Error during code execution: {str(e)}", logging.ERROR)
                output = {
                    'exec_result': None,
                    'printed_output': f"Code execution failed: {str(e)}",
                    'plotly_figs': [],
                    'error': str(e)
                }
                print_outputs = [output['printed_output']]
                plotly_figs = [output['plotly_figs']]

            yield {
                "step": "code_execution",
                "status": "completed",
                "message": "Code execution completed",
                "progress": 85
            }
            
            # Step 6: Synthesis (90% progress)
            yield {
                "step": "synthesis",
                "status": "processing",
                "message": "Synthesizing results...",
                "progress": 87
            }
            
            synthesis = []
            try:
                synthesis_result = await self.deep_synthesizer(
                    query=goal, 
                    summaries=str(summaries), 
                    print_outputs=str(output['printed_output'])
                )
                synthesis.append(synthesis_result)
            except Exception as e:
                logger.log_message(f"Error during synthesis: {str(e)}", logging.ERROR)
                synthesis.append(type('obj', (object,), {'synthesized_report': f"Synthesis failed: {str(e)}"})())
            
            logger.log_message("Synthesis done")
            
            yield {
                "step": "synthesis",
                "status": "completed",
                "message": "Synthesis completed",
                "progress": 90
            }
            
            # Step 7: Final conclusion (100% progress)
            yield {
                "step": "conclusion",
                "status": "processing",
                "message": "Generating final conclusion...",
                "progress": 95
            }
            
            try:
                final_conclusion = await self.final_conclusion(
                    query=goal, 
                    synthesized_sections=str([s.synthesized_report for s in synthesis])
                )
            except Exception as e:
                logger.log_message(f"Error during final conclusion: {str(e)}", logging.ERROR)
                final_conclusion = type('obj', (object,), {'final_conclusion': f"Final conclusion failed: {str(e)}"})()

            logger.log_message("Conclusion Made")
            
            return_dict = {
                'goal': goal, 
                'deep_questions': questions.deep_questions, 
                'deep_plan': deep_plan.plan_instructions, 
                'summaries': summaries, 
                'code': code,
                'plotly_figs': plotly_figs,
                'synthesis': [s.synthesized_report for s in synthesis], 
                'final_conclusion': final_conclusion.final_conclusion 
            }
            
            yield {
                "step": "conclusion",
                "status": "completed",
                "message": "Analysis completed successfully",
                "progress": 100,
                "final_result": return_dict
            }
            
            logger.log_message("Return dict created")
            
        except Exception as e:
            logger.log_message(f"Error in deep analysis: {str(e)}", logging.ERROR)
            yield {
                "step": "error",
                "status": "failed",
                "message": f"Deep analysis failed: {str(e)}",
                "progress": 0,
                "error": str(e)
            }


    async def execute_deep_analysis(self, goal, dataset_info, session_df=None):
        """
        Legacy method for backward compatibility.
        Executes the streaming analysis and returns the final result.
        """
        final_result = None
        async for update in self.execute_deep_analysis_streaming(goal, dataset_info, session_df):
            if update.get("step") == "conclusion" and update.get("status") == "completed":
                final_result = update.get("final_result")
            elif update.get("step") == "error":
                raise Exception(update.get("message", "Unknown error"))
        
        return final_result