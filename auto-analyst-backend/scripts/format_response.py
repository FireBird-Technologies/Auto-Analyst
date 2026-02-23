import re
import json
import sys
import contextlib
from io import StringIO
import time
import logging
from src.utils.logger import Logger
import textwrap

logger = Logger(__name__, level=logging.INFO, see_time=False, console_log=False)

@contextlib.contextmanager
def stdoutIO(stdout=None):
    old = sys.stdout
    if stdout is None:
        stdout = StringIO()
    sys.stdout = stdout
    yield stdout
    sys.stdout = old
    
# Precompile regex patterns for better performance
SENSITIVE_MODULES = re.compile(r"(os|sys|subprocess|dotenv|requests|http|socket|smtplib|ftplib|telnetlib|paramiko)")
IMPORT_PATTERN = re.compile(r"^\s*import\s+(" + SENSITIVE_MODULES.pattern + r").*?(\n|$)", re.MULTILINE)
FROM_IMPORT_PATTERN = re.compile(r"^\s*from\s+(" + SENSITIVE_MODULES.pattern + r").*?(\n|$)", re.MULTILINE)
DYNAMIC_IMPORT_PATTERN = re.compile(r"__import__\s*\(\s*['\"](" + SENSITIVE_MODULES.pattern + r")['\"].*?\)")
ENV_ACCESS_PATTERN = re.compile(r"(os\.getenv|os\.environ|load_dotenv|\.__import__\s*\(\s*['\"]os['\"].*?\.environ)")
FILE_ACCESS_PATTERN = re.compile(r"(open\(|read\(|write\(|file\(|with\s+open)")

# Enhanced API key detection patterns
API_KEY_PATTERNS = [
    # Direct key assignments
    re.compile(r"(?i)(api_?key|access_?token|secret_?key|auth_?token|password|credential|secret)s?\s*=\s*[\"\'][\w\-\+\/\=]{8,}[\"\']"),
    # Function calls with keys
    re.compile(r"(?i)\.set_api_key\(\s*[\"\'][\w\-\+\/\=]{8,}[\"\']"),
    # Dictionary assignments
    re.compile(r"(?i)['\"](?:api_?key|access_?token|secret_?key|auth_?token|password|credential|secret)['\"](?:\s*:\s*)[\"\'][\w\-\+\/\=]{8,}[\"\']"),
    # Common key formats (base64-like, hex)
    re.compile(r"[\"\'](?:[A-Za-z0-9\+\/\=]{32,}|[0-9a-fA-F]{32,})[\"\']"),
    # Bearer token pattern
    re.compile(r"[\"\'](Bearer\s+[\w\-\+\/\=]{8,})[\"\']"),
    # Inline URL with auth
    re.compile(r"https?:\/\/[\w\-\+\/\=]{8,}@")
]

# Network request patterns
NETWORK_REQUEST_PATTERNS = re.compile(r"(requests\.|urllib\.|http\.client|httpx\.|socket\.connect\()")

# DataFrame creation with hardcoded data - block only this specific pattern

def check_security_concerns(code_str, dataset_names):
    """Check code for security concerns and return info about what was found"""
    security_concerns = {
        "has_concern": False,
        "blocked_imports": False,
        "blocked_dynamic_imports": False,
        "blocked_env_access": False,
        "blocked_file_access": False,
        "blocked_api_keys": False,
        "blocked_network": False,
        "blocked_dataframe_invention": False,  # Add this new field
        "messages": []
    }

    dataset_names_pattern = "|".join(re.escape(name) for name in dataset_names)
    DATAFRAME_INVENTION_PATTERN = re.compile(
                rf"({dataset_names_pattern})\s*=\s*pd\.DataFrame\s*\(\s*\{{\s*[^}}]*\}}", 
                re.MULTILINE
            )
    if DATAFRAME_INVENTION_PATTERN.search(code_str):
        security_concerns["has_concern"] = True
        security_concerns["blocked_dataframe_invention"] = True
        security_concerns["messages"].append(f"DataFrame creation blocked for dataset variables: {', '.join(dataset_names)}")
    
    # Check for sensitive imports
    if IMPORT_PATTERN.search(code_str) or FROM_IMPORT_PATTERN.search(code_str):
        security_concerns["has_concern"] = True
        security_concerns["blocked_imports"] = True
        security_concerns["messages"].append("Sensitive module imports blocked")
    
    # Check for __import__ bypass technique
    if DYNAMIC_IMPORT_PATTERN.search(code_str):
        security_concerns["has_concern"] = True
        security_concerns["blocked_dynamic_imports"] = True
        security_concerns["messages"].append("Dynamic import of sensitive modules blocked")
    
    # Check for environment variables access
    if ENV_ACCESS_PATTERN.search(code_str):
        security_concerns["has_concern"] = True
        security_concerns["blocked_env_access"] = True
        security_concerns["messages"].append("Environment variables access blocked")
    
    # Check for file operations
    if FILE_ACCESS_PATTERN.search(code_str):
        security_concerns["has_concern"] = True
        security_concerns["blocked_file_access"] = True
        security_concerns["messages"].append("File operations blocked")
    
    # Check for API key patterns
    for pattern in API_KEY_PATTERNS:
        if pattern.search(code_str):
            security_concerns["has_concern"] = True
            security_concerns["blocked_api_keys"] = True
            security_concerns["messages"].append("API key/token usage blocked")
            break
    
    # Check for network requests
    if NETWORK_REQUEST_PATTERNS.search(code_str):
        security_concerns["has_concern"] = True
        security_concerns["blocked_network"] = True
        security_concerns["messages"].append("Network requests blocked")
    
    
    
    return security_concerns

def clean_code_for_security(code_str, security_concerns, dataset_names):
    """Apply security modifications to the code based on detected concerns"""

    modified_code = code_str
    dataset_names_pattern = "|".join(re.escape(name) for name in dataset_names)
    DATAFRAME_INVENTION_PATTERN = re.compile(
                rf"({dataset_names_pattern})\s*=\s*pd\.DataFrame\s*\(\s*\{{\s*[^}}]*\}}", 
                re.MULTILINE
            )
    
    # Block sensitive imports if needed
    if security_concerns["blocked_imports"]:
        modified_code = IMPORT_PATTERN.sub(r'# BLOCKED: import \1\n', modified_code)
        modified_code = FROM_IMPORT_PATTERN.sub(r'# BLOCKED: from \1\n', modified_code)
    
    # Block dynamic imports if needed
    if security_concerns["blocked_dynamic_imports"]:
        modified_code = DYNAMIC_IMPORT_PATTERN.sub(r'"BLOCKED_DYNAMIC_IMPORT"', modified_code)
    
    # Block environment access if needed
    if security_concerns["blocked_env_access"]:
        modified_code = ENV_ACCESS_PATTERN.sub(r'"BLOCKED_ENV_ACCESS"', modified_code)
    
    # Block file operations if needed
    if security_concerns["blocked_file_access"]:
        modified_code = FILE_ACCESS_PATTERN.sub(r'"BLOCKED_FILE_ACCESS"', modified_code)
    
    # Block API keys if needed
    if security_concerns["blocked_api_keys"]:
        for pattern in API_KEY_PATTERNS:
            modified_code = pattern.sub(r'"BLOCKED_API_KEY"', modified_code)
    
    # Block network requests if needed
    if security_concerns["blocked_network"]:
        modified_code = NETWORK_REQUEST_PATTERNS.sub(r'"BLOCKED_NETWORK_REQUEST"', modified_code)
    
    # Block DataFrame creation with hardcoded data if detected
    if security_concerns["blocked_dataframe_invention"]:
        modified_code = DATAFRAME_INVENTION_PATTERN.sub(
            r"# BLOCKED_DATAFRAME_INVENTION: \g<0>", 
            modified_code
        )
    
    # Add warning banner if needed
    if security_concerns["has_concern"]:
        security_message = "⚠️ SECURITY WARNING: " + ". ".join(security_concerns["messages"]) + "."
        modified_code = f"print('{security_message}')\n\n" + modified_code
    
    return modified_code
    
def format_correlation_output(text):
    """Format correlation matrix output for better readability"""
    lines = text.split('\n')
    formatted_lines = []
    
    for line in lines:
        # Skip empty lines at the beginning
        if not line.strip() and not formatted_lines:
            continue
        
        if not line.strip():
            formatted_lines.append(line)
            continue
        
        # Check if this line contains correlation values or variable names
        stripped_line = line.strip()
        parts = stripped_line.split()
        
        if len(parts) > 1:
            # Check if this is a header line with variable names
            if all(part.replace('_', '').replace('-', '').isalpha() for part in parts):
                # This is a header row with variable names
                formatted_header = f"{'':12}"  # Empty first column for row labels
                for part in parts:
                    formatted_header += f"{part:>12}"
                formatted_lines.append(formatted_header)
            elif any(char.isdigit() for char in stripped_line) and ('.' in stripped_line or '-' in stripped_line):
                # This looks like a correlation line with numbers
                row_name = parts[0] if parts else ""
                values = parts[1:] if len(parts) > 1 else []
                
                formatted_row = f"{row_name:<12}"
                for value in values:
                    try:
                        val = float(value)
                        formatted_row += f"{val:>12.3f}"
                    except ValueError:
                        formatted_row += f"{value:>12}"
                
                formatted_lines.append(formatted_row)
            else:
                # Other lines (like titles)
                formatted_lines.append(line)
        else:
            formatted_lines.append(line)
    
    return '\n'.join(formatted_lines)

def format_summary_stats(text):
    """Format summary statistics for better readability"""
    lines = text.split('\n')
    formatted_lines = []
    
    for line in lines:
        if not line.strip():
            formatted_lines.append(line)
            continue
        
        # Check if this is a header line with statistical terms only (missing first column)
        stripped_line = line.strip()
        if any(stat in stripped_line.lower() for stat in ['count', 'mean', 'median', 'std', 'min', 'max', '25%', '50%', '75%']):
            parts = stripped_line.split()
            # Check if this is a header row (starts with statistical terms)
            if parts and parts[0].lower() in ['count', 'mean', 'median', 'std', 'min', 'max', '25%', '50%', '75%']:
                # This is a header row - add proper spacing
                formatted_header = f"{'':12}"  # Empty first column for row labels
                for part in parts:
                    formatted_header += f"{part:>15}"
                formatted_lines.append(formatted_header)
            else:
                # This is a data row - format normally
                row_name = parts[0] if parts else ""
                values = parts[1:] if len(parts) > 1 else []
                
                formatted_row = f"{row_name:<12}"
                for value in values:
                    try:
                        if '.' in value or 'e' in value.lower():
                            val = float(value)
                            if abs(val) >= 1000000:
                                formatted_row += f"{val:>15.2e}"
                            elif abs(val) >= 1:
                                formatted_row += f"{val:>15.2f}"
                            else:
                                formatted_row += f"{val:>15.6f}"
                        else:
                            val = int(value)
                            formatted_row += f"{val:>15}"
                    except ValueError:
                        formatted_row += f"{value:>15}"
                
                formatted_lines.append(formatted_row)
        else:
            # Other lines (titles, etc.) - keep as is
            formatted_lines.append(line)
    
    return '\n'.join(formatted_lines)
    
def clean_print_statements(code_block):
    """
    This function cleans up any `print()` statements that might contain unwanted `\n` characters.
    It ensures print statements are properly formatted without unnecessary newlines.
    """
    # This regex targets print statements, even if they have newlines inside
    return re.sub(r'print\((.*?)(\\n.*?)(.*?)\)', r'print(\1\3)', code_block, flags=re.DOTALL)

def remove_code_block_from_summary(summary):
    # use regex to remove code block from summary list
    summary = re.sub(r'```python\n(.*?)\n```', '', summary)
    return summary.split("\n")

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


def format_code_block(code_str):
    code_clean = re.sub(r'^```python\n?', '', code_str, flags=re.MULTILINE)
    code_clean = re.sub(r'\n```$', '', code_clean)
    return f'\n{code_clean}\n'

def format_code_backticked_block(code_str):
    # Add None check at the beginning
    if code_str is None:
        return "```python\n# No code available\n```"  # Return empty code block instead of None
    
    # Add type check to ensure it's a string
    if not isinstance(code_str, str):
        return f"```python\n# Invalid code type: {type(code_str)}\n```"
    
    code_clean = re.sub(r'^```python\n?', '', code_str, flags=re.MULTILINE)
    code_clean = re.sub(r'\n```$', '', code_clean)
    # Only match assignments at top level (not indented)
    # 1. Remove 'df = pd.DataFrame()' if it's at the top level
  
  
    # Remove reading the csv file if it's already in the context
    modified_code = re.sub(r"df\s*=\s*pd\.read_csv\([\"\'].*?[\"\']\).*?(\n|$)", '', code_clean)
    modified_code = re.sub(r'^(\s*)(df\s*=.*)$', r'\1# \2', code_clean, flags=re.MULTILINE)
    
    # Only match assignments at top level (not indented)
    # 1. Remove 'df = pd.DataFrame()' if it's at the top level
    modified_code = re.sub(
        r"^df\s*=\s*pd\.DataFrame\(\s*\)\s*(#.*)?$",
        '',
        modified_code,
        flags=re.MULTILINE
    )

    # # Remove sample dataframe lines with multiple array values
    modified_code = re.sub(r"^# Sample DataFrames?.*?(\n|$)", '', modified_code, flags=re.MULTILINE | re.IGNORECASE)
    
    # # Remove plt.show() statements
    modified_code = re.sub(r"plt\.show\(\).*?(\n|$)", '', modified_code)
    
    
    # remove main
    code_clean = remove_main_block(modified_code)
    
    return f'```python\n{code_clean}\n```'

    
def execute_code_from_markdown(code_str, datasets=None):
    import pandas as pd
    import plotly.express as px
    import plotly
    import plotly.graph_objects as go
    import matplotlib.pyplot as plt
    import seaborn as sns
    import numpy as np
    import re
    import traceback
    import sys
    from io import StringIO, BytesIO
    import base64

    context_names = list(datasets.keys())
    # Check for security concerns in the code
    security_concerns = check_security_concerns(code_str, context_names)
    
    # Apply security modifications to the code
    modified_code = clean_code_for_security(code_str, security_concerns, context_names)
    
    # Enhanced print function that detects and formats tabular data
    captured_outputs = []
    original_print = print
    
    # Set pandas display options for full table display
    pd.set_option('display.max_columns', None)
    pd.set_option('display.max_rows', 20)  # Limit to 20 rows instead of unlimited
    pd.set_option('display.width', None)
    pd.set_option('display.max_colwidth', 50)
    pd.set_option('display.expand_frame_repr', False)
    

    
    def enhanced_print(*args, **kwargs):
        # Convert all args to strings
        str_args = [str(arg) for arg in args]
        output_text = kwargs.get('sep', ' ').join(str_args)
        
        # Special case for DataFrames - use pipe delimiter and clean format
        if isinstance(args[0], pd.DataFrame) and len(args) == 1:
            # Format DataFrame with pipe delimiter using to_csv for reliable column separation
            df = args[0]
            
            # Use StringIO to capture CSV output with pipe delimiter
            from io import StringIO
            csv_buffer = StringIO()
            
            # Export to CSV with pipe delimiter, preserving index
            df.to_csv(csv_buffer, sep='|', index=True, float_format='%.6g')
            csv_output = csv_buffer.getvalue()
            
            # Clean up the CSV output - remove quotes and extra formatting
            lines = csv_output.strip().split('\n')
            cleaned_lines = []
            
            for line in lines:
                # Remove any quotes that might have been added by to_csv
                clean_line = line.replace('"', '')
                # Split by pipe, strip whitespace from each part, then rejoin
                parts = [part.strip() for part in clean_line.split('|')]
                cleaned_lines.append(' | '.join(parts))
            
            output_text = '\n'.join(cleaned_lines)
            captured_outputs.append(f"<TABLE_START>\n{output_text}\n<TABLE_END>")
            original_print(output_text)
            return
        
        # Detect if this looks like tabular data (generic approach)
        is_table = False
        
        # Check for table patterns:
        # 1. Multiple lines with consistent spacing
        lines = output_text.split('\n')
        if len(lines) > 2:
            # Count lines that look like they have multiple columns (2+ spaces between words)
            multi_column_lines = sum(1 for line in lines if len(line.split()) > 1 and '  ' in line)
            if multi_column_lines >= 2:  # At least 2 lines with multiple columns
                is_table = True
            
            # Check for pandas DataFrame patterns like index with column names
            if any(re.search(r'^\s*\d+\s+', line) for line in lines):
                # Look for lines starting with an index number followed by spaces
                is_table = True
                
            # Look for table-like structured output with multiple rows of similar format
            if len(lines) >= 3:
                # Sample a few lines to check for consistent structure
                sample_lines = [lines[i] for i in range(min(len(lines), 5)) if i < len(lines) and lines[i].strip()]
                
                # Check for consistent whitespace patterns
                if len(sample_lines) >= 2:
                    # Get positions of whitespace groups in first line
                    whitespace_positions = []
                    for i, line in enumerate(sample_lines):
                        if not line.strip():
                            continue
                        positions = [m.start() for m in re.finditer(r'\s{2,}', line)]
                        if i == 0:
                            whitespace_positions = positions
                        elif len(positions) == len(whitespace_positions):
                            # Check if whitespace positions are roughly the same
                            is_similar = all(abs(pos - whitespace_positions[j]) <= 3 
                                            for j, pos in enumerate(positions) 
                                            if j < len(whitespace_positions))
                            if is_similar:
                                is_table = True
        
        # 2. Contains common table indicators
        if any(indicator in output_text.lower() for indicator in [
            'count', 'mean', 'std', 'min', 'max', '25%', '50%', '75%',  # Summary stats
            'correlation', 'corr',  # Correlation tables
            'coefficient', 'r-squared', 'p-value',  # Regression tables
        ]):
            is_table = True
        
        # 3. Has many decimal numbers (likely a data table)
        if output_text.count('.') > 5 and len(lines) > 2:
            is_table = True
            
        # If we have detected a table, convert space-delimited to pipe-delimited format
        if is_table:
            # Convert the table to pipe-delimited format for better parsing in frontend
            formatted_lines = []
            for line in lines:
                if not line.strip():
                    formatted_lines.append(line)  # Keep empty lines
                    continue
                
                # Split by multiple spaces and join with pipe delimiter
                parts = re.split(r'\s{2,}', line.strip())
                if parts:
                    formatted_lines.append(" | ".join(parts))
                else:
                    formatted_lines.append(line)
            
            # Use the pipe-delimited format
            output_text = "\n".join(formatted_lines)
            
            # Format and mark the output for table processing in UI
            captured_outputs.append(f"<TABLE_START>\n{output_text}\n<TABLE_END>")
        else:
            captured_outputs.append(output_text)
        
        # Also use original print for stdout capture
        original_print(*args, **kwargs)

    # Custom matplotlib capture function
    def capture_matplotlib_chart():
        """Capture current matplotlib figure as base64 encoded image"""
        try:
            fig = plt.gcf()  # Get current figure
            if fig.get_axes():  # Check if figure has any plots
                buffer = BytesIO()
                fig.savefig(buffer, format='png', dpi=150, bbox_inches='tight', 
                           facecolor='white', edgecolor='none')
                buffer.seek(0)
                img_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
                buffer.close()
                plt.close(fig)  # Close the figure to free memory
                return img_base64
            return None
        except Exception:
            return None

    # Store original plt.show function
    original_plt_show = plt.show
    
    def custom_plt_show(*args, **kwargs):
        """Custom plt.show that captures the chart instead of displaying it"""
        img_base64 = capture_matplotlib_chart()
        if img_base64:
            matplotlib_outputs.append(img_base64)
        # Don't call original show to prevent display
    
    context = {
        'pd': pd,
        'px': px,
        'go': go,
        'plt': plt,
        'plotly': plotly,
        '__builtins__': __builtins__,
        '__import__': __import__,
        'sns': sns,
        'np': np,
        'json_outputs': [],  # List to store multiple Plotly JSON outputs
        'matplotlib_outputs': [],  # List to store matplotlib chart images as base64
        'print': enhanced_print  # Replace print with our enhanced version
    }
    
    # Add matplotlib_outputs to local scope for the custom show function
    matplotlib_outputs = context['matplotlib_outputs']
    
    # Replace plt.show with our custom function
    plt.show = custom_plt_show
    
    

    # Modify code to store multiple JSON outputs
    modified_code = re.sub(
        r'(\w*_?)fig(\w*)\.show\(\)',
        r'json_outputs.append(plotly.io.to_json(\1fig\2, pretty=True))',
        modified_code
    )

    modified_code = re.sub(
        r'(\w*_?)fig(\w*)\.to_html\(.*?\)',
        r'json_outputs.append(plotly.io.to_json(\1fig\2, pretty=True))',
        modified_code
    )    
    # Remove reading the csv file if it's already in the context
    modified_code = re.sub(r"df\s*=\s*pd\.read_csv\([\"\'].*?[\"\']\).*?(\n|$)", '', modified_code)
    
    # Only match assignments at top level (not indented)
    # 1. Remove 'df = pd.DataFrame()' if it's at the top level
    modified_code = re.sub(
        r"^df\s*=\s*pd\.DataFrame\(\s*\)\s*(#.*)?$",
        '',
        modified_code,
        flags=re.MULTILINE
    )
    

    # Custom display function for DataFrames to show head + tail for large datasets
    original_repr = pd.DataFrame.__repr__
    
    def custom_df_repr(self):
        if len(self) > 15:
            # For large DataFrames, show first 10 and last 5 rows
            head_part = self.head(10)
            tail_part = self.tail(5)
            
            head_str = head_part.__repr__()
            tail_str = tail_part.__repr__()
            
            # Extract just the data rows (skip the header from tail)
            tail_lines = tail_str.split('\n')
            tail_data = '\n'.join(tail_lines[1:])  # Skip header line
            
            return f"{head_str}\n...\n{tail_data}"
        else:
            return original_repr(self)
    
    # Apply custom representation temporarily
    pd.DataFrame.__repr__ = custom_df_repr

    # If a dataframe is provided, add it to the context
    for dataset_name, dataset_df in datasets.items():
        if dataset_df is not None:
            context[dataset_name] = dataset_df
            logger.log_message(f"Added dataset '{dataset_name}' to execution context", level=logging.DEBUG)


    # remove pd.read_csv() if it's already in the context
    modified_code = re.sub(r"pd\.read_csv\(\s*[\"\'].*?[\"\']\s*\)", '', modified_code)

    # Remove sample dataframe lines with multiple array values
    modified_code = re.sub(r"^# Sample DataFrames?.*?(\n|$)", '', modified_code, flags=re.MULTILINE | re.IGNORECASE)
    
    # Replace plt.savefig() calls with plt.show() to ensure plots are displayed
    modified_code = re.sub(r'plt\.savefig\([^)]*\)', 'plt.show()', modified_code)
    
    # Instead of removing plt.show(), keep them - they'll be handled by our custom function
    # Also handle seaborn plots that might not have explicit plt.show()
    # Add plt.show() after seaborn plot functions if not already present
    seaborn_plot_functions = [
        'sns.scatterplot', 'sns.lineplot', 'sns.barplot', 'sns.boxplot', 'sns.violinplot',
        'sns.stripplot', 'sns.swarmplot', 'sns.pointplot', 'sns.catplot', 'sns.relplot',
        'sns.displot', 'sns.histplot', 'sns.kdeplot', 'sns.ecdfplot', 'sns.rugplot',
        'sns.distplot', 'sns.jointplot', 'sns.pairplot', 'sns.FacetGrid', 'sns.PairGrid',
        'sns.heatmap', 'sns.clustermap', 'sns.regplot', 'sns.lmplot', 'sns.residplot'
    ]
    
    # Add automatic plt.show() after seaborn plots if not already present
    for func in seaborn_plot_functions:
        pattern = rf'({re.escape(func)}\([^)]*\)(?:\.[^(]*\([^)]*\))*)'
        def add_show(match):
            plot_call = match.group(1)
            # Check if the next non-empty line already has plt.show()
            return f'{plot_call}\nplt.show()'
        
        modified_code = re.sub(pattern, add_show, modified_code)
    
    # Only add df = pd.read_csv() if no dataframe was provided and the code contains pd.read_csv


    # Identify code blocks by comments
    code_blocks = []
    current_block = []
    current_block_name = "unknown"
    
    for line in modified_code.splitlines():
        # Check if line contains a block identifier comment
        block_match = re.match(r'^# ([a-zA-Z_]+)_agent code start', line)
        if block_match:
            # If we had a previous block, save it
            if current_block:
                code_blocks.append((current_block_name, '\n'.join(current_block)))
            # Start a new block
            current_block_name = block_match.group(1)
            current_block = []
        else:
            current_block.append(line)
    
    # Add the last block if it exists
    if current_block:
        code_blocks.append((current_block_name, '\n'.join(current_block)))
    
    # Execute each code block separately
    all_outputs = []
    for block_name, block_code in code_blocks:
        try:
            # Clear captured outputs for each block
            captured_outputs.clear()
            
            # Fix indentation issues before execution
            try:
                block_code = textwrap.dedent(block_code)
            except Exception as dedent_error:
                logger.log_message(f"Failed to dedent code block '{block_name}': {str(dedent_error)}", level=logging.WARNING)
            
            with stdoutIO() as s:
                exec(block_code, context)  # Execute the block
            
            # Get both stdout and our enhanced captured outputs
            stdout_output = s.getvalue()
            
            # Combine outputs, preferring our enhanced format when available
            if captured_outputs:
                combined_output = '\n'.join(captured_outputs)
            else:
                combined_output = stdout_output
            
            all_outputs.append((block_name, combined_output, None))  # None means no error
        except Exception as e:
            # Reset pandas options in case of error
            pd.reset_option('display.max_columns')
            pd.reset_option('display.max_rows')
            pd.reset_option('display.width')
            pd.reset_option('display.max_colwidth')
            pd.reset_option('display.expand_frame_repr')
            
            # Restore original DataFrame representation in case of error
            pd.DataFrame.__repr__ = original_repr
            
            # Restore original plt.show
            plt.show = original_plt_show
            
            error_traceback = traceback.format_exc()
            
            # Extract error message and error type
            error_message = str(e)
            error_type = type(e).__name__
            error_lines = error_traceback.splitlines()
            
            # Format error with context of the actual code
            formatted_error = f"Error in {block_name}_agent: {error_message}\n"
            
            # Add first few lines of traceback
            first_lines = error_lines[:3]
            formatted_error += "\n".join(first_lines) + "\n"
            
            # Parse problem variables/values from the error message
            problem_vars = []
            
            # Look for common error patterns
            if "not in index" in error_message:
                # Extract column names for 'not in index' errors
                column_match = re.search(r"\['([^']+)'(?:, '([^']+)')*\] not in index", error_message)
                if column_match:
                    problem_vars = [g for g in column_match.groups() if g is not None]
                    
                    # Look for DataFrame accessing operations and list/variable definitions
                    potential_lines = []
                    code_lines = block_code.splitlines()
                    
                    # First, find all DataFrame column access patterns
                    df_access_patterns = []
                    for i, line in enumerate(code_lines):
                        # Find DataFrame variables from patterns like "df_name[...]" or "df_name.loc[...]"
                        df_matches = re.findall(r'(\w+)(?:\[|\.)(?:loc|iloc|columns|at|iat|\.select)', line)
                        for df_var in df_matches:
                            df_access_patterns.append((i, df_var))
                        
                        # Find variables that might contain column lists
                        for var in problem_vars:
                            if re.search(r'\b(numeric_columns|categorical_columns|columns|features|cols)\b', line):
                                potential_lines.append(i)
                    
                    # Identify the most likely problematic lines
                    if df_access_patterns:
                        for i, df_var in df_access_patterns:
                            if any(re.search(rf'{df_var}\[.*?\]', line) for line in code_lines):
                                potential_lines.append(i)
                    
                    # If no specific lines found yet, look for any DataFrame operations
                    if not potential_lines:
                        for i, line in enumerate(code_lines):
                            if re.search(r'(?:corr|drop|groupby|pivot|merge|join|concat|apply|map|filter|loc|iloc)\(', line):
                                potential_lines.append(i)
                    
                    # Sort and deduplicate
                    potential_lines = sorted(set(potential_lines))
            elif "name" in error_message and "is not defined" in error_message:
                # Extract variable name for NameError
                var_match = re.search(r"name '([^']+)' is not defined", error_message)
                if var_match:
                    problem_vars = [var_match.group(1)]
            elif "object has no attribute" in error_message:
                # Extract attribute name for AttributeError
                attr_match = re.search(r"'([^']+)' object has no attribute '([^']+)'", error_message)
                if attr_match:
                    problem_vars = [f"{attr_match.group(1)}.{attr_match.group(2)}"]
            
            # Scan code for lines containing the problem variables
            if problem_vars:
                formatted_error += "\nProblem likely in these lines:\n"
                code_lines = block_code.splitlines()
                problem_lines = []
                
                # First try direct variable references
                direct_matches = False
                for i, line in enumerate(code_lines):
                    if any(var in line for var in problem_vars):
                        direct_matches = True
                        # Get line and its context (1 line before and after)
                        start_idx = max(0, i-1)
                        end_idx = min(len(code_lines), i+2)
                        
                        for j in range(start_idx, end_idx):
                            line_prefix = f"{j+1}: "
                            if j == i:  # The line with the problem variable
                                problem_lines.append(f"{line_prefix}>>> {code_lines[j]} <<<")
                            else:
                                problem_lines.append(f"{line_prefix}{code_lines[j]}")
                        
                        problem_lines.append("") # Empty line between sections
                
                # If no direct matches found but we identified potential problematic lines for DataFrame issues
                if not direct_matches and "not in index" in error_message and 'potential_lines' in locals():
                    for i in potential_lines:
                        start_idx = max(0, i-1)
                        end_idx = min(len(code_lines), i+2)
                        
                        for j in range(start_idx, end_idx):
                            line_prefix = f"{j+1}: "
                            if j == i:
                                problem_lines.append(f"{line_prefix}>>> {code_lines[j]} <<<")
                            else:
                                problem_lines.append(f"{line_prefix}{code_lines[j]}")
                        
                        problem_lines.append("") # Empty line between sections
                
                if problem_lines:
                    formatted_error += "\n".join(problem_lines)
                else:
                    # Special message for column errors when we can't find the exact reference
                    if "not in index" in error_message:
                        formatted_error += (f"Unable to locate direct reference to columns: {', '.join(problem_vars)}\n"
                                           f"Check for variables that might contain these column names (like numeric_columns, "
                                           f"categorical_columns, etc.)\n")
                    else:
                        formatted_error += f"Unable to locate lines containing: {', '.join(problem_vars)}\n"
            else:
                # If we couldn't identify specific variables, check for line numbers in traceback
                for line in reversed(error_lines):  # Search from the end of traceback
                    # Look for user code references in the traceback
                    if ', line ' in line and '<module>' in line:
                        try:
                            line_num = int(re.search(r', line (\d+)', line).group(1))
                            code_lines = block_code.splitlines()
                            if 0 < line_num <= len(code_lines):
                                line_idx = line_num - 1
                                start_idx = max(0, line_idx-2)
                                end_idx = min(len(code_lines), line_idx+3)
                                
                                formatted_error += "\nProblem at this location:\n"
                                for i in range(start_idx, end_idx):
                                    line_prefix = f"{i+1}: "
                                    if i == line_idx:
                                        formatted_error += f"{line_prefix}>>> {code_lines[i]} <<<\n"
                                    else:
                                        formatted_error += f"{line_prefix}{code_lines[i]}\n"
                                break
                        except (ValueError, AttributeError, IndexError):
                            pass
            
            # Add the last few lines of the traceback
            formatted_error += "\nFull error details:\n"
            last_lines = error_lines[-3:]
            formatted_error += "\n".join(last_lines)
            
            all_outputs.append((block_name, None, formatted_error))
    
    # Reset pandas options after execution
    pd.reset_option('display.max_columns')
    pd.reset_option('display.max_rows')
    pd.reset_option('display.width')
    pd.reset_option('display.max_colwidth')
    pd.reset_option('display.expand_frame_repr')
    
    # Restore original DataFrame representation
    pd.DataFrame.__repr__ = original_repr
    
    # Restore original plt.show
    plt.show = original_plt_show
    
    # Compile all outputs and errors
    output_text = ""
    json_outputs = context.get('json_outputs', [])
    matplotlib_outputs = context.get('matplotlib_outputs', [])
    error_found = False
    
    for block_name, output, error in all_outputs:
        if error:
            output_text += f"\n\n=== ERROR IN {block_name.upper()}_AGENT ===\n{error}\n"
            error_found = True
        elif output:
            output_text += f"\n\n=== OUTPUT FROM {block_name.upper()}_AGENT ===\n{output}\n"
    
    if error_found:
        return output_text, [], []
    else:
        return output_text, json_outputs, matplotlib_outputs
    
    
def format_plan_instructions(plan_instructions):
    """
    Format any plan instructions (JSON string or dict) into markdown sections per agent.
    """
    # Parse input into a dict

    if "basic_qa_agent" in str(plan_instructions):
        return "**Non-Data Request**: Please ask a data related query, don't waste credits!"


    try:
        if isinstance(plan_instructions, str):
            try:
                instructions = json.loads(plan_instructions)
            except json.JSONDecodeError as e:
                # Try to clean the string if it's not valid JSON
                cleaned_str = plan_instructions.strip()
                if cleaned_str.startswith("'") and cleaned_str.endswith("'"):
                    cleaned_str = cleaned_str[1:-1]
                try:
                    instructions = json.loads(cleaned_str)
                except json.JSONDecodeError:
                    raise ValueError(f"Invalid JSON format in plan instructions: {str(e)}")
        elif isinstance(plan_instructions, dict):
            instructions = plan_instructions
        else:
            raise TypeError(f"Unsupported plan instructions type: {type(plan_instructions)}")
    except Exception as e:
        raise ValueError(f"Error processing plan instructions: {str(e)} + {dspy.settings.lm} ")
    # logger.log_message(f"Plan instructions: {instructions}", level=logging.INFO)



    markdown_lines = []
    for agent, content in instructions.items():
        if agent != 'basic_qa_agent':
            agent_title = agent.replace('_', ' ').title()
            markdown_lines.append(f"#### {agent_title}")
            if isinstance(content, dict):
                # Handle 'create' key
                create_vals = content.get('create', [])
                if create_vals:
                    markdown_lines.append(f"- **Create**:")
                    for item in create_vals:
                        markdown_lines.append(f"  - {item}")
                else:
                    markdown_lines.append(f"- **Create**: None")
    
                # Handle 'use' key
                use_vals = content.get('use', [])
                if use_vals:
                    markdown_lines.append(f"- **Use**:")
                    for item in use_vals:
                        markdown_lines.append(f"  - {item}")
                else:
                    markdown_lines.append(f"- **Use**: None")
    
                # Handle 'instruction' key
                instr = content.get('instruction')
                if isinstance(instr, str) and instr:
                    markdown_lines.append(f"- **Instruction**: {instr}")
                else:
                    markdown_lines.append(f"- **Instruction**: None")
            else:
                # Fallback for non-dict content
                markdown_lines.append(f"- {content}")
            markdown_lines.append("")  # blank line between agents
        else:
            markdown_lines.append(f"**Non-Data Request**: {content.get('instruction')}")

    return "\n".join(markdown_lines).strip()
    
    # Return empty string if no complexity found
    return ""

def format_complexity(instructions):
    markdown_lines = []
    complexity = None  # Initialize complexity to avoid UnboundLocalError
    
    # Extract complexity from various possible locations in the structure
    if isinstance(instructions, dict):
        # Case 1: Direct complexity field
        if 'complexity' in instructions:
            complexity = instructions['complexity']
        # Case 2: Complexity in 'plan' object
        elif 'plan' in instructions and isinstance(instructions['plan'], dict):
            if 'complexity' in instructions['plan']:
                complexity = instructions['plan']['complexity']
        else:
            complexity = "unrelated"
            
        # Override for basic_qa_agent cases
        if 'plan' in instructions and isinstance(instructions['plan'], str) and "basic_qa_agent" in instructions['plan']:
            complexity = "unrelated"
    else:
        # If instructions is not a dict, default to unrelated
        complexity = "unrelated"
    
    if complexity:
        # Pink color scheme variations
        color_map = {
            "unrelated": "#FFB6B6",  # Light pink
            "basic": "#FF9E9E",      # Medium pink
            "intermediate": "#FF7F7F", # Main pink
            "advanced": "#FF5F5F"    # Dark pink
        }
        
        indicator_map = {
            "unrelated": "○",
            "basic": "●",
            "intermediate": "●●",
            "advanced": "●●●"
        }
        
        color = color_map.get(complexity.lower(), "#FFB6B6")  # Default to light pink
        indicator = indicator_map.get(complexity.lower(), "○")
        
        # Slightly larger display with pink styling
        markdown_lines.append(f"<div style='color: {color}; border: 2px solid {color}; padding: 2px 8px; border-radius: 12px; display: inline-block; font-size: 14.4px;'>{indicator} {complexity}</div>\n")

        return "\n".join(markdown_lines).strip()
    
    # Return empty string if no complexity found
    return ""

def format_response_to_markdown(api_response, agent_name = None, datasets=None):
    try:
        markdown = []
        # logger.log_message(f"API response for {agent_name} at {time.strftime('%Y-%m-%d %H:%M:%S')}: {api_response}", level=logging.INFO)

        if isinstance(api_response, dict):
            for key in api_response:
                if "error" in api_response[key] and "litellm.RateLimitError" in api_response[key]['error'].lower():
                    return f"**Error**: Rate limit exceeded. Please try switching models from the settings."
                # You can add more checks here if needed for other keys
                       
        # Handle error responses
        if isinstance(api_response, dict) and "error" in api_response:
            return f"**Error**: {api_response['error']}"
        if "response" in api_response and isinstance(api_response['response'], str):
            if any(err in api_response['response'].lower() for err in ["auth", "api", "lm"]):
                return "**Error**: Authentication failed. Please check your API key in settings and try again."
            if "model" in api_response['response'].lower():
                return "**Error**: Model configuration error. Please verify your model selection in settings."

        for agent, content in api_response.items():
            agent = agent.split("__")[0] if "__" in agent else agent
            if "memory" in agent or not content:
                continue
                
            if "complexity" in content:
                complexity_result = format_complexity(content)
                if complexity_result:  # Only append if not empty
                    markdown.append(f"{complexity_result}")
                
            markdown.append(f"\n## {agent.replace('_', ' ').title()}\n")
            
            if agent == "analytical_planner":
                logger.log_message(f"Analytical planner content: {content}", level=logging.INFO)
                if 'plan_desc' in content and content['plan_desc']:
                    markdown.append(f"### Reasoning {content['plan_desc']}")
                if 'plan_instructions' in content:
                    plan_result = format_plan_instructions(content['plan_instructions'])
                    if plan_result:  # Only append if not empty/None
                        markdown.append(f"{plan_result}")
                else:
                    if content.get('rationale'):
                        markdown.append(f"### Reasoning {content['rationale']}")
            else:  
                if "rationale" in content:
                    if content.get('rationale'):
                        markdown.append(f"### Reasoning{content['rationale']}")

            if 'code' in content and content['code'] is not None:
                formatted_code = format_code_backticked_block(content['code'])
                if formatted_code:  # Check if formatted_code is not None
                    markdown.append(f"### Code Implementation\n{formatted_code}\n")
            if 'answer' in content and content['answer']:
                markdown.append(f"### Answer{content['answer']} Please ask a query about the data")
            if 'summary' in content:
                import re
                summary_text = content['summary']
                summary_text = re.sub(r'```python\n(.*?)\n```', '', summary_text, flags=re.DOTALL)

                markdown.append("### Summary\n")

                # Extract pre-list intro, bullet points, and post-list text
                intro_match = re.split(r'\(\d+\)', summary_text, maxsplit=1)
                if len(intro_match) > 1:
                    intro_text = intro_match[0].strip()
                    rest_text = "(1)" + intro_match[1]  # reattach for bullet parsing
                else:
                    intro_text = summary_text.strip()
                    rest_text = ""

                if intro_text:
                    markdown.append(f"{intro_text}\n")

                # Split bullets at numbered items like (1)...(8)
                bullets = re.split(r'\(\d+\)', rest_text)
                bullets = [b.strip(" ,.\n") for b in bullets if b.strip()]

                # Check for post-list content (anything after the last number)
                for i, bullet in enumerate(bullets):
                    markdown.append(f"* {bullet}\n")




            if 'refined_complete_code' in content and 'summary' in content:
                try:
                    if content['refined_complete_code'] is not None and content['refined_complete_code'] != "":
                        clean_code = format_code_block(content['refined_complete_code']) 
                        markdown_code = format_code_backticked_block(content['refined_complete_code'])
                        output, json_outputs, matplotlib_outputs = execute_code_from_markdown(clean_code, datasets)
                    elif "```python" in content['summary']:
                        clean_code = format_code_block(content['summary'])
                        markdown_code = format_code_backticked_block(content['summary'])
                        output, json_outputs, matplotlib_outputs = execute_code_from_markdown(clean_code, datasets)
                except Exception as e:
                    logger.log_message(f"Error in execute_code_from_markdown: {str(e)}", level=logging.ERROR)
                    markdown_code = f"**Error**: {str(e)}"
                    output = None
                    json_outputs = []
                    matplotlib_outputs = []
                    # continue
                
                if markdown_code is not None:
                    markdown.append(f"### Refined Complete Code\n{markdown_code}\n")
                
                if output:
                    markdown.append("### Execution Output\n")
                    markdown.append(f"```output\n{output}\n```\n")
                    
                if json_outputs:
                    markdown.append("### Plotly JSON Outputs\n")
                    for idx, json_output in enumerate(json_outputs):
                        markdown.append(f"```plotly\n{json_output}\n```\n")
                        
                if matplotlib_outputs:
                    markdown.append("### Matplotlib/Seaborn Charts\n")
                    for idx, img_base64 in enumerate(matplotlib_outputs):
                        markdown.append(f"```matplotlib\n{img_base64}\n```\n")
            # if agent_name is not None:  
            #     if f"memory_{agent_name}" in api_response:
            #         markdown.append(f"### Memory\n{api_response[f'memory_{agent_name}']}\n")

    except Exception as e:
        logger.log_message(f"Error in format_response_to_markdown: {str(e)}", level=logging.ERROR)
        return f"error formating markdown {str(e)}"
        
    # logger.log_message(f"Generated markdown content for agent '{agent_name}' at {time.strftime('%Y-%m-%d %H:%M:%S')}: {markdown}, length: {len(markdown)}", level=logging.INFO)
    
    if not markdown or len(markdown) <= 1:
        logger.log_message(
            f"Invalid markdown content for agent '{agent_name}' at {time.strftime('%Y-%m-%d %H:%M:%S')}: "
            f"Content: '{markdown}', Type: {type(markdown)}, Length: {len(markdown) if markdown else 0}, "
            f"API Response: {api_response}",
            level=logging.ERROR
        )
        return ""
        
    return '\n'.join(markdown)


