import logging
import pandas as pd
from typing import Dict

from src.agents.agents import dataset_description_agent, data_context_gen
from src.utils.model_registry import mid_lm
from src.utils.logger import Logger
import dspy

# Initialize logger
logger = Logger("dataset_description_generator", see_time=False, console_log=False)

def generate_dataset_description(datasets: Dict[str, pd.DataFrame], existing_description: str = "", dataset_names: list = None) -> str:
    """
    Generate AI-powered description for datasets
    
    Args:
        datasets: Dictionary of dataset names to DataFrames
        existing_description: Existing description to improve upon (optional)
        dataset_names: List of dataset names to use in the description format (optional)
        
    Returns:
        Generated description string with proper exact_python_name formatting
    """
    try:
        if not datasets or len(datasets) == 0:
            return existing_description
        
        # Build dataset view for description generation
        dataset_view = ""
        count = 0
        for table_name, table_df in datasets.items():
            head_data = table_df.head(3)
            columns = [{col: str(head_data[col].dtype)} for col in head_data.columns]
            dataset_view += f"exact_table_name={table_name}\n:columns:{str(columns)}\n{head_data.to_markdown()}\n"
            count += 1
        
        # Generate description using AI
        with dspy.context(lm=mid_lm):
            if count == 1:
                data_context = dspy.Predict(dataset_description_agent)(
                    existing_description=existing_description,
                    dataset=dataset_view
                )
                generated_desc = data_context.description
            elif count > 1:
                data_context = dspy.Predict(data_context_gen)(
                    user_description=existing_description,
                    dataset_view=dataset_view
                )
                generated_desc = data_context.data_context
            else:
                generated_desc = existing_description
        
        # Format the description with exact_python_name for all datasets
        if dataset_names and len(dataset_names) > 0:
            if len(dataset_names) == 1:
                # Single dataset format
                formatted_desc = f" exact_python_name: `{dataset_names[0]}` Dataset: {generated_desc}"
            else:
                # Multiple datasets format - list all dataset names
                names_list = ", ".join([f"`{name}`" for name in dataset_names])
                formatted_desc = f" exact_python_name: {names_list} Dataset: {generated_desc}"
        else:
            # Fallback to original format if no dataset names provided
            dataset_keys = list(datasets.keys())
            if len(dataset_keys) == 1:
                formatted_desc = f" exact_python_name: `{dataset_keys[0]}` Dataset: {generated_desc}"
            else:
                names_list = ", ".join([f"`{name}`" for name in dataset_keys])
                formatted_desc = f" exact_python_name: {names_list} Dataset: {generated_desc}"
        
        logger.log_message(f"Successfully generated dataset description for {count} dataset(s)", level=logging.INFO)
        return formatted_desc
        
    except Exception as e:
        logger.log_message(f"Failed to generate dataset description: {str(e)}", level=logging.WARNING)
        # Return existing description if generation fails
        return existing_description
