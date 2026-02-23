import dspy
import src.agents.memory_agents as m
import asyncio
from dotenv import load_dotenv
import logging
from src.utils.logger import Logger
from src.utils.model_registry import small_lm, gpt_4o_mini
import json

load_dotenv()

logger = Logger("agents", see_time=True, console_log=True)



# === CUSTOM AGENT FUNCTIONALITY ===
def create_custom_agent_signature(agent_name, description, prompt_template, category=None):
    """
    Dynamically creates a dspy.Signature class for custom agents.
    Has to be tested
    
    Args:
        agent_name: Name of the custom agent (e.g., 'pytorch_agent')
        description: Short description for agent selection
        prompt_template: Main prompt/instructions for agent behavior
        category: Agent category from database (e.g., 'Visualization', 'Modelling', 'Data Manipulation')
    
    Returns:
        A dspy.Signature class with the custom prompt and standard input/output fields
    """
    
    # Check if this is a visualization agent to determine input fields
    # First check category, then fallback to name-based detection
    if category and category.lower() == 'visualization':
        is_viz_agent = True
    else:
        is_viz_agent = 'viz' in agent_name.lower() or 'visual' in agent_name.lower() or 'plot' in agent_name.lower() or 'chart' in agent_name.lower()

    # Standard input/output fields that match the unified agent signatures
    class_attributes = {
        '__doc__': prompt_template,  # The custom prompt becomes the docstring
        'goal': dspy.InputField(desc="User-defined goal which includes information about data and task they want to perform"),
        'dataset': dspy.InputField(desc="Provides information about the data in the data frame. Only use column names and dataframe_name as in this context"),
        'plan_instructions': dspy.InputField(desc="Agent-level instructions about what to create and receive", default=""),
        'code': dspy.OutputField(desc="Generated Python code for the analysis"),
        'summary': dspy.OutputField(desc="A concise bullet-point summary of what was done and key results")
    }
    
    
    # Add styling_index for visualization agents
    if is_viz_agent:
        class_attributes['styling_index'] = dspy.InputField(desc='Provides instructions on how to style outputs and formatting')
    
    # Create the dynamic signature class
    CustomAgentSignature = type(agent_name, (dspy.Signature,), class_attributes)
    return CustomAgentSignature

def load_user_enabled_templates_from_db(user_id, db_session):
    """
    Load template agents that are enabled for a specific user from the database.
    Default agents are enabled by default unless explicitly disabled by user preference.
    
    Args:
        user_id: ID of the user
        db_session: Database session
    
    Returns:
        Dict of template agent signatures keyed by template name
    """
    try:
        from src.db.schemas.models import AgentTemplate, UserTemplatePreference
        
        agent_signatures = {}
        
        if not user_id:
            return agent_signatures
        
        # Get list of default agent names that should be enabled by default
        default_agent_names = [
            "preprocessing_agent",
            "statistical_analytics_agent", 
            "sk_learn_agent",
            "data_viz_agent"
        ]
        
        # Get all active templates
        all_templates = db_session.query(AgentTemplate).filter(
            AgentTemplate.is_active == True
        ).all()
        
        for template in all_templates:
            # Check if user has explicitly disabled this template
            preference = db_session.query(UserTemplatePreference).filter(
                UserTemplatePreference.user_id == user_id,
                UserTemplatePreference.template_id == template.template_id
            ).first()
            
            # Determine if template should be enabled by default
            is_default_agent = template.template_name in default_agent_names
            default_enabled = is_default_agent  # Default agents enabled by default, others disabled
            
            # Template is enabled by default for default agents, disabled for others
            is_enabled = preference.is_enabled if preference else default_enabled

            if is_enabled:
                # Create dynamic signature for each enabled template
                signature = create_custom_agent_signature(
                    template.template_name,
                    template.description,
                    template.prompt_template,
                    template.category  # Pass the category from database
                )
                agent_signatures[template.template_name] = signature
                
        return agent_signatures
        
    except Exception as e:
        logger.log_message(f"Error loading user enabled templates for user {user_id}: {str(e)}", level=logging.ERROR)
        return {}

def load_user_enabled_templates_for_planner_from_db(user_id, db_session):
    """
    Load planner variant template agents that are enabled for planner use (max 10, prioritized by usage).
    Default planner agents are enabled by default unless explicitly disabled by user preference.
    Custom/premium agents require explicit enablement.
    
    Args:
        user_id: ID of the user
        db_session: Database session
    
    Returns:
        Dict of template agent signatures keyed by template name (max 10)
    """
    # try:
    from src.db.schemas.models import AgentTemplate, UserTemplatePreference
    from datetime import datetime, UTC
    
    agent_signatures = {}
    

    
    # Get list of default planner agent names that should be enabled by default
    default_planner_agent_names = [
        "planner_preprocessing_agent",
        "planner_statistical_analytics_agent", 
        "planner_sk_learn_agent",
        "planner_data_viz_agent"
    ]
    # if not user_id:
    #     return agent_signatures
    
    # Get all active planner variant templates
    all_templates = db_session.query(AgentTemplate).filter(
        AgentTemplate.is_active == True,
        AgentTemplate.variant_type.in_(['planner', 'both'])
    ).all()
    
    enabled_templates = []
    # Fetch all preferences for the user in a single query for efficiency
    preferences = db_session.query(UserTemplatePreference).filter(
        UserTemplatePreference.user_id == user_id
    ).all()
    preference_map = {pref.template_id: pref for pref in preferences}

    for template in all_templates:
        preference = preference_map.get(template.template_id)
        is_default_planner_agent = template.template_name in default_planner_agent_names
        default_enabled = is_default_planner_agent
        is_enabled = preference.is_enabled if preference else default_enabled

        if is_enabled:
            enabled_templates.append({
                'template': template,
                'preference': preference,
                'usage_count': preference.usage_count if preference else 0,
                'last_used_at': preference.last_used_at if preference else None
            })

    # If user has no enabled templates, fall back to default enabled (default planner agents)
    if enabled_templates == []:
        for template in all_templates:
            if template.template_name in default_planner_agent_names:
                enabled_templates.append({
                    'template': template,
                    'preference': None,
                    'usage_count': 0,
                    'last_used_at': None
                })

    # Sort by usage (most used first) and limit to 10
    enabled_templates.sort(key=lambda x: (x['usage_count'], x['last_used_at'] or datetime.min.replace(tzinfo=UTC)), reverse=True)
    enabled_templates = enabled_templates[:10]
    
    for item in enabled_templates:
        template = item['template']
        # Create dynamic signature for each enabled template
        signature = create_custom_agent_signature(
            template.template_name,
            template.description,
            template.prompt_template,
            template.category  # Pass the category from database
        )
        agent_signatures[template.template_name] = signature
            
    logger.log_message(f"Loaded {len(agent_signatures)} templates for planner", level=logging.DEBUG)
    return agent_signatures
        
    # except Exception as e:
    #     logger.log_message(f"Error loading planner templates for user {user_id}: {str(e)}", level=logging.ERROR)
    #     return {}

def get_all_available_templates(db_session):
    """
    Get all available agent templates from the database.
    
    Args:
        db_session: Database session
    
    Returns:
        List of agent template records
    """
    try:
        from src.db.schemas.models import AgentTemplate
        import os
        import json

        templates = db_session.query(AgentTemplate).filter(
            AgentTemplate.is_active == True
        ).all()

        if not templates:
            # Try to load from agents_config.json after the main folder (project root or backend dir)
            current_dir = os.path.dirname(os.path.abspath(__file__))
            backend_dir = os.path.dirname(current_dir)
            project_root = os.path.dirname(backend_dir)
            possible_paths = [
                os.path.join(backend_dir, 'agents_config.json'),  # backend directory
                os.path.join(project_root, 'agents_config.json'),  # project root
                '/app/agents_config.json'  # container root (for Docker/Spaces)
            ]
            config_path = None
            for path in possible_paths:
                if os.path.exists(path):
                    config_path = path
                    break
            if config_path:
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                templates = config.get('templates', [])
            else:
                templates = []
        return templates
        
    except Exception as e:
        logger.log_message(f"Error getting all available templates: {str(e)}", level=logging.ERROR)
        return []

def toggle_user_template_preference(user_id, template_id, is_enabled, db_session):
    """
    Toggle a user's template preference (enable/disable).
    
    Args:
        user_id: ID of the user
        template_id: ID of the template
        is_enabled: Whether to enable or disable the template
        db_session: Database session
    
    Returns:
        Tuple (success: bool, message: str)
    """
    try:
        from src.db.schemas.models import UserTemplatePreference, AgentTemplate
        from datetime import datetime, UTC
        
        # Verify template exists and is active
        template = db_session.query(AgentTemplate).filter(
            AgentTemplate.template_id == template_id,
            AgentTemplate.is_active == True
        ).first()
        
        if not template:
            return False, "Template not found or inactive"
        
        # Check if preference record exists
        preference = db_session.query(UserTemplatePreference).filter(
            UserTemplatePreference.user_id == user_id,
            UserTemplatePreference.template_id == template_id
        ).first()
        
        if preference:
            # Update existing preference
            preference.is_enabled = is_enabled
            preference.updated_at = datetime.now(UTC)
        else:
            # Create new preference record
            preference = UserTemplatePreference(
                user_id=user_id,
                template_id=template_id,
                is_enabled=is_enabled,
                usage_count=0,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC)
            )
            db_session.add(preference)
        
        db_session.commit()
        
        action = "enabled" if is_enabled else "disabled"
        return True, f"Template '{template.template_name}' {action} successfully"
        
    except Exception as e:
        db_session.rollback()
        logger.log_message(f"Error toggling template preference: {str(e)}", level=logging.ERROR)
        return False, f"Error updating template preference: {str(e)}"



def load_all_available_templates_from_db(db_session):
    """
    Load ALL available individual variant template agents from the database for direct access.
    This allows users to use any individual template via @template_name regardless of preferences.
    
    Args:
        db_session: Database session
    
    Returns:
        Dict of template agent signatures keyed by template name
    """
    try:
        from src.db.schemas.models import AgentTemplate
        
        agent_signatures = {}
        
        # Get all active individual variant templates
        all_templates = db_session.query(AgentTemplate).filter(
            AgentTemplate.is_active == True,
            AgentTemplate.variant_type.in_(['individual', 'both'])
        ).all()
        
        for template in all_templates:
            # Create dynamic signature for all active templates
            signature = create_custom_agent_signature(
                template.template_name,
                template.description,
                template.prompt_template,
                template.category  # Pass the category from database
            )
            agent_signatures[template.template_name] = signature
                
        return agent_signatures
        
    except Exception as e:
        logger.log_message(f"Error loading all available templates: {str(e)}", level=logging.ERROR)
        return {}



# === END CUSTOM AGENT FUNCTIONALITY ===

def get_agent_description(agent_name, is_planner=False):
    """
    Get agent description from database instead of hardcoded dictionaries.
    This function is kept for backward compatibility but will fetch from DB.
    """
    try:
        from src.db.init_db import session_factory
        from src.db.schemas.models import AgentTemplate
        
        db_session = session_factory()
        try:
            template = db_session.query(AgentTemplate).filter(
                AgentTemplate.template_name == agent_name,
                AgentTemplate.is_active == True
            ).first()
            
            if template:
                return template.description
            else:
                return "No description available for this agent"
        finally:
            db_session.close()
    except Exception as e:
        return "No description available for this agent"


# Agent to make a Chat history name from a query
class chat_history_name_agent(dspy.Signature):
    """You are an agent that takes a query and returns a name for the chat history"""
    query = dspy.InputField(desc="The query to make a name for")
    name = dspy.OutputField(desc="A name for the chat history (max 3 words)")

class dataset_description_agent(dspy.Signature):
    """

    Generate a structured dataset context/description like this, you will be given headers for the data & existing description!
{
  "exact": "apple_stock_historical_data",
  "description": "Daily historical stock market data for Apple Inc. including open, close, high, low prices, trading volume, and adjusted close for accurate return calculations.",
  "columns": {
    "Date": {
      "type": "datetime",
      "format": "YYYY-MM-DD",
      "description": "Trading date",
      "preprocessing": "Convert strings using pd.to_datetime(df['Date'], format='%Y-%m-%d')",
      "missing_values_handling": "Interpolate or forward-fill missing dates for continuity"
    },
    "Open": {
      "type": "float",
      "description": "Opening stock price in USD",
      "preprocessing": "Direct float conversion"
    },
    "High": {
      "type": "float",
      "description": "Highest stock price in USD during the trading day",
      "preprocessing": "Direct float conversion"
    },
    "Low": {
      "type": "float",
      "description": "Lowest stock price in USD during the trading day",
      "preprocessing": "Direct float conversion"
    },
    "Close": {
      "type": "float",
      "description": "Closing stock price in USD",
      "preprocessing": "Direct float conversion"
    },
    "Adj Close": {
      "type": "float",
      "description": "Adjusted closing price accounting for dividends and splits",
      "preprocessing": "Direct float conversion"
    },
    "Volume": {
      "type": "integer",
      "description": "Number of shares traded during the day",
      "preprocessing": "Direct integer conversion"
    }
  },


  "usage_notes": "Ensure adjusted close prices are used for return calculations. Use consistent timezone if merging with other datasets. Handle missing values carefully to maintain temporal continuity.",

    """
    dataset = dspy.InputField(desc="The dataset to describe, including headers, sample data, null counts, and data types.")
    existing_description = dspy.InputField(desc="An existing description to improve upon (if provided).", default="")
    description = dspy.OutputField(desc="A comprehensive dataset context with business context and technical guidance for analysis agents.")


class custom_agent_instruction_generator(dspy.Signature):
    """You are an AI agent instruction generator that creates comprehensive, professional prompts for custom data analysis agents.
    
    Your task is to take a user's requirements and generate a detailed agent instruction that follows the same structure and quality as the default system agents (preprocessing_agent, statistical_analytics_agent, sk_learn_agent, data_viz_agent).
    
    Key requirements for generated instructions:
    1. **Professional Structure**: Use clear sections with headers and bullet points
    2. **Input/Output Specification**: Clearly define what the agent receives and produces
    3. **Technical Guidelines**: Include specific library recommendations and best practices
    4. **Error Handling**: Include instructions for handling common issues
    5. **Code Quality**: Emphasize clean, reproducible, and well-documented code
    6. **Standardized Outputs**: Ensure consistent format with 'code' and 'summary' outputs
    
    Structure your instructions as follows:
    - Brief role definition and purpose
    - Input specifications and expectations
    - Core responsibilities and tasks
    - Technical requirements and best practices
    - Library and methodology recommendations
    - Error handling and edge cases
    - Output format requirements
    - Example code patterns (if relevant)
    
    Categories and their focus areas:
    
    **Visualization**: 
    - Emphasize Plotly for interactive charts
    - Include styling and layout best practices
    - Focus on chart type selection based on data
    - Performance optimization for large datasets
    - Color schemes and accessibility
    
    **Modelling**:
    - Cover model selection and evaluation
    - Include cross-validation and metrics
    - Emphasize feature engineering and preprocessing
    - Handle different problem types (classification, regression, clustering)
    - Include hyperparameter tuning guidance
    
    **Data Manipulation**:
    - Focus on Pandas and NumPy operations
    - Include data cleaning and transformation
    - Handle missing values and outliers
    - Emphasize data type conversions
    - Include aggregation and reshaping operations
    
    Make instructions generic enough to handle various tasks within the category while being specific enough to provide clear guidance.
    Always include the standard output format: 'code' (Python code) and 'summary' (bullet-point explanation).
    
    Example instruction structure:
    '''
    You are a [specific role] agent specializing in [category focus]. Your task is to [main purpose]...
    
    **Input Requirements:**
    - dataset: [description]
    - goal: [description]
    - [other inputs as needed]
    
    **Core Responsibilities:**
    1. [Primary task]
    2. [Secondary task]
    3. [Additional requirements]
    
    **Technical Guidelines:**
    - Use [recommended libraries]
    - Follow [best practices]
    - Handle [common issues]
    
    **Output Requirements:**
    - code: [code specification]
    - summary: [summary specification]
    '''
    """
    category = dspy.InputField(desc="The category of the custom agent: 'Visualization', 'Modelling', or 'Data Manipulation'")
    user_requirements = dspy.InputField(desc="User's description of what they want the agent to do, including specific tasks, methods, or focus areas")
    agent_instructions = dspy.OutputField(desc="Complete, professional agent instructions following the structure and quality of default system agents, ready to be used as a custom agent prompt")

class advanced_query_planner(dspy.Signature):
    """
You are a advanced data analytics planner agent. Your task is to generate the most efficient plan—using the fewest necessary agents and variables—to achieve a user-defined goal. The plan must preserve data integrity, avoid unnecessary steps, and ensure clear data flow between agents.

**CRITICAL**: Before planning, check if any agents are available in Agent_desc. If Agent_desc is empty or contains no active agents, respond with:
plan: no_agents_available
plan_instructions: {"message": "No agents are currently enabled for analysis. Please enable at least one agent (preprocessing, statistical analysis, machine learning, or visualization) in your template preferences to proceed with data analysis."}

**Inputs**:
1. Datasets (raw or preprocessed)
2. Agent descriptions (roles, variables they create/use, constraints)
3. User-defined goal (e.g., prediction, analysis, visualization)
**Responsibilities**:
1. **Feasibility**: Confirm the goal is achievable with the provided data and agents; ask for clarification if it's unclear.
2. **Minimal Plan**: Use the smallest set of agents and variables; avoid redundant transformations; ensure agents are ordered logically and only included if essential.
3. **Instructions**: For each agent, define:
   * **create**: output variables and their purpose
   * **use**: input variables and their role
   * **instruction**: concise explanation of the agent's function and relevance to the goal
4. **Clarity**: Keep instructions precise; avoid intermediate steps unless necessary; ensure each agent has a distinct, relevant role.
### **Output Format**:
Example: 1 agent use
  goal: "Generate a bar plot showing sales by category after cleaning the raw data and calculating the average of the 'sales' column"
Output:
  plan: data_viz_agent
{
  "data_viz_agent": {
    "create": [
      "cleaned_data: DataFrame - cleaned version of df (pd.Dataframe) after removing null values"
    ],
    "use": [
      "df: DataFrame - unprocessed dataset (pd.Dataframe) containing sales and category information"
    ],
    "instruction": "Clean df by removing null values, calculate the average sales, and generate a bar plot showing sales by category."
  }
}
Example 3 Agent 
goal:"Clean the dataset, run a linear regression to model the relationship between marketing budget and sales, and visualize the regression line with confidence intervals."
plan: preprocessing_agent -> statistical_analytics_agent -> data_viz_agent
{
  "preprocessing_agent": {
    "create": [
      "cleaned_data: DataFrame - cleaned version of df with missing values handled and proper data types inferred"
    ],
    "use": [
      "df: DataFrame - dataset containing marketing budgets and sales figures"
    ],
    "instruction": "Clean df by handling missing values and converting column types (e.g., dates). Output cleaned_data for modeling."
  },
  "statistical_analytics_agent": {
    "create": [
      "regression_results: dict - model summary including coefficients, p-values, R², and confidence intervals"
    ],
    "use": [
      "cleaned_data: DataFrame - preprocessed dataset ready for regression"
    ],
    "instruction": "Perform linear regression using cleaned_data to model sales as a function of marketing budget. Return regression_results including coefficients and confidence intervals."
  },
  "data_viz_agent": {
    "create": [
      "regression_plot: PlotlyFigure - visual plot showing regression line with confidence intervals"
    ],
    "use": [
      "cleaned_data: DataFrame - original dataset for plotting",
      "regression_results: dict - output of linear regression"
    ],
    "instruction": "Generate a Plotly regression plot using cleaned_data and regression_results. Show the fitted line, scatter points, and 95% confidence intervals."
  }
}
Try to use as few agents to answer the user query as possible.
Respond in the user's language for all explanations and instructions, but keep all code, variable names, function names, model names, agent names, and library names in English.
    """
    dataset = dspy.InputField(desc="Available datasets loaded in the system, use this df, columns set df as copy of df")
    Agent_desc = dspy.InputField(desc="The agents available in the system")
    goal = dspy.InputField(desc="The user defined goal")

    plan = dspy.OutputField(desc="The plan that would achieve the user defined goal", prefix='Plan:')
    plan_instructions = dspy.OutputField(desc="Detailed variable-level instructions per agent for the plan")

class basic_query_planner(dspy.Signature):
    """
    You are the basic query planner in the system, you pick one agent, to answer the user's goal.
    Use the Agent_desc that describes the names and actions of agents available.
    
    **CRITICAL**: Before planning, check if any agents are available in Agent_desc. If Agent_desc is empty or contains no active agents, respond with:
    plan: no_agents_available
    plan_instructions: {"message": "No agents are currently enabled for analysis. Please enable at least one agent (preprocessing, statistical analysis, machine learning, or visualization) in your template preferences to proceed with data analysis."}
    
    Example: Visualize height and salary?
    plan:data_viz_agent
    plan_instructions:
               {
                    "data_viz_agent": {
                        "create": ["scatter_plot"],
                        "use": ["original_data"],
                        "instruction": "use the original_data to create scatter_plot of height & salary, using plotly"
                    }
                }
    Example: Tell me the correlation between X and Y
    plan:preprocessing_agent
    plan_instructions:{
                    "data_viz_agent": {
                        "create": ["correlation"],
                        "use": "use": ["original_data"],
                        "instruction": "use the original_data to measure correlation of X & Y, using pandas"
                    }
    
    
    Respond in the user's language for all explanations and instructions, but keep all code, variable names, function names, model names, agent names, and library names in English.
    original_data is placeholder, use exact_python_name: name_of_df for actual dataset name

    """
    dataset = dspy.InputField(desc="Available datasets loaded in the system, use this df, columns set df as copy of df")
    Agent_desc = dspy.InputField(desc="The agents available in the system")
    goal = dspy.InputField(desc="The user defined goal")
    plan = dspy.OutputField(desc="The plan that would achieve the user defined goal", prefix='Plan:')
    plan_instructions = dspy.OutputField(desc="Instructions on what the agent should do alone")



class intermediate_query_planner(dspy.Signature):
    # The planner agent which routes the query to Agent(s)
    # The output is like this Agent1->Agent2 etc
    """ You are an intermediate data analytics planner agent. You have access to three inputs
    1. Datasets
    2. Data Agent descriptions
    3. User-defined Goal
    You take these three inputs to develop a comprehensive plan to achieve the user-defined goal from the data & Agents available.
    In case you think the user-defined goal is infeasible you can ask the user to redefine or add more description to the goal.
    
    **CRITICAL**: Before planning, check if any agents are available in Agent_desc. If Agent_desc is empty or contains no active agents, respond with:
    plan: no_agents_available
    plan_instructions: {"message": "No agents are currently enabled for analysis. Please enable at least one agent (preprocessing, statistical analysis, machine learning, or visualization) in your template preferences to proceed with data analysis."}
    
    Give your output in this format:
    plan: Agent1->Agent2
    plan_instructions = {
    "Agent1": {
                        "create": ["aggregated_variable"],
                        "use": ["original_data"]
                        "instruction": "use the original_data to create aggregated_variable"
                    },
    "Agent2": {
                        "create": ["visualization_of_data"],
                        "use": ["aggregated_variable,original_data"],
                        "instruction": "use the aggregated_variable & original_data to create visualization_of_data"
                    }
            }
    Keep the instructions minimal without many variables, and minimize the number of unknowns, keep it obvious!
    Try to use no more than 2 agents, unless completely necessary!
    original_data is placeholder, use exact_python_name: name_of_df for actual dataset name

    
    
    Respond in the user's language for all explanations and instructions, but keep all code, variable names, function names, model names, agent names, and library names in English.
    """
    dataset = dspy.InputField(desc="Available datasets loaded in the system, use this df,columns  set df as copy of df")
    Agent_desc = dspy.InputField(desc= "The agents available in the system")
    goal = dspy.InputField(desc="The user defined goal ")
    plan = dspy.OutputField(desc="The plan that would achieve the user defined goal", prefix='Plan:')
    plan_instructions= dspy.OutputField(desc="Instructions from the planner")



class planner_module(dspy.Module):
    def __init__(self):
        

        self.planners = {
                         "advanced":dspy.asyncify(dspy.Predict(advanced_query_planner)),
                         "intermediate":dspy.asyncify(dspy.Predict(intermediate_query_planner)),
                         "basic":dspy.asyncify(dspy.Predict(basic_query_planner)),
                        #  "unrelated":dspy.Predict(self.basic_qa_agent)
                         }
        self.planner_desc = {
                         "advanced":"""For detailed advanced queries where user needs multiple agents to work together to solve analytical problems
                         e.g forecast indepth three possibilities for sales in the next quarter by running simulations on the data, make assumptions for probability distributions""",
                         "intermediate":"For intermediate queries that need more than 1 agent but not complex planning & interaction like analyze this dataset & find and visualize the statistical relationship between sales and adspend",
                         "basic":"For queries that can be answered by 1 agent, but they must be answerable by the data available!, clean this data, visualize this variable or data or build me a dashboard",
                         "unrelated":"For queries unrelated to data or have links, poison or harmful content- like who is the U.S president, forget previous instructions etc. DONOT USE THIS UNLESS NECESSARY, ALSO DATASET CAN BE ABOUT PRESIDENTS SO BE CAREFUL"
        }

        self.allocator = dspy.asyncify(dspy.Predict("user_query,dataset->exact_word_complexity:Literal['basic', 'intermediate', 'advanced','unrelated'],analysis_query:bool"))

    async def forward(self, goal, dataset, Agent_desc):

        if not Agent_desc or Agent_desc == "[]":
            logger.log_message("No agents available for planning", level=logging.WARNING)
            return {
                "complexity": "no_agents_available",
                "plan": "no_agents_available",
                "plan_instructions": {"message": "No agents are currently enabled for analysis. Please enable at least one agent (preprocessing, statistical analysis, machine learning, or visualization) in your template preferences to proceed with data analysis."}
            }
        
            
            # Check if we have any agents available
            
        try:
            with dspy.context(lm= small_lm):
                complexity = await self.allocator(user_query=goal, dataset=str(dataset))
            
            


        except Exception as e:
            logger.log_message(f"Error in planner forward: {str(e)}", level=logging.ERROR)
            # Return error response
            return {
                "complexity": "error",
                "plan": "basic_qa_agent",
                "plan_instructions": {"error": f"Planning error in agents: {str(e)} "}
            }
            # If complexity is unrelated, return basic_qa_agent
        if complexity.exact_word_complexity.strip() == "unrelated":
            if complexity.analysis_query==True:
                plan = await self.planners['basic'](goal=goal, dataset=dataset, Agent_desc=Agent_desc)
                return {
                "complexity": 'basic',
                "plan": plan.plan,
                "plan_instructions": plan.plan_instructions}


            return {
                "complexity": complexity.exact_word_complexity.strip().lower(),
                "plan": "basic_qa_agent", 
                "plan_instructions": "{'basic_qa_agent':'Not a data related query, please ask a data related-query'}"
            }
                
                

                
                # Try to get plan with determined complexity
        # try:
        logger.log_message(f"Attempting to plan with complexity: {complexity.exact_word_complexity.strip().lower()}", level=logging.DEBUG)
        with dspy.context(lm = gpt_4o_mini):
            plan = await self.planners[complexity.exact_word_complexity.strip()](goal=goal, dataset=dataset, Agent_desc=Agent_desc)

        # if len(str(plan)) == 0:
        #     output = {
        #         "complexity": "error",
        #         "plan": "Something went wrong it is not 0" + str(plan),
        #         "plan_instructions": {"message": "the plan was not constructed" + str(Agent_desc)}   
        #         }
        # else:
        #     output = {
        #         "complexity": "error",
        #         "plan": "Something went wrong it is 0" + str(plan),
        #         "plan_instructions": {"message": "the plan was not constructed" + str(Agent_desc)}   
        #         }



        
        # If plan or plan.plan is not available, return an error response
        if not plan or not hasattr(plan, 'plan'):
            logger.log_message("Planner did not return a valid plan object or 'plan' attribute is missing", level=logging.ERROR)
            return {
                "complexity": complexity.exact_word_complexity.strip().lower(),
                "plan": "planning_error",
                "plan_instructions": {"error": "Planner did not return a valid plan. Please try again or check agent configuration."}
            }
        
        logger.log_message(f"Plan generated successfully: {plan}", level=logging.DEBUG)
        
        # Check if the planner returned no_agents_available
        if hasattr(plan, 'plan') and 'no_agents_available' in str(plan.plan):
            logger.log_message("Planner returned no_agents_available", level=logging.WARNING)
            output = {
                "complexity": "no_agents_available",
                "plan": "no_agents_available",
                "plan_instructions": {"message": "No agents are currently enabled for analysis. Please enable at least one agent (preprocessing, statistical analysis, machine learning, or visualization) in your template preferences to proceed with data analysis."}
            }

        output = {
                "complexity": complexity.exact_word_complexity.strip().lower(),
                "plan": plan.plan,
                "plan_instructions": plan.plan_instructions
            }
        
        return output






class preprocessing_agent(dspy.Signature):
    """
You are a preprocessing agent that can work both individually and in multi-agent data analytics systems.
You are given:
* A dataset (already loaded as with exact_python_name mentioned).
* A user-defined analysis goal (e.g., predictive modeling, exploration, cleaning).
* Optional plan instructions that tell you what variables you are expected to create and what variables you are receiving from previous agents.

### Your Responsibilities:
* If plan_instructions are provided, follow the provided plan and create only the required variables listed in the 'create' section.
* If no plan_instructions are provided, perform standard data preprocessing based on the goal.
* Do not create fake data or introduce variables not explicitly part of the instructions.
* Do not read data from CSV; the dataset (`df`) is already loaded and ready for processing.
* Generate Python code using NumPy and Pandas to preprocess the data and produce any intermediate variables as specified.

### Best Practices for Preprocessing:
1. Create a copy of the original DataFrame: It will always be stored as df, it already exists use it!
    ```python
    processed_df = df.copy()
    ```
2. Separate column types:
    ```python
    numeric_cols = processed_df.select_dtypes(include='number').columns
    categorical_cols = processed_df.select_dtypes(include='object').columns
    ```
3. Handle missing values:
    ```python
    for col in numeric_cols:
        processed_df[col] = processed_df[col].fillna(processed_df[col].median())
    
    for col in categorical_cols:
        processed_df[col] = processed_df[col].fillna(processed_df[col].mode()[0] if not processed_df[col].mode().empty else 'Unknown')
    ```
4. Convert string columns to datetime safely:
    ```python
    def safe_to_datetime(x):
        try:
            return pd.to_datetime(x, errors='coerce', cache=False)
        except (ValueError, TypeError):
            return pd.NaT
    
    cleaned_df['date_column'] = cleaned_df['date_column'].apply(safe_to_datetime)
    ```
5. Do not alter the DataFrame index unless explicitly instructed.
6. Log assumptions and corrections in comments to clarify any choices made during preprocessing.
7. Do not mutate global state: Avoid in-place modifications unless clearly necessary (e.g., using `.copy()`).
8. Handle data types properly:
   * Avoid coercing types blindly (e.g., don't compare timestamps to strings or floats).
   * Use `pd.to_datetime(..., errors='coerce')` for safe datetime parsing.
9. Preserve column structure: Only drop or rename columns if explicitly instructed.

### Output:
1. Code: Python code that performs the requested preprocessing steps.
2. Summary: A brief explanation of what preprocessing was done (e.g., columns handled, missing value treatment).

### Principles to Follow:
- Never alter the DataFrame index unless explicitly instructed.
- Handle missing data explicitly, filling with default values when necessary.
- Preserve column structure and avoid unnecessary modifications.
- Ensure data types are appropriate (e.g., dates parsed correctly).
- Log assumptions in the code.
Respond in the user's language for all summary and reasoning but keep the code in english
    """
    dataset = dspy.InputField(desc="The dataset, preloaded as df")
    goal = dspy.InputField(desc="User-defined goal for the analysis")
    plan_instructions = dspy.InputField(desc="Agent-level instructions about what to create and receive (optional for individual use)", default="")
    
    code = dspy.OutputField(desc="Generated Python code for preprocessing")
    summary = dspy.OutputField(desc="Explanation of what was done and why")

class data_viz_agent(dspy.Signature):
    """
You are a data visualization agent that can work both individually and in multi-agent analytics pipelines.
Your primary responsibility is to generate visualizations based on the user-defined goal.

    You are provided with:
    * **goal**: A user-defined goal outlining the type of visualization the user wants (e.g., "plot sales over time with trendline").
* **dataset**: The dataset (e.g., `df_cleaned`) which will be passed to you by other agents in the pipeline. Do not assume or create any variables — the data is already present and valid when you receive it.
    * **styling_index**: Specific styling instructions (e.g., axis formatting, color schemes) for the visualization.
* **plan_instructions**: Optional dictionary containing:
  * **'create'**: List of visualization components you must generate (e.g., 'scatter_plot', 'bar_chart').
  * **'use'**: List of variables you must use to generate the visualizations.
  * **'instructions'**: Additional instructions related to the creation of the visualizations.

### Responsibilities:
    1. **Strict Use of Provided Variables**:
   * You must never create fake data. Only use the variables and datasets that are explicitly provided.
   * If plan_instructions are provided and any variable listed in plan_instructions['use'] is missing, return an error.
   * If no plan_instructions are provided, work with the available dataset directly.

    2. **Visualization Creation**:
   * Based on the goal and optional 'create' section of plan_instructions, generate the required visualization using Plotly.
   * Respect the user-defined goal in determining which type of visualization to create.

    3. **Performance Optimization**:
   * If the dataset contains more than 50,000 rows, you must sample the data to 5,000 rows to improve performance:
        ```python
        if len(df) > 50000:
            df = df.sample(5000, random_state=42)
        ```

    4. **Layout and Styling**:
   * Apply formatting and layout adjustments as defined by the styling_index.
   * Ensure that all axes (x and y) have consistent formats (e.g., using `K`, `M`, or 1,000 format, but not mixing formats).

    5. **Trendlines**:
   * Trendlines should only be included if explicitly requested in the goal or plan_instructions.

    6. **Displaying the Visualization**:
    * Use Plotly's `fig.show()` method to display the created chart.
   * Never output raw datasets or the goal itself. Only the visualization code and the chart should be returned.

    7. **Error Handling**:
   * If required dataset or variables are missing, return an error message indicating which specific variable is missing.
   * If the goal or create instructions are ambiguous, return an error stating the issue.

    8. **No Data Modification**:
   * Never modify the provided dataset or generate new data. If the data needs preprocessing, assume it's already been done by other agents.

### Important Notes:
- Use update_yaxes, update_xaxes, not axis
- Each visualization must be generated as a separate figure using go.Figure()
- Do NOT use subplots under any circumstances
- Each figure must be returned individually using: fig.to_html(full_html=False)
- Use update_layout with xaxis and yaxis only once per figure
- Enhance readability with low opacity (0.4-0.7) where appropriate
- Apply visually distinct colors for different elements or categories
- Use only one number format consistently: either 'K', 'M', or comma-separated values
- Only include trendlines in scatter plots if the user explicitly asks for them
- Always end each visualization with: fig.to_html(full_html=False)

Respond in the user's language for all summary and reasoning but keep the code in english
        """
    goal = dspy.InputField(desc="User-defined chart goal (e.g. trendlines, scatter plots)")
    dataset = dspy.InputField(desc="Details of the dataframe (`df`) and its columns")
    styling_index = dspy.InputField(desc="Instructions for plot styling and layout formatting")
    plan_instructions = dspy.InputField(desc="Variables to create and receive for visualization purposes (optional for individual use)", default="")

    code = dspy.OutputField(desc="Plotly Python code for the visualization")
    summary = dspy.OutputField(desc="Plain-language summary of what is being visualized")

class statistical_analytics_agent(dspy.Signature):
    """
You are a statistical analytics agent that can work both individually and in multi-agent data analytics pipelines.
You are given:
* A dataset (usually a cleaned or transformed version like `df_cleaned`).
* A user-defined goal (e.g., regression, seasonal decomposition).
* Optional plan instructions specifying:
  * Which variables you are expected to CREATE (e.g., `regression_model`).
  * Which variables you will USE (e.g., `df_cleaned`, `target_variable`).
  * A set of instructions outlining additional processing or handling for these variables.

### Your Responsibilities:
* Use the `statsmodels` library to implement the required statistical analysis.
* Ensure that all strings are handled as categorical variables via `C(col)` in model formulas.
* Always add a constant using `sm.add_constant()`.
* Do not modify the DataFrame's index.
* Convert `X` and `y` to float before fitting the model.
* Handle missing values before modeling.
* Avoid any data visualization (that is handled by another agent).
* Write output to the console using `print()`.

### If the goal is regression:
* Use `statsmodels.OLS` with proper handling of categorical variables and adding a constant term.
* Handle missing values appropriately.

### If the goal is seasonal decomposition:
* Use `statsmodels.tsa.seasonal_decompose`.
* Ensure the time series and period are correctly provided (i.e., `period` should not be `None`).

### Instructions to Follow:
1. If plan_instructions are provided:
   * CREATE only the variables specified in plan_instructions['CREATE']. Do not create any intermediate or new variables.
   * USE only the variables specified in plan_instructions['USE'] to carry out the task.
   * Follow any additional instructions in plan_instructions['INSTRUCTIONS'].
   * Do not reassign or modify any variables passed via plan_instructions.
2. If no plan_instructions are provided, perform standard statistical analysis based on the goal and available data.

### Example Code Structure:
```python
import statsmodels.api as sm
def statistical_model(X, y, goal, period=None):
    try:
        X = X.dropna()
        y = y.loc[X.index].dropna()
        X = X.loc[y.index]
        
        for col in X.select_dtypes(include=['object', 'category']).columns:
            X[col] = X[col].astype('category')
        
        # Add constant term to X
        X = sm.add_constant(X)
        if goal == 'regression':
            formula = 'y ~ ' + ' + '.join([f'C({col})' if X[col].dtype.name == 'category' else col for col in X.columns])
            model = sm.OLS(y.astype(float), X.astype(float)).fit()
            return model.summary()
        elif goal == 'seasonal_decompose':
            if period is None:
                raise ValueError("Period must be specified for seasonal decomposition")
            decomposition = sm.tsa.seasonal_decompose(y, period=period)
            return decomposition
        else:
            raise ValueError("Unknown goal specified. Please provide a valid goal.")
        
    except Exception as e:
        return f"An error occurred: {e}"
```

### Summary:
1. Always USE the variables passed in plan_instructions['USE'] to carry out the task (if provided).
2. Only CREATE the variables specified in plan_instructions['CREATE'] (if provided).
3. Follow any additional instructions in plan_instructions['INSTRUCTIONS'] (if provided).
4. Ensure reproducibility by setting the random state appropriately and handling categorical variables.
5. Focus on statistical analysis and avoid any unnecessary data manipulation.

### Output:
* The code implementing the statistical analysis, including all required steps.
* A summary of what the statistical analysis does, how it's performed, and why it fits the goal.
* Respond in the user's language for all summary and reasoning but keep the code in english
    """
    dataset = dspy.InputField(desc="Preprocessed dataset, often named df_cleaned")
    goal = dspy.InputField(desc="The user's statistical analysis goal, e.g., regression or seasonal_decompose")
    plan_instructions = dspy.InputField(desc="Instructions on variables to create and receive for statistical modeling (optional for individual use)", default="")
    
    code = dspy.OutputField(desc="Python code for statistical modeling using statsmodels")
    summary = dspy.OutputField(desc="A concise bullet-point summary of the statistical analysis performed and key findings")
    
class sk_learn_agent(dspy.Signature):
    """
You are a machine learning agent that can work both individually and in multi-agent data analytics pipelines.
    You are given:
    * A dataset (often cleaned and feature-engineered).
    * A user-defined goal (e.g., classification, regression, clustering).
* Optional plan instructions specifying:
  * Which variables you are expected to CREATE (e.g., `trained_model`, `predictions`).
  * Which variables you will USE (e.g., `df_cleaned`, `target_variable`, `feature_columns`).
  * A set of instructions outlining additional processing or handling for these variables.

### Your Responsibilities:
    * Use the scikit-learn library to implement the appropriate ML pipeline.
    * Always split data into training and testing sets where applicable.
    * Use `print()` for all outputs.
    * Ensure your code is:
  * Reproducible: Set `random_state=42` wherever applicable.
  * Modular: Avoid deeply nested code.
  * Focused on model building, not visualization (leave plotting to the `data_viz_agent`).
    * Your task may include:
    * Preprocessing inputs (e.g., encoding).
    * Model selection and training.
    * Evaluation (e.g., accuracy, RMSE, classification report).

### You must not:
    * Visualize anything (that's another agent's job).
* Rely on hardcoded column names — use those passed via plan_instructions or infer from data.
* Never create or modify any variables not explicitly mentioned in plan_instructions['CREATE'] (if provided).
* Never create the `df` variable. You will only work with the variables passed via the plan_instructions.
* Do not introduce intermediate variables unless they are listed in plan_instructions['CREATE'] (if provided).

### Instructions to Follow:
1. If plan_instructions are provided:
   * CREATE only the variables specified in the plan_instructions['CREATE'] list.
   * USE only the variables specified in the plan_instructions['USE'] list.
   * Follow any processing instructions in the plan_instructions['INSTRUCTIONS'] list.
   * Do not reassign or modify any variables passed via plan_instructions.
2. If no plan_instructions are provided, perform standard machine learning analysis based on the goal and available data.

### Example Workflow:
Given that the plan_instructions specifies variables to CREATE and USE, and includes instructions, your approach should look like this:
1. Use `df_cleaned` and `feature_columns` from the plan_instructions to extract your features (`X`).
2. Use `target_column` from plan_instructions to extract your target (`y`).
    3. If instructions are provided (e.g., scale or encode), follow them.
    4. Split data into training and testing sets using `train_test_split`.
    5. Train the model based on the received goal (classification, regression, etc.).
6. Store the output variables as specified in plan_instructions['CREATE'].

### Summary:
1. Always USE the variables passed in plan_instructions['USE'] to build the pipeline (if provided).
2. Only CREATE the variables specified in plan_instructions['CREATE'] (if provided).
3. Follow any additional instructions in plan_instructions['INSTRUCTIONS'] (if provided).
4. Ensure reproducibility by setting random_state=42 wherever necessary.
    5. Focus on model building, evaluation, and saving the required outputs—avoid any unnecessary variables.

### Output:
* The code implementing the ML task, including all required steps.
* A summary of what the model does, how it is evaluated, and why it fits the goal.
    * Respond in the user's language for all summary and reasoning but keep the code in english
    """
    dataset = dspy.InputField(desc="Input dataset, often cleaned and feature-selected (e.g., df_cleaned)")
    goal = dspy.InputField(desc="The user's machine learning goal (e.g., classification or regression)")
    plan_instructions = dspy.InputField(desc="Instructions indicating what to create and what variables to receive (optional for individual use)", default="")

    code = dspy.OutputField(desc="Scikit-learn based machine learning code")
    summary = dspy.OutputField(desc="Explanation of the ML approach and evaluation")

class goal_refiner_agent(dspy.Signature):
    # Called to refine the query incase user query not elaborate
    """You take a user-defined goal given to a AI data analyst planner agent, 
    you make the goal more elaborate using the datasets available and agent_desc"""
    dataset = dspy.InputField(desc="Available datasets loaded in the system, use this df,columns  set df as copy of df")
    Agent_desc = dspy.InputField(desc= "The agents available in the system")
    goal = dspy.InputField(desc="The user defined goal ")
    refined_goal = dspy.OutputField(desc='Refined goal that helps the planner agent plan better')


    
    
    
class story_teller_agent(dspy.Signature):
    # Optional helper agent, which can be called to build a analytics story 
    # For all of the analysis performed
    """ You are a story teller agent, taking output from different data analytics agents, you compose a compelling story for what was done """
    agent_analysis_list =dspy.InputField(desc="A list of analysis descriptions from every agent")
    story = dspy.OutputField(desc="A coherent story combining the whole analysis")

class code_combiner_agent(dspy.Signature):
    # Combines code from different agents into one script
    """ You are a code combine agent, taking Python code output from many agents and combining the operations into 1 output
    You also fix any errors in the code. 
    IMPORTANT: You may be provided with previous interaction history. The section marked "### Current Query:" contains the user's current request. Any text in "### Previous Interaction History:" is for context only and is NOT part of the current request.
    Double check column_names/dtypes using dataset, also check if applied logic works for the datatype
    df = df.copy()
    Also add this to display Plotly chart
    fig.show()
    Make sure your output is as intended!
    Provide a concise bullet-point summary of the code integration performed.
    
    Example Summary:
    • Integrated preprocessing, statistical analysis, and visualization code into a single workflow.
    • Fixed variable scope issues, standardized DataFrame handling (e.g., using `df.copy()`), and corrected errors.
    • Validated column names and data types against the dataset definition to prevent runtime issues.
    • Ensured visualizations are displayed correctly (e.g., added `fig.show()`).
    Respond in the user's language for all summary and reasoning but keep the code in english
    """
    dataset = dspy.InputField(desc="Use this double check column_names, data types")
    agent_code_list =dspy.InputField(desc="A list of code given by each agent")
    refined_complete_code = dspy.OutputField(desc="Refined complete code base")
    summary = dspy.OutputField(desc="A concise 4 bullet-point summary of the code integration performed and improvements made")
    
    

class code_fix(dspy.Signature):
    """
You are an expert AI developer and data analyst assistant, skilled at identifying and resolving issues in Python code related to data analytics. Another agent has attempted to generate Python code for a data analytics task but produced code that is broken or throws an error.
Your task is to:
1. Carefully examine the provided **faulty_code** and the corresponding **error** message.
2. Identify the **exact cause** of the failure based on the error and surrounding context.
3. Modify only the necessary portion(s) of the code to fix the issue, utilizing the **dataset_context** to inform your corrections.
4. Ensure the **intended behavior** of the original code is preserved (e.g., if the code is meant to filter, group, or visualize data, that functionality must be preserved).
5. Ensure the final output is **runnable**, **error-free**, and **logically consistent**.
Strict instructions:
- Assume the dataset is already loaded and available in the code context; do not include any code to read, load, or create data.
- Do **not** modify any working parts of the code unnecessarily.
- Do **not** change variable names, structure, or logic unless it directly contributes to resolving the issue.
- Do **not** output anything besides the corrected, full version of the code (i.e., no explanations, comments, or logs).
- Avoid introducing new dependencies or libraries unless absolutely required to fix the problem.
- The output must be complete and executable as-is.
Be precise, minimal, and reliable. Prioritize functional correctness.
One-shot example:
===
dataset_context: 
"This dataset contains historical price and trading data for two major financial assets: the S&P 500 index and Bitcoin (BTC). The data includes daily price metrics (open, high, low, close) and percentage changes for both assets... Change % columns are stored as strings with '%' symbol (e.g., '-5.97%') and require cleaning."
faulty_code:
# Convert percentage strings to floats
df['Change %'] = df['Change %'].str.rstrip('%').astype(float)
df['Change % BTC'] = df['Change % BTC'].str.rstrip('%').astype(float)
error:
Error in data_viz_agent: Can only use .str accessor with string values!
Traceback (most recent call last):
  File "/app/scripts/format_response.py", line 196, in execute_code_from_markdown
    exec(block_code, context)
AttributeError: Can only use .str accessor with string values!
fixed_code:
# Convert percentage strings to floats
df['Change %'] = df['Change %'].astype(str).str.rstrip('%').astype(float)
df['Change % BTC'] = df['Change % BTC'].astype(str).str.rstrip('%').astype(float)
Respond in the user's language for all summary and reasoning but keep the code in english
===
    """
    dataset_context = dspy.InputField(desc="The dataset context to be used for the code fix")
    faulty_code = dspy.InputField(desc="The faulty Python code used for data analytics")
    error = dspy.InputField(desc="The error message thrown when running the code")
    fixed_code = dspy.OutputField(desc="The corrected and executable version of the code")

class code_edit(dspy.Signature):
    """
You are an expert AI code editor that specializes in modifying existing data analytics code based on user requests. The user provides a working or partially working code snippet, a natural language prompt describing the desired change, and dataset context information.
Your job is to:
1. Analyze the provided original_code, user_prompt, and dataset_context.
2. Modify only the part(s) of the code that are relevant to the user's request, using the dataset context to inform your edits.
3. Leave all unrelated parts of the code unchanged, unless the user explicitly requests a full rewrite or broader changes.
4. Ensure that your changes maintain or improve the functionality and correctness of the code.
Strict requirements:
- Assume the dataset is already loaded and available in the code context; do not include any code to read, load, or create data.
- Do not change variable names, function structures, or logic outside the scope of the user's request.
- Do not refactor, optimize, or rewrite unless explicitly instructed.
- Ensure the edited code remains complete and executable.
- Output only the modified code, without any additional explanation, comments, or extra formatting.
Make your edits precise, minimal, and faithful to the user's instructions, using the dataset context to guide your modifications.
    """
    dataset_context = dspy.InputField(desc="The dataset context to be used for the code edit, including information about the dataset's shape, columns, types, and null values")
    original_code = dspy.InputField(desc="The original code the user wants modified")
    user_prompt = dspy.InputField(desc="The user instruction describing how the code should be changed")
    edited_code = dspy.OutputField(desc="The updated version of the code reflecting the user's request, incorporating changes informed by the dataset context")






# The ind module is called when agent_name is 
# explicitly mentioned in the query
class auto_analyst_ind(dspy.Module):
    """Handles individual agent execution when explicitly specified in query"""
    
    def __init__(self, agents, retrievers, user_id=None, db_session=None):
        # Initialize agent modules and retrievers
        self.agents = {}
        self.agent_inputs = {}
        self.agent_desc = []
        
        # logger.log_message(f"[INIT] Initializing auto_analyst_ind with user_id={user_id}, agents={len(agents) if agents else 0}", level=logging.INFO)
        
        # Load core agents based on user preferences (not always loaded)
        if not agents and user_id and db_session:
            try:
                # Get user preferences for core agents
                from src.db.schemas.models import AgentTemplate, UserTemplatePreference
                
                core_agent_names = ['preprocessing_agent', 'statistical_analytics_agent', 'sk_learn_agent', 'data_viz_agent']
                
                for agent_name in core_agent_names:
                    logger.log_message(f"[INIT] Processing core agent: {agent_name}", level=logging.DEBUG)
                    
                    # Check if user has enabled this core agent
                    template = db_session.query(AgentTemplate).filter(
                        AgentTemplate.template_name == agent_name,
                        AgentTemplate.is_active == True
                    ).first()
                    
                    if not template:
                        logger.log_message(f"[INIT] Core agent template '{agent_name}' not found in database", level=logging.WARNING)
                        continue
                    
                    # Get the agent signature class
                    if agent_name == 'preprocessing_agent':
                        agent_signature = preprocessing_agent
                    elif agent_name == 'statistical_analytics_agent':
                        agent_signature = statistical_analytics_agent
                    elif agent_name == 'sk_learn_agent':
                        agent_signature = sk_learn_agent
                    elif agent_name == 'data_viz_agent':
                        agent_signature = data_viz_agent
                    
                    # Add to agents dict
                    self.agents[agent_name] = dspy.asyncify(dspy.ChainOfThought(agent_signature))
                    
                    # Set input fields based on signature
                    if agent_name == 'data_viz_agent':
                        self.agent_inputs[agent_name] = {'goal', 'dataset', 'styling_index', 'plan_instructions'}
                    else:
                        self.agent_inputs[agent_name] = {'goal', 'dataset', 'plan_instructions'}
                    
                    # Get description from database
                    self.agent_desc.append({agent_name: get_agent_description(agent_name)})
                    # logger.log_message(f"[INIT] Successfully loaded core agent: {agent_name} with inputs: {self.agent_inputs[agent_name]}", level=logging.INFO)
                    
            except Exception as e:
                logger.log_message(f"[INIT] Error loading core agents based on preferences: {str(e)}", level=logging.ERROR)
                # Fallback to loading all core agents if preference system fails
                self._load_default_agents_fallback()
        elif not agents:
            self._load_default_agents_fallback()
            # If no user_id/db_session provided, load all core agents as fallback
            # logger.log_message(f"[INIT] No agents provided and no user_id/db_session, loading fallback agents", level=logging.INFO)
            

        # Load ALL available template agents if user_id and db_session are provided
        # For individual agent execution (@agent_name), users should be able to access any available agent
        if user_id and db_session:
            try:
                # For individual use, load ALL available templates regardless of user preferences
                template_signatures = load_all_available_templates_from_db(db_session)
                
                # logger.log_message(f"[INIT] Loaded {len(template_signatures)} template signatures from database", level=logging.INFO)
                
                for template_name, signature in template_signatures.items():
                    # Skip if this is a core agent - we'll load it separately
                    if template_name in ['preprocessing_agent', 'statistical_analytics_agent', 'sk_learn_agent', 'data_viz_agent']:
                        # logger.log_message(f"[INIT] Skipping template {template_name} as it's a core agent", level=logging.DEBUG)
                        continue
                        
                    # Add template agent to agents dict
                    self.agents[template_name] = dspy.asyncify(dspy.ChainOfThought(signature))
                    
                    # Determine if this is a visualization agent based on database category
                    is_viz_agent = False
                    try:
                        from src.db.schemas.models import AgentTemplate
                        
                        # Find template record to check category
                        template_record = db_session.query(AgentTemplate).filter(
                            AgentTemplate.template_name == template_name
                        ).first()
                        
                        if template_record and template_record.category and template_record.category.lower() == 'visualization':
                            is_viz_agent = True
                        else:
                            # Fallback to name-based detection for legacy templates
                            is_viz_agent = ('viz' in template_name.lower() or 
                                          'visual' in template_name.lower() or 
                                          'plot' in template_name.lower() or 
                                          'chart' in template_name.lower() or
                                          'matplotlib' in template_name.lower())
                    except Exception as cat_error:
                        logger.log_message(f"[INIT] Error checking category for template {template_name}: {str(cat_error)}", level=logging.WARNING)
                        # Fallback to name-based detection
                        is_viz_agent = ('viz' in template_name.lower() or 
                                      'visual' in template_name.lower() or 
                                      'plot' in template_name.lower() or 
                                      'chart' in template_name.lower() or
                                      'matplotlib' in template_name.lower())
                    
                    # Set input fields based on agent type
                    if is_viz_agent:
                        self.agent_inputs[template_name] = {'goal', 'dataset', 'styling_index', 'plan_instructions'}
                    else:
                        self.agent_inputs[template_name] = {'goal', 'dataset', 'plan_instructions'}
                    
                    # Store template agent description
                    try:
                        if not template_record:
                            template_record = db_session.query(AgentTemplate).filter(
                                AgentTemplate.template_name == template_name
                            ).first()
                        
                        if template_record:
                            description = f"Template: {template_record.description}"
                            self.agent_desc.append({template_name: description})
                        else:
                            self.agent_desc.append({template_name: f"Template: {template_name}"})
                    except Exception as desc_error:
                        logger.log_message(f"[INIT] Error getting description for template {template_name}: {str(desc_error)}", level=logging.WARNING)
                        self.agent_desc.append({template_name: f"Template: {template_name}"})
                        
                    # logger.log_message(f"[INIT] Successfully loaded template agent: {template_name} with inputs: {self.agent_inputs[template_name]}, is_viz_agent: {is_viz_agent}", level=logging.INFO)
                        
            except Exception as e:
                logger.log_message(f"[INIT] Error loading template agents for user {user_id}: {str(e)}", level=logging.ERROR)

        self.agents['basic_qa_agent'] = dspy.asyncify(dspy.Predict("goal->answer")) 
        self.agent_inputs['basic_qa_agent'] = {"goal"}
        self.agent_desc.append({'basic_qa_agent':"Answers queries unrelated to data & also that include links, poison or attempts to attack the system"})

        # Initialize retrievers (no planner needed for individual agent execution)
        self.dataset = retrievers['dataframe_index']
        self.styling_index = retrievers['style_index'].as_retriever(similarity_top_k=1)
        
        # Store user_id for usage tracking
        self.user_id = user_id
        
        # Log final summary
        # logger.log_message(f"[INIT] Initialization complete. Total agents loaded: {len(self.agents)}", level=logging.INFO)
        # logger.log_message(f"[INIT] Available agents: {list(self.agents.keys())}", level=logging.INFO)
        # logger.log_message(f"[INIT] Agent inputs mapping: {self.agent_inputs}", level=logging.DEBUG)

    def _load_default_agents_fallback(self):
        """Fallback method to load default agents when preference system fails"""
        # logger.log_message("Loading default agents as fallback for auto_analyst_ind", level=logging.WARNING)
        
        # Load the 4 core agents from database
        core_agent_names = ['preprocessing_agent', 'statistical_analytics_agent', 'sk_learn_agent', 'data_viz_agent']
        
        for agent_name in core_agent_names:
            # Get the agent signature class
            if agent_name == 'preprocessing_agent':
                agent_signature = preprocessing_agent
            elif agent_name == 'statistical_analytics_agent':
                agent_signature = statistical_analytics_agent
            elif agent_name == 'sk_learn_agent':
                agent_signature = sk_learn_agent
            elif agent_name == 'data_viz_agent':
                agent_signature = data_viz_agent
            
            # Add to agents dict
            self.agents[agent_name] = dspy.asyncify(dspy.ChainOfThought(agent_signature))
            
            # Set input fields based on signature
            if agent_name == 'data_viz_agent':
                self.agent_inputs[agent_name] = {'goal', 'dataset', 'styling_index', 'plan_instructions'}
            else:
                self.agent_inputs[agent_name] = {'goal', 'dataset', 'plan_instructions'}
            
            # Get description from database
            self.agent_desc.append({agent_name: get_agent_description(agent_name)})
            # logger.log_message(f"Added fallback agent: {agent_name}", level=logging.DEBUG)

    async def _track_agent_usage(self, agent_name):
        """Track usage for template agents"""
        try:
            # Skip tracking for standard agents
            if agent_name in ['preprocessing_agent', 'statistical_analytics_agent', 'sk_learn_agent', 'data_viz_agent', 'basic_qa_agent']:
                return
            
            # Only track if we have user_id (template agents)
            if not self.user_id:
                return
                
            from src.db.init_db import session_factory
            from src.db.schemas.models import AgentTemplate, UserTemplatePreference
            from datetime import datetime, UTC
            
            # Create database session
            session = session_factory()
            try:
                # Find the template
                template = session.query(AgentTemplate).filter(
                    AgentTemplate.template_name == agent_name
                ).first()
                
                if not template:
                    logger.log_message(f"Template '{agent_name}' not found for usage tracking", level=logging.WARNING)
                    return
                
                # Find or create user template preference record
                preference = session.query(UserTemplatePreference).filter(
                    UserTemplatePreference.user_id == self.user_id,
                    UserTemplatePreference.template_id == template.template_id
                ).first()
                
                if not preference:
                    # Create new preference record (disabled by default)
                    preference = UserTemplatePreference(
                        user_id=self.user_id,
                        template_id=template.template_id,
                        is_enabled=False,  # Disabled by default
                        usage_count=0,
                        last_used_at=None,
                        created_at=datetime.now(UTC),
                        updated_at=datetime.now(UTC)
                    )
                    session.add(preference)
                
                # Update usage tracking
                preference.usage_count += 1
                preference.last_used_at = datetime.now(UTC)
                preference.updated_at = datetime.now(UTC)
                session.commit()
                
                logger.log_message(
                    f"Tracked usage for template '{agent_name}' (count: {preference.usage_count})", 
                    level=logging.DEBUG
                )
                
            except Exception as e:
                session.rollback()
                logger.log_message(f"Error tracking usage for template {agent_name}: {str(e)}", level=logging.ERROR)
            finally:
                session.close()
                
        except Exception as e:
            logger.log_message(f"Error in _track_agent_usage for {agent_name}: {str(e)}", level=logging.ERROR)
    
    async def execute_agent(self, specified_agent, inputs):
        """Execute agent and generate memory summary in parallel"""
        try:
            # logger.log_message(f"[EXECUTE] Starting execution of agent: {specified_agent}", level=logging.INFO)
            # logger.log_message(f"[EXECUTE] Agent inputs: {inputs}", level=logging.DEBUG)
            
            # Execute main agent
            agent_result = await self.agents[specified_agent.strip()](**inputs)
            
            # Track usage for custom agents and templates
            await self._track_agent_usage(specified_agent.strip())
            
            # logger.log_message(f"[EXECUTE] Agent {specified_agent} execution completed successfully", level=logging.INFO)
            return specified_agent.strip(), dict(agent_result)
            
        except Exception as e:
            # logger.log_message(f"[EXECUTE] Error executing agent {specified_agent}: {str(e)}", level=logging.ERROR)

            # logger.log_message(f"[EXECUTE] Full traceback: {traceback.format_exc()}", level=logging.ERROR)
            return specified_agent.strip(), {"error": str(e)}

    async def forward(self, query, specified_agent):        
        try:
            # logger.log_message(f"[FORWARD] Processing query with specified agent: {specified_agent}", level=logging.INFO)
            # logger.log_message(f"[FORWARD] Query: {query}", level=logging.DEBUG)
            
            # If specified_agent contains multiple agents separated by commas
            # This is for handling multiple @agent mentions in one query
            if "," in specified_agent:
                agent_list = [agent.strip() for agent in specified_agent.split(",")]
                # logger.log_message(f"[FORWARD] Multiple agents detected: {agent_list}", level=logging.INFO)
                return await self.execute_multiple_agents(query, agent_list)
            
            # Process query with specified agent (single agent case)
            dict_ = {}
            dict_['dataset'] = self.dataset
            dict_['styling_index'] = self.styling_index.retrieve(query)[0].text
            
            dict_['hint'] = []
            dict_['goal'] = query
            dict_['Agent_desc'] = str(self.agent_desc)
                        
            if specified_agent.strip() not in self.agent_inputs:
                return {"response": f"Agent '{specified_agent.strip()}' not found in agent inputs"}
            
            # Create inputs that match exactly what the agent expects
            inputs = {}
            required_fields = self.agent_inputs[specified_agent.strip()]
            
            for field in required_fields:
                if field == 'goal':
                    inputs['goal'] = query
                elif field == 'dataset':
                    inputs['dataset'] = dict_['dataset']
                elif field == 'styling_index':
                    inputs['styling_index'] = dict_['styling_index']
                elif field == 'plan_instructions':
                    inputs['plan_instructions'] = ""  # Empty for individual agent use
                elif field == 'hint':
                    inputs['hint'] = ""  # Empty string for hint    
                else:
                    # For any other fields, try to get from dict_ if available
                    if field in dict_:
                        inputs[field] = dict_[field]
                    else:
                        inputs[field] = ""  # Provide empty string as fallback
            
            
            if specified_agent.strip() not in self.agents:
                return {"response": f"Agent '{specified_agent.strip()}' not found in agents"}
            
            result = await self.agents[specified_agent.strip()](**inputs)
                        
            # Track usage for template agents
            await self._track_agent_usage(specified_agent.strip())
            
            try:
                result_dict = dict(result)
            except Exception as dict_error:
                return {"response": f"Error converting agent result to dict: {str(dict_error)}"}
            
            output_dict = {specified_agent.strip(): result_dict}

            # Check for errors in the agent's response (not in the outer dict)
            if "error" in result_dict:
                return {"response": f"Error executing agent: {result_dict['error']}"}

            return output_dict

        except Exception as e:
            import traceback
            logger.log_message(f"[FORWARD] Full traceback: {traceback.format_exc()}", level=logging.ERROR)
            return {"response": f"This is the error from the system: {str(e)}"}
    
    async def execute_multiple_agents(self, query, agent_list):
        """Execute multiple agents sequentially on the same query"""
        try:
            logger.log_message(f"[MULTI] Executing multiple agents: {agent_list}", level=logging.INFO)
            
            # Initialize resources
            dict_ = {}
            dict_['dataset'] = self.dataset
            dict_['styling_index'] = self.styling_index.retrieve(query)[0].text
            dict_['hint'] = []
            dict_['goal'] = query
            dict_['Agent_desc'] = str(self.agent_desc)
            
            results = {}
            code_list = []
            
            # Execute each agent sequentially
            for agent_name in agent_list:
                logger.log_message(f"[MULTI] Processing agent: {agent_name}", level=logging.INFO)
                
                if agent_name not in self.agents:
                    logger.log_message(f"[MULTI] Agent '{agent_name}' not found", level=logging.ERROR)
                    results[agent_name] = {"error": f"Agent '{agent_name}' not found"}
                    continue
                
                # Create inputs that match exactly what the agent expects
                inputs = {}
                required_fields = self.agent_inputs[agent_name]
                
                logger.log_message(f"[MULTI] Required fields for {agent_name}: {required_fields}", level=logging.DEBUG)
                
                for field in required_fields:
                    if field == 'goal':
                        inputs['goal'] = query
                    elif field == 'dataset':
                        inputs['dataset'] = dict_['dataset']
                    elif field == 'styling_index':
                        inputs['styling_index'] = dict_['styling_index']
                    elif field == 'plan_instructions':
                        inputs['plan_instructions'] = ""  # Empty for individual agent use
                    elif field == 'hint':
                        inputs['hint'] = ""  # Empty string for hint
                    else:
                        # For any other fields, try to get from dict_ if available
                        if field in dict_:
                            inputs[field] = dict_[field]
                        else:
                            # logger.log_message(f"[MULTI] WARNING: Field '{field}' required by agent but not available in dict_", level=logging.WARNING)
                            pass
                
                # logger.log_message(f"[MULTI] Prepared inputs for {agent_name}: {list(inputs.keys())}", level=logging.DEBUG)
                
                # Execute agent
                try:
                    agent_result = await self.agents[agent_name](**inputs)
                    agent_dict = dict(agent_result)
                    results[agent_name] = agent_dict
                    
                    # Track usage for template agents
                    await self._track_agent_usage(agent_name)
                    
                    # Collect code for later combination
                    if 'code' in agent_dict:
                        code_list.append(agent_dict['code'])
                        
                    # logger.log_message(f"[MULTI] Successfully executed agent: {agent_name}", level=logging.INFO)
                    
                except Exception as agent_error:
                    # logger.log_message(f"[MULTI] Error executing agent {agent_name}: {str(agent_error)}", level=logging.ERROR)
                    results[agent_name] = {"error": str(agent_error)}
            
            # logger.log_message(f"[MULTI] Completed multiple agent execution. Results: {list(results.keys())}", level=logging.INFO)
            return results
            
        except Exception as e:
            logger.log_message(f"[MULTI] Error executing multiple agents: {str(e)}", level=logging.ERROR)
            return {"response": f"Error executing multiple agents: {str(e)}"}

class data_context_gen(dspy.Signature):
    """
        Generate a Python-friendly JSON structure that describes one or more datasets
    loaded from Excel or CSV files. This helps the system understand the dataset
    structure, semantics, and use cases.

    The JSON should include:
    - Dataset name and source (file or sheet)
    - Dataset role (transactional or reference)
    - Description or business purpose
    - Column names with:
        - Data type (string, int, float, date, etc.)
        - Semantic role: identifier, attribute, category, measure, temporal
    - Relationships to other datasets (optional, natural-language style)
    - Common metrics (as formulas or derived fields)
    - Example use cases

    Example format:
    {
      "datasets": {
        "sales_data": {
          "source": "Sales_Data.csv",
          "role": "transactional",
          "description": "Sales transactions across regions and products.",
          "columns": {
            "order_id": {"type": "string", "role": "identifier"},
            "order_date": {"type": "date", "role": "temporal"},
            "region": {"type": "string", "role": "category"},
            "product_id": {"type": "string", "role": "identifier"},
            "quantity": {"type": "int", "role": "measure"},
            "unit_price": {"type": "float", "role": "measure"}
          },
      "metrics": [
            "revenue = quantity * unit_price"
      ],
      "use_cases": [
            "Revenue trend analysis",
            "Regional sales comparison"
          ]
        }
      }
    }

    Column roles: identifier, attribute, category, measure, temporal
    Dataset roles: transactional, reference

    """
    user_description = dspy.InputField(desc="User's description of the data, including relationships")
    dataset_view = dspy.InputField(desc="Dataset name with sample head(5 rows) view")
    data_context = dspy.OutputField(desc="Compact JSON describing DuckDB tables, columns, relationships, metrics and use cases")

# This is the auto_analyst with planner
class auto_analyst(dspy.Module):
    """Main analyst module that coordinates multiple agents using a planner"""
    
    def __init__(self, agents, retrievers, user_id=None, db_session=None):
        # Initialize agent modules and retrievers
        self.agents = {}
        self.agent_inputs = {}
        self.agent_desc = []
        
        # Load user-enabled template agents if user_id and db_session are provided
        if user_id and db_session:
            try:
                # For planner use, load planner-enabled templates (max 10, prioritized by usage)
                template_signatures = load_user_enabled_templates_for_planner_from_db(user_id, db_session)

                # logger.log_message(f"Loaded {template_signatures} templates for planner use", level=logging.INFO)
                
                for template_name, signature in template_signatures.items():
                    # For planner module, load all planner variants (including core planner agents)
                    # Skip only individual variants, not planner variants
                        
                    # Add template agent to agents dict
                    self.agents[template_name] = dspy.asyncify(dspy.Predict(signature))
                    
                    # Determine if this is a visualization agent based on database category
                    is_viz_agent = False
                    try:
                        from src.db.schemas.models import AgentTemplate
                        
                        # Find template record to check category
                        template_record = db_session.query(AgentTemplate).filter(
                            AgentTemplate.template_name == template_name
                        ).first()
                        
                        if template_record and template_record.category and template_record.category.lower() == 'visualization':
                            is_viz_agent = True
                        else:
                            # Fallback to name-based detection for legacy templates
                            is_viz_agent = ('viz' in template_name.lower() or 
                                          'visual' in template_name.lower() or 
                                          'plot' in template_name.lower() or 
                                          'chart' in template_name.lower() or
                                          'matplotlib' in template_name.lower())
                    except Exception as cat_error:
                        logger.log_message(f"Error checking category for template {template_name}: {str(cat_error)}", level=logging.WARNING)
                        # Fallback to name-based detection
                        is_viz_agent = ('viz' in template_name.lower() or 
                                      'visual' in template_name.lower() or 
                                      'plot' in template_name.lower() or 
                                      'chart' in template_name.lower() or
                                      'matplotlib' in template_name.lower())
                    
                    # Set input fields based on agent type
                    if is_viz_agent:
                        self.agent_inputs[template_name] = {'goal', 'dataset', 'styling_index', 'plan_instructions'}
                    else:
                        self.agent_inputs[template_name] = {'goal', 'dataset', 'plan_instructions'}
                    
                    # Store template agent description
                    try:
                        if not template_record:
                            template_record = db_session.query(AgentTemplate).filter(
                                AgentTemplate.template_name == template_name
                            ).first()
                        
                        if template_record:
                            description = f"Template: {template_record.description}"
                            self.agent_desc.append({template_name: description})
                        else:
                            self.agent_desc.append({template_name: f"Template: {template_name}"})
                    except Exception as desc_error:
                        logger.log_message(f"Error getting description for template {template_name}: {str(desc_error)}", level=logging.WARNING)
                        self.agent_desc.append({template_name: f"Template: {template_name}"})
                                        
            except Exception as e:
                logger.log_message(f"Error loading template agents for user {user_id}: {str(e)}", level=logging.ERROR)

        # Load core planner agents based on user preferences (only planner variants for planner module)
        if len(self.agents) == 0 and user_id and db_session:
            # try:
                # Get user preferences for core planner agents
            from src.db.schemas.models import AgentTemplate, UserTemplatePreference
            
            # For planner module, use planner variants of core agents
            core_planner_agent_names = ['planner_preprocessing_agent', 'planner_statistical_analytics_agent', 'planner_sk_learn_agent', 'planner_data_viz_agent']
            
            for agent_name in core_planner_agent_names:
                # Check if user has enabled this core agent (check both planner and individual preferences)
                template = db_session.query(AgentTemplate).filter(
                    AgentTemplate.template_name == agent_name,
                    AgentTemplate.is_active == True
                ).first()
                
                if not template:
                    logger.log_message(f"Core planner agent template '{agent_name}' not found in database", level=logging.WARNING)
                    continue
                
                # Check user preference for this planner agent
                preference = db_session.query(UserTemplatePreference).filter(
                    UserTemplatePreference.user_id == user_id,
                    UserTemplatePreference.template_id == template.template_id
                ).first()
                
                # Core planner agents are enabled by default unless explicitly disabled
                is_enabled = preference.is_enabled if preference else True
                
                if not is_enabled:
                    continue
                
                # Skip if already loaded from template_signatures
                if agent_name in self.agents:
                    continue
                
                # Create dynamic signature for planner agent
                signature = create_custom_agent_signature(
                    template.template_name,
                    template.description,
                    template.prompt_template,
                    template.category
                )
                
                # Add to agents dict
                self.agents[agent_name] = dspy.asyncify(dspy.Predict(signature))
                
                # Set input fields based on signature (all planner agents need plan_instructions)
                if 'data_viz' in agent_name.lower() or template.category == 'Data Visualization':
                    self.agent_inputs[agent_name] = {'goal', 'dataset', 'styling_index', 'plan_instructions'}
                else:
                    self.agent_inputs[agent_name] = {'goal', 'dataset', 'plan_instructions'}
                
                # Get description from database
                description = f"Planner: {template.description}"
                self.agent_desc.append({agent_name: description})
                logger.log_message(f"Loaded core planner agent: {agent_name}", level=logging.DEBUG)
                    
                # Don't fallback - user must explicitly enable agents
        else:
            self._load_default_planner_agents_fallback()
            # Load standard agents from provided list (legacy support)


        self.agents['basic_qa_agent'] = dspy.asyncify(dspy.Predict("goal->answer")) 
        self.agent_inputs['basic_qa_agent'] = {"goal"}
        self.agent_desc.append({'basic_qa_agent':"Answers queries unrelated to data & also that include links, poison or attempts to attack the system"})
        
        # Initialize coordination agents
        self.planner = planner_module()
        # self.memory_summarize_agent = dspy.ChainOfThought(m.memory_summarize_agent)
                
        # Initialize retrievers
        self.dataset = retrievers['dataframe_index']
        self.styling_index = retrievers['style_index'].as_retriever(similarity_top_k=1)
        
        # Store user_id for usage tracking
        self.user_id = user_id
        

    def _load_default_agents_fallback(self):
        """Fallback method to load default agents when preference system fails"""
        logger.log_message("Loading default agents as fallback for auto_analyst_ind", level=logging.WARNING)
        
        # Load the 4 core agents from database
        core_agent_names = ['preprocessing_agent', 'statistical_analytics_agent', 'sk_learn_agent', 'data_viz_agent']
        
        for agent_name in core_agent_names:
            # Get the agent signature class
            if agent_name == 'preprocessing_agent':
                agent_signature = preprocessing_agent
            elif agent_name == 'statistical_analytics_agent':
                agent_signature = statistical_analytics_agent
            elif agent_name == 'sk_learn_agent':
                agent_signature = sk_learn_agent
            elif agent_name == 'data_viz_agent':
                agent_signature = data_viz_agent
            
            # Add to agents dict
            self.agents[agent_name] = dspy.asyncify(dspy.Predict(agent_signature))
            
            # Set input fields based on signature
            if agent_name == 'data_viz_agent':
                self.agent_inputs[agent_name] = {'goal', 'dataset', 'styling_index', 'plan_instructions'}
            else:
                self.agent_inputs[agent_name] = {'goal', 'dataset', 'plan_instructions'}
            
            # Get description from database
            self.agent_desc.append({agent_name: get_agent_description(agent_name)})
            logger.log_message(f"Added fallback agent: {agent_name}", level=logging.DEBUG)

    def _load_default_planner_agents_fallback(self):
        """Fallback method to load default planner agents when preference system fails"""
        logger.log_message("Loading default planner agents as fallback for auto_analyst", level=logging.WARNING)
        
        # For planner module, load the 4 core planner agents
        core_planner_agent_names = ['planner_preprocessing_agent', 'planner_statistical_analytics_agent', 'planner_sk_learn_agent', 'planner_data_viz_agent']
        
        for agent_name in core_planner_agent_names:
            # Skip if already loaded
            if agent_name in self.agents:
                continue
                
            # Create a basic signature for the planner agent as fallback
            # In production, these should come from the database
            if agent_name == 'planner_preprocessing_agent':
                base_signature = preprocessing_agent
                description = "Planner: Data preprocessing agent for multi-agent pipelines"
            elif agent_name == 'planner_statistical_analytics_agent':
                base_signature = statistical_analytics_agent
                description = "Planner: Statistical analytics agent for multi-agent pipelines"
            elif agent_name == 'planner_sk_learn_agent':
                base_signature = sk_learn_agent
                description = "Planner: Machine learning agent for multi-agent pipelines"
            elif agent_name == 'planner_data_viz_agent':
                base_signature = data_viz_agent
                description = "Planner: Data visualization agent for multi-agent pipelines"
            
            # Add to agents dict using base signature (fallback mode)
            self.agents[agent_name] = dspy.asyncify(dspy.ChainOfThought(base_signature))
            
            # Set input fields based on signature
            if 'data_viz' in agent_name:
                self.agent_inputs[agent_name] = {'goal', 'dataset', 'styling_index', 'plan_instructions'}
            else:
                self.agent_inputs[agent_name] = {'goal', 'dataset', 'plan_instructions'}
            
            # Add description
            self.agent_desc.append({agent_name: description})
            logger.log_message(f"Added fallback planner agent: {agent_name}", level=logging.DEBUG)

    async def _track_agent_usage(self, agent_name):
        """Track usage for template agents"""
        try:
            # Skip tracking for standard agents and basic_qa_agent (but DO track planner variants)
            if agent_name in ['preprocessing_agent', 'statistical_analytics_agent', 'sk_learn_agent', 'data_viz_agent', 'basic_qa_agent']:
                return
            
            # Only track if we have user_id (template agents)
            if not self.user_id:
                return
                
            from src.db.init_db import session_factory
            from src.db.schemas.models import AgentTemplate, UserTemplatePreference
            from datetime import datetime, UTC
            
            # Create database session
            session = session_factory()
            try:
                # Find the template
                template = session.query(AgentTemplate).filter(
                    AgentTemplate.template_name == agent_name
                ).first()
                
                if not template:
                    logger.log_message(f"Template '{agent_name}' not found for usage tracking", level=logging.WARNING)
                    return
                
                # Find or create user template preference record
                preference = session.query(UserTemplatePreference).filter(
                    UserTemplatePreference.user_id == self.user_id,
                    UserTemplatePreference.template_id == template.template_id
                ).first()
                
                if not preference:
                    # Create new preference record (disabled by default)
                    preference = UserTemplatePreference(
                        user_id=self.user_id,
                        template_id=template.template_id,
                        is_enabled=False,  # Disabled by default
                        usage_count=0,
                        last_used_at=None,
                        created_at=datetime.now(UTC),
                        updated_at=datetime.now(UTC)
                    )
                    session.add(preference)
                
                # Update usage tracking
                preference.usage_count += 1
                preference.last_used_at = datetime.now(UTC)
                preference.updated_at = datetime.now(UTC)
                session.commit()
                
                logger.log_message(
                    f"Tracked usage for template '{agent_name}' (count: {preference.usage_count})", 
                    level=logging.DEBUG
                )
                
            except Exception as e:
                session.rollback()
                logger.log_message(f"Error tracking usage for template {agent_name}: {str(e)}", level=logging.ERROR)
            finally:
                session.close()
                
        except Exception as e:
            logger.log_message(f"Error in _track_agent_usage for {agent_name}: {str(e)}", level=logging.ERROR)



    async def get_plan(self, query):
        """Get the analysis plan"""
        dict_ = {}
        dict_['dataset'] = self.dataset
        dict_['styling_index'] = self.styling_index.retrieve(query)[0].text
        dict_['goal'] = query
        dict_['Agent_desc'] = str(self.agent_desc)
        
        
        # try:
        # with dspy.context(lm=gpt_4o_mini):
        module_return = await self.planner(
            goal=dict_['goal'], 
            dataset=dict_['dataset'], 
            Agent_desc=dict_['Agent_desc']
        )

        logger.log_message(f"Module return: {module_return}", level=logging.INFO)
        
        # Add None check before accessing dictionary keys
        if module_return is None:
            logger.log_message("Planner returned None, returning error response", level=logging.ERROR)
            return {
                "plan": "There was an error" + str(dict_) +'\n'+ str(dspy.inspect_history()) +'\n agent_desc_len'+ str(len(self.agent_desc)) + '\n agents_len'+ str(len(self.agents)),
                "plan_instructions": {},
                "complexity": "unknown",
                "error": "Planner failed to generate a plan"
            }

        # Handle different plan formats
        plan = module_return['plan']
        logger.log_message(f"Plan from module_return: {plan}, type: {type(plan)}", level=logging.INFO)
        
        # If plan is a string (agent name), convert to proper format
        if isinstance(plan, str):
            if 'complexity' in module_return:
                complexity = module_return['complexity']
            else:
                complexity = 'basic'
                
            plan_dict = {
                'plan': plan,
                'complexity': complexity
            }
            
            # Add plan_instructions if available
            if 'plan_instructions' in module_return:
                plan_dict['plan_instructions'] = module_return['plan_instructions']
            else:
                plan_dict['plan_instructions'] = {}
        else:
            # If plan is already a dict, use it directly
            plan_dict = dict(plan) if not isinstance(plan, dict) else plan
            if 'complexity' in module_return:
                complexity = module_return['complexity']
            else:
                complexity = 'basic'
            plan_dict['complexity'] = complexity
            
        logger.log_message(f"Final plan dict: {plan_dict}", level=logging.INFO)

        return plan_dict
            
        # except Exception as e:
        #     logger.log_message(f"Error in get_plan: {str(e)}", level=logging.ERROR)
        #     raise

    async def execute_plan(self, query, plan):
        """Execute the plan and yield results as they complete"""
        
        dict_ = {}
        dict_['dataset'] = self.dataset
        dict_['styling_index'] = self.styling_index.retrieve(query)[0].text
        dict_['hint'] = []
        dict_['goal'] = query
        

        # Clean and split the plan string into agent names
        plan_text = plan.get("plan", "").lower().replace("plan:", "").strip()
        logger.log_message(f"Plan text: {plan_text}", level=logging.INFO)
        
        if "basic_qa_agent" in plan_text:
            inputs = dict(goal=query)

            response = await self.agents['basic_qa_agent'](**inputs)
            yield 'basic_qa_agent', inputs, response 
            return 
            

        plan_list = []
        for agent in [a.strip() for a in plan_text.split("->") if a.strip()]:
            if not agent.startswith("planner_"):
                agent = "planner_" + agent
            plan_list.append(agent)

        

        logger.log_message(f"Plan list: {plan_list}", level=logging.INFO)
        # Parse the attached plan_instructions into a dict
        raw_instr = plan.get("plan_instructions", {})
        if isinstance(raw_instr, str):
            try:
                plan_instructions = json.loads(raw_instr)
            except Exception as e:
                logger.log_message(f"Error parsing plan_instructions JSON: {str(e)}", level=logging.ERROR)
                plan_instructions = {}
        elif isinstance(raw_instr, dict):
            plan_instructions = raw_instr
        else:
            plan_instructions = {}


        # Check if we have no valid agents to execute
        if not plan_list:
            if len(plan_text) != 0: 
                yield "plan_not_formatted_correctly", str(plan_text), {'error': "There was a error in the formatting"}

            return

        # Execute agents in sequence
        for agent_name in plan_list:
                        
            try:
                # Prepare inputs for the agent
                inputs = {x: dict_[x] for x in self.agent_inputs[agent_name] if x in dict_}
                
                # Add plan instructions if available for this agent
                if agent_name in plan_instructions:
                    inputs['plan_instructions'] = plan_instructions[agent_name]
                else:
                    inputs['plan_instructions'] = ""
                
                # logger.log_message(f"Agent inputs for {agent_name}: {inputs}", level=logging.INFO)
            

                result = await self.agents[agent_name.strip()](**inputs)
                
                # Track usage for custom agents and templates
                await self._track_agent_usage(agent_name.strip())
                # Execute the agent
            
                
                yield agent_name, inputs, result
                    
            except Exception as e:
                logger.log_message(f"Error executing agent {agent_name}: {str(e)}", level=logging.ERROR)
                yield agent_name, {}, {"error": f"Error executing {agent_name}: {str(e)}"}
        return
        

