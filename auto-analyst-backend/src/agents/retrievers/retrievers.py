# This file handles the data-preprocessing and creates retrievers

import pandas as pd
import numpy as np
from datetime import datetime

# instructions also stored here
instructions ="""
Here are the instructions for the AI system with the specified agents:

### AI System Instructions

#### Agents
- `@data_viz_agent`: Handles queries related to data visualization.
- `@sk_learn_agent`: Handles queries related to machine learning using scikit-learn.
- `@statistical_analytics_agent`: Handles queries related to statistical analysis.
- `@preprocessing_agent`: Handles queries related to data preprocessing.

#### Query Routing

1. **Direct Agent Routing**:
    - If the user specifies an agent in their query using `@agent_name`, the query will be directly routed to the specified agent.
    - Example: `@data_viz_agent Create a bar chart from the following data.`

2. **Planner-Based Routing**:
    - If the user does not specify an agent, the query will be routed to the system's planner.
    - The planner will analyze the query and determine the most appropriate agent to handle the request.
    - Example: `Generate a confusion matrix from this dataset.`

PLEASE READ THE INSTRUCTIONS! Thank you
"""

# For every column collects some useful information like top10 categories and min,max etc if applicable
def return_vals(df,c):
    if isinstance(df[c].iloc[10], (int, float, complex)):
        return {'max_value':max(df[c]),'min_value': min(df[c]), 'mean_value':np.mean(df[c])}
    elif(isinstance(df[c].iloc[10],datetime)):
        return {str(max(df[c])), str(min(df[c])), str(np.mean(df[c]))}
    else:
        return {'top_10_values':df[c].value_counts()[:10], 'total_categoy_count':len(df[c].unique())}
    
#removes `,` from numeric columns
def correct_num(df,c):
    try:
        df[c] = df[c].fillna('0').str.replace(',','').astype(float)
        return df[c]
    except:
        return df[c]



# does most of the pre-processing
def make_data(df, desc):
    dict_ = {}
    dict_['dataset_python_name'] = "The data is loaded as df"       
    dict_['Description'] = desc
    # dict_['all_column_names'] = str(list(df.columns[:20]))

    # for c in df.columns:
    #     df[c] = correct_num(df,c)
    #     try:
    #         dict_[c] = {'column_name':c,'type':str(type(df[c].iloc[0])), 'column_information':return_vals(df,c)}
    #     except:
    #         dict_[c] = {'column_name':c,'type':str(type(df[c].iloc[0])), 'column_information':'NA'}    
    return dict_


