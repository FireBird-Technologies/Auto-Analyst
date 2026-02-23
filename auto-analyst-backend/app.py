# Standard library imports

import asyncio

import json

import logging

import os

import time

import uuid

from io import StringIO

from typing import List, Optional

import ast

import markdown

from bs4 import BeautifulSoup

import pandas as pd

from datetime import datetime, UTC

# Third-party imports

import uvicorn

from dotenv import load_dotenv

from fastapi import (

    Depends, 

    FastAPI, 

    File, 

    Form, 

    HTTPException, 

    Request, 

    UploadFile

)

from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import JSONResponse, StreamingResponse

from fastapi.security import APIKeyHeader

from llama_index.core import Document, VectorStoreIndex

from pydantic import BaseModel



# Local application imports

from scripts.format_response import format_response_to_markdown

from src.agents.agents import *

from src.agents.retrievers.retrievers import *

from src.managers.ai_manager import AI_Manager

from src.managers.session_manager import SessionManager

from src.managers.app_manager import AppState

from src.routes.analytics_routes import router as analytics_router

from src.routes.blog_routes import router as blog_router

from src.routes.chat_routes import router as chat_router

from src.routes.code_routes import router as code_router

from src.routes.feedback_routes import router as feedback_router

from src.routes.session_routes import router as session_router, get_session_id_dependency

from src.routes.deep_analysis_routes import router as deep_analysis_router

from src.routes.templates_routes import router as templates_router

from src.schemas.query_schema import QueryRequest

from src.utils.logger import Logger

from src.routes.session_routes import apply_model_safeguards


# Import deep analysis components directly

# from src.agents.try_deep_agents import deep_analysis_module

from src.agents.deep_agents import deep_analysis_module

from src.utils.generate_report import generate_html_report



from src.utils.model_registry import MODEL_OBJECTS



logger = Logger("app", see_time=True, console_log=True)

load_dotenv()



# Request models

class DeepAnalysisRequest(BaseModel):

    goal: str

    

class DeepAnalysisResponse(BaseModel):

    goal: str

    deep_questions: str

    deep_plan: str

    summaries: List[str]

    code: str

    plotly_figs: List

    synthesis: List[str]

    final_conclusion: str

    html_report: Optional[str] = None



styling_instructions =  [
    {
        "category": "line_charts",
        "description": "Used to visualize trends and changes over time, often with multiple series.",
        "styling": {
            "template": "plotly_white",
            "axes_line_width": 0.2,
            "grid_width": 1,
            "title": {
                "bold_html": True,
                "include": True
            },
            "colors": "use multiple colors if more than one line",
            "annotations": ["min", "max"],
            "number_format": {
                "apply_k_m": True,
                "thresholds": {"K": 1000, "M": 100000},
                "percentage_decimals": 2,
                "percentage_sign": True
            },
            "default_size": {"height": 1200, "width": 1000}
        }
    },
    {
        "category": "bar_charts",
        "description": "Useful for comparing discrete categories or groups with bars representing values.",
        "styling": {
            "template": "plotly_white",
            "axes_line_width": 0.2,
            "grid_width": 1,
            "title": {"bold_html": True, "include": True},
            "annotations": ["bar values"],
            "number_format": {
                "apply_k_m": True,
                "thresholds": {"K": 1000, "M": 100000},
                "percentage_decimals": 2,
                "percentage_sign": True
            },
            "default_size": {"height": 1200, "width": 1000}
        }
    },
    {
        "category": "histograms",
        "description": "Display the distribution of a data set, useful for returns or frequency distributions.",
        "styling": {
            "template": "plotly_white",
            "bin_size": 50,
            "axes_line_width": 0.2,
            "grid_width": 1,
            "title": {"bold_html": True, "include": True},
            "annotations": ["x values"],
            "number_format": {
                "apply_k_m": True,
                "thresholds": {"K": 1000, "M": 100000},
                "percentage_decimals": 2,
                "percentage_sign": True
            },
            "default_size": {"height": 1200, "width": 1000}
        }
    },
    {
        "category": "pie_charts",
        "description": "Show composition or parts of a whole with slices representing categories.",
        "styling": {
            "template": "plotly_white",
            "top_categories_to_show": 10,
            "bundle_rest_as": "Others",
            "axes_line_width": 0.2,
            "grid_width": 1,
            "title": {"bold_html": True, "include": True},
            "annotations": ["x values"],
            "number_format": {
                "apply_k_m": True,
                "thresholds": {"K": 1000, "M": 100000},
                "percentage_decimals": 2,
                "percentage_sign": True
            },
            "default_size": {"height": 1200, "width": 1000}
        }
    },
    {
        "category": "tabular_and_generic_charts",
        "description": "Applies to charts where number formatting needs flexibility, including mixed or raw data.",
        "styling": {
            "template": "plotly_white",
            "axes_line_width": 0.2,
            "grid_width": 1,
            "title": {"bold_html": True, "include": True},
            "annotations": ["x values"],
            "number_format": {
                "apply_k_m": True,
                "thresholds": {"K": 1000, "M": 100000},
                "exclude_if_commas_present": True,
                "exclude_if_not_numeric": True,
                "percentage_decimals": 2,
                "percentage_sign": True
            },
            "default_size": {"height": 1200, "width": 1000}
        }
    },
    {
        "category": "heat_maps",
        "description": "Show data density or intensity using color scales on a matrix or grid.",
        "styling": {
            "template": "plotly_white",
            "axes_styles": {
                "line_color": "black",
                "line_width": 0.2,
                "grid_width": 1,
                "format_numbers_as_k_m": True,
                "exclude_non_numeric_formatting": True
            },
            "title": {"bold_html": True, "include": True},
            "default_size": {"height": 1200, "width": 1000}
        }
    },
    {
        "category": "histogram_distribution",
        "description": "Specialized histogram for return distributions with opacity control.",
        "styling": {
            "template": "plotly_white",
            "opacity": 0.75,
            "axes_styles": {
                "grid_width": 1,
                "format_numbers_as_k_m": True,
                "exclude_non_numeric_formatting": True
            },
            "title": {"bold_html": True, "include": True},
            "default_size": {"height": 1200, "width": 1000}
        }
    }
]

# Convert to list of JSON strings
styling_instructions = [str(chart_dict) for chart_dict in styling_instructions]

# Output (just show first 2 for readability)




# Add near the top of the file, after imports

DEFAULT_MODEL_CONFIG = {
    "provider": os.getenv("MODEL_PROVIDER", "openai"),
    "model": os.getenv("MODEL_NAME", "gpt-5-mini"),
    "api_key": os.getenv("OPENAI_API_KEY"),
    "temperature": min(1.0, max(0.0, float(os.getenv("TEMPERATURE", "1.0")))),  # Clamp to 0..1
    "max_tokens": int(os.getenv("MAX_TOKENS", 6000)), "cache": False

}



# Create default LM config but don't set it globally



default_lm = MODEL_OBJECTS[DEFAULT_MODEL_CONFIG['model']]

    



    

# lm = dspy.LM('openai/gpt-4o-mini', api_key=os.getenv("OPENAI_API_KEY"))

dspy.configure(lm=default_lm, async_max_workers=1000)



# Function to get model config from session or use default

def get_session_lm(session_state):

    """Get the appropriate LM instance for a session, or default if not configured"""

    # First check if we have a valid session-specific model config 

    if session_state and isinstance(session_state, dict) and "model_config" in session_state:

        model_config = session_state["model_config"]

        if model_config and isinstance(model_config, dict) and "model" in model_config:

            # Found valid session-specific model config, use it

            provider = model_config.get("provider", "openai").lower()

            model_name = model_config.get("model", DEFAULT_MODEL_CONFIG["model"])

            # Import and apply centralized safeguards (temperature + max_tokens)
            

            requested_temp = model_config.get("temperature", DEFAULT_MODEL_CONFIG["temperature"])
            requested_max = model_config.get("max_tokens", DEFAULT_MODEL_CONFIG["max_tokens"])

            safe_params = apply_model_safeguards(
                model_name=model_name,
                provider=provider,
                temperature=requested_temp,
                max_tokens=requested_max,
            )

            # Apply the safeguarded parameters
            MODEL_OBJECTS[model_name].__dict__['kwargs']['max_tokens'] = safe_params["max_tokens"]
            MODEL_OBJECTS[model_name].__dict__['kwargs']['temperature'] = safe_params["temperature"]



    

    # If no valid session config, use default

    return MODEL_OBJECTS[model_name]



# Initialize retrievers with empty data first



# clear console

def clear_console():

    os.system('cls' if os.name == 'nt' else 'clear')





# Check for Housing.csv

housing_csv_path = "Housing.csv"

if not os.path.exists(housing_csv_path):

    logger.log_message(f"Housing.csv not found at {os.path.abspath(housing_csv_path)}", level=logging.ERROR)

    raise FileNotFoundError(f"Housing.csv not found at {os.path.abspath(housing_csv_path)}")



# All agents are now loaded from database - no hardcoded dictionaries needed



# Add session header

X_SESSION_ID = APIKeyHeader(name="X-Session-ID", auto_error=False)



# Update AppState class to use SessionManager

# The AppState class is now in src.managers.app_manager



# Initialize FastAPI app with state

app = FastAPI(title="AI Analytics API", version="1.0")

# Pass required parameters to AppState
app.state = AppState(styling_instructions, chat_history_name_agent, DEFAULT_MODEL_CONFIG)





# Configure middleware

# Use a wildcard for local development or read from environment

is_development = os.getenv("ENVIRONMENT", "development").lower() == "development"



allowed_origins = []

frontend_url = os.getenv("FRONTEND_URL", "").strip()

print(f"FRONTEND_URL: {frontend_url}")

if is_development:

    allowed_origins = ["*"]

elif frontend_url:

    allowed_origins = [frontend_url]

else:

    logger.log_message("CORS misconfigured: FRONTEND_URL not set", level=logging.ERROR)

    allowed_origins = []  # or set a default safe origin



# Add a strict origin verification middleware

@app.middleware("http")

async def verify_origin_middleware(request: Request, call_next):

    # Skip origin check in development mode

    if is_development:

        return await call_next(request)

    

    # Get the origin from the request headers

    origin = request.headers.get("origin")

    

    # Log the origin for debugging

    if origin:

        print(f"Request from origin: {origin}")

    

    # If no origin header or origin not in allowed list, reject the request

    if origin and frontend_url and origin != frontend_url:

        print(f"Blocked request from unauthorized origin: {origin}")

        return JSONResponse(

            status_code=403,

            content={"detail": "Not authorized"}

        )

    

    # Continue processing the request if origin is allowed

    return await call_next(request)



# CORS middleware (still needed for browser preflight)

app.add_middleware(

    CORSMiddleware,

    allow_origins=allowed_origins,

    allow_origin_regex=None,

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],

    expose_headers=["*"],

    max_age=600  # Cache preflight requests for 10 minutes (for performance)

)



# Add these constants at the top of the file with other imports/constants

RESPONSE_ERROR_INVALID_QUERY = "Please provide a valid query..."

RESPONSE_ERROR_NO_DATASET = "No dataset is currently loaded. Please link a dataset before proceeding with your analysis."

DEFAULT_TOKEN_RATIO = 1.5

REQUEST_TIMEOUT_SECONDS = 90 # Timeout for LLM requests

MAX_RECENT_MESSAGES = 5

DB_BATCH_SIZE = 10  # For future batch DB operations



@app.post("/chat/{agent_name}", response_model=dict)

async def chat_with_agent(

    agent_name: str, 

    request: QueryRequest,

    request_obj: Request,

    session_id: str = Depends(get_session_id_dependency)

):

    session_state = app.state.get_session_state(session_id)

    logger.log_message(f"[DEBUG] chat_with_agent called with agent: '{agent_name}', query: '{request.query[:100]}...'", level=logging.DEBUG)

    

    try:

        # Extract and validate query parameters

        logger.log_message(f"[DEBUG] Updating session from query params", level=logging.DEBUG)

        _update_session_from_query_params(request_obj, session_state)

        logger.log_message(f"[DEBUG] Session state after query params: user_id={session_state.get('user_id')}, chat_id={session_state.get('chat_id')}", level=logging.DEBUG)

        

        # Validate dataset and agent name

        if session_state["datasets"] is None:
            logger.log_message(f"[DEBUG] No dataset loaded", level=logging.DEBUG)

            raise HTTPException(status_code=400, detail=RESPONSE_ERROR_NO_DATASET)



        # Log the dataset being used for analysis with detailed information
        datasets = session_state["datasets"]
        dataset_names = list(datasets.keys())
        if dataset_names:
            current_dataset_name = dataset_names[-1]  # Get the last (most recent) dataset
            dataset_shape = datasets[current_dataset_name].shape
            
            # Check if this is the default dataset and explain why
            session_name = session_state.get("name", "")
            is_default_dataset = (current_dataset_name == "df" and session_name == "Housing.csv") or current_dataset_name == "Housing.csv"
            
            if is_default_dataset:
                logger.log_message(f"[ANALYSIS] Using DEFAULT dataset 'Housing.csv' for analysis (shape: {dataset_shape[0]} rows, {dataset_shape[1]} columns)", level=logging.INFO)
                logger.log_message(f"[ANALYSIS] Reason: No custom dataset uploaded yet - using default Housing.csv dataset", level=logging.INFO)
            else:
                logger.log_message(f"[ANALYSIS] Using CUSTOM dataset '{current_dataset_name}' for analysis (shape: {dataset_shape[0]} rows, {dataset_shape[1]} columns)", level=logging.INFO)
                logger.log_message(f"[ANALYSIS] This is a user-uploaded dataset, not the default", level=logging.INFO)
        else:
            logger.log_message(f"[ANALYSIS] No datasets available in session {session_id}", level=logging.WARNING)

        logger.log_message(f"[DEBUG] About to validate agent name: '{agent_name}'", level=logging.DEBUG)

        _validate_agent_name(agent_name, session_state)

        logger.log_message(f"[DEBUG] Agent validation completed successfully", level=logging.DEBUG)

        

        # Record start time for timing

        start_time = time.time()

        

        # Get chat context and prepare query

        logger.log_message(f"[DEBUG] Preparing query with context", level=logging.DEBUG)

        enhanced_query = _prepare_query_with_context(request.query, session_state)

        logger.log_message(f"[DEBUG] Enhanced query length: {len(enhanced_query)}", level=logging.DEBUG)

        

        # Initialize agent - handle standard, template, and custom agents

        if "," in agent_name:

            logger.log_message(f"[DEBUG] Processing multiple agents: {agent_name}", level=logging.DEBUG)

            # Multiple agents case

            agent_list = [agent.strip() for agent in agent_name.split(",")]

            

            # Categorize agents

            standard_agents = [agent for agent in agent_list if _is_standard_agent(agent)]

            template_agents = [agent for agent in agent_list if _is_template_agent(agent)]

            custom_agents = [agent for agent in agent_list if not _is_standard_agent(agent) and not _is_template_agent(agent)]

            

            logger.log_message(f"[DEBUG] Agent categorization - standard: {standard_agents}, template: {template_agents}, custom: {custom_agents}", level=logging.DEBUG)

            

            if custom_agents:

                # If any custom agents, use session AI system for all

                ai_system = session_state["ai_system"]

                session_lm = get_session_lm(session_state)

                logger.log_message(f"[DEBUG] Using custom agent execution path", level=logging.DEBUG)

                with dspy.context(lm=session_lm):

                    response = await asyncio.wait_for(

                        _execute_custom_agents(ai_system, agent_list, enhanced_query),

                        timeout=REQUEST_TIMEOUT_SECONDS

                    )

                    logger.log_message(f"[DEBUG] Custom agents response type: {type(response)}, keys: {list(response.keys()) if isinstance(response, dict) else 'not a dict'}", level=logging.DEBUG)

            else:

                # All standard/template agents - use auto_analyst_ind which loads from DB

                user_id = session_state.get("user_id")

                logger.log_message(f"[DEBUG] Using auto_analyst_ind for multiple standard/template agents with user_id: {user_id}", level=logging.DEBUG)

        

                # Create database session for agent loading

                from src.db.init_db import session_factory

                db_session = session_factory()

                try:

                    # auto_analyst_ind will load all agents from database

                    logger.log_message(f"[DEBUG] Creating auto_analyst_ind instance", level=logging.DEBUG)

                    agent = auto_analyst_ind(agents=[], retrievers=session_state["retrievers"], user_id=user_id, db_session=db_session)

                    session_lm = get_session_lm(session_state)

                    logger.log_message(f"[DEBUG] About to call agent.forward with query and agent list", level=logging.DEBUG)

                    with dspy.context(lm=session_lm):

                        response = await asyncio.wait_for(

                            agent(enhanced_query, ",".join(agent_list)),

                            timeout=REQUEST_TIMEOUT_SECONDS

                        )

                        logger.log_message(f"[DEBUG] auto_analyst_ind response type: {type(response)}, content: {str(response)[:200]}...", level=logging.DEBUG)

                finally:

                    db_session.close()

        else:

            logger.log_message(f"[DEBUG] Processing single agent: {agent_name}", level=logging.DEBUG)

            # Single agent case

            if _is_standard_agent(agent_name) or _is_template_agent(agent_name):

                # Standard or template agent - use auto_analyst_ind which loads from DB

                user_id = session_state.get("user_id")

                logger.log_message(f"[DEBUG] Using auto_analyst_ind for single standard/template agent '{agent_name}' with user_id: {user_id}", level=logging.DEBUG)

                

                # Create database session for agent loading

                from src.db.init_db import session_factory

                db_session = session_factory()

                try:

                    # auto_analyst_ind will load all agents from database

                    logger.log_message(f"[DEBUG] Creating auto_analyst_ind instance for single agent", level=logging.DEBUG)

                    agent = auto_analyst_ind(agents=[], retrievers=session_state["retrievers"], user_id=user_id, db_session=db_session)

                    session_lm = get_session_lm(session_state)

                    logger.log_message(f"[DEBUG] About to call agent.forward for single agent '{agent_name}'", level=logging.DEBUG)

                    with dspy.context(lm=session_lm):

                        response = await asyncio.wait_for(

                            agent(enhanced_query, agent_name),

                            timeout=REQUEST_TIMEOUT_SECONDS

                        )

                        logger.log_message(f"[DEBUG] Single agent response type: {type(response)}, content: {str(response)[:200]}...", level=logging.DEBUG)

                finally:

                    db_session.close()

            else:

                # Custom agent - use session AI system

                ai_system = session_state["ai_system"]

                session_lm = get_session_lm(session_state)

                logger.log_message(f"[DEBUG] Using custom agent execution for '{agent_name}'", level=logging.DEBUG)

                with dspy.context(lm=session_lm):

                    response = await asyncio.wait_for(

                        _execute_custom_agents(ai_system, [agent_name], enhanced_query),

                        timeout=REQUEST_TIMEOUT_SECONDS

                    )

                    logger.log_message(f"[DEBUG] Custom single agent response type: {type(response)}, content: {str(response)[:200]}...", level=logging.DEBUG)

        

        logger.log_message(f"[DEBUG] About to format response to markdown. Response type: {type(response)}", level=logging.DEBUG)

        formatted_response = format_response_to_markdown(response, agent_name, session_state["datasets"])
        logger.log_message(f"[DEBUG] Formatted response type: {type(formatted_response)}, length: {len(str(formatted_response))}", level=logging.DEBUG)

        

        if formatted_response == RESPONSE_ERROR_INVALID_QUERY:

            logger.log_message(f"[DEBUG] Response was invalid query error", level=logging.DEBUG)

            return {

                "agent_name": agent_name,

                "query": request.query,

                "response": formatted_response,

                "session_id": session_id

            }

        

        # Track usage statistics

        if session_state.get("user_id"):

            logger.log_message(f"[DEBUG] Tracking model usage", level=logging.DEBUG)

            _track_model_usage(

                session_state=session_state,

                enhanced_query=enhanced_query,

                response=response,

                processing_time_ms=int((time.time() - start_time) * 1000)

            )

        

        logger.log_message(f"[DEBUG] chat_with_agent completed successfully", level=logging.DEBUG)

        return {

            "agent_name": agent_name,

            "query": request.query,  # Return original query without context

            "response": formatted_response,

            "session_id": session_id

        }

    except HTTPException:

        # Re-raise HTTP exceptions to preserve status codes

        logger.log_message(f"[DEBUG] HTTPException caught and re-raised", level=logging.DEBUG)

        raise

    except asyncio.TimeoutError:

        logger.log_message(f"[ERROR] Timeout error in chat_with_agent", level=logging.ERROR)

        raise HTTPException(status_code=504, detail="Request timed out. Please try a simpler query.")

    except Exception as e:

        logger.log_message(f"[ERROR] Unexpected error in chat_with_agent: {str(e)}", level=logging.ERROR)

        logger.log_message(f"[ERROR] Exception type: {type(e)}, traceback: {str(e)}", level=logging.ERROR)

        import traceback

        logger.log_message(f"[ERROR] Full traceback: {traceback.format_exc()}", level=logging.ERROR)

        raise HTTPException(status_code=500, detail="An unexpected error occurred. Please try again later.")





@app.post("/chat", response_model=dict)

async def chat_with_all(

    request: QueryRequest,

    request_obj: Request,

    session_id: str = Depends(get_session_id_dependency)

):

    session_state = app.state.get_session_state(session_id)



    try:

        # Extract and validate query parameters

        _update_session_from_query_params(request_obj, session_state)

        

        # Validate dataset

        if session_state["datasets"] is None:
            raise HTTPException(status_code=400, detail=RESPONSE_ERROR_NO_DATASET)

        

        if session_state["ai_system"] is None:

            raise HTTPException(status_code=500, detail="AI system not properly initialized.")



        # Get session-specific model

        session_lm = get_session_lm(session_state)



        # Create streaming response

        return StreamingResponse(

            _generate_streaming_responses(session_state, request.query, session_lm),

            media_type='text/event-stream',

            headers={

                'Cache-Control': 'no-cache',

                'Connection': 'keep-alive',

                'Content-Type': 'text/event-stream',

                'Access-Control-Allow-Origin': '*',

                'X-Accel-Buffering': 'no'

            }

        )

    except HTTPException:

        # Re-raise HTTP exceptions to preserve status codes

        raise

    except Exception as e:

        raise HTTPException(status_code=500, detail="An unexpected error occurred. Please try again later.")





# Helper functions to reduce duplication and improve modularity

def _update_session_from_query_params(request_obj: Request, session_state: dict):

    """Extract and validate chat_id and user_id from query parameters"""

    # Check for chat_id in query parameters

    if "chat_id" in request_obj.query_params:

        try:

            chat_id_param = int(request_obj.query_params.get("chat_id"))

            # Update session state with this chat ID

            session_state["chat_id"] = chat_id_param

        except (ValueError, TypeError):

            logger.log_message("Invalid chat_id parameter", level=logging.WARNING)

            # Continue without updating chat_id



    # Check for user_id in query parameters

    if "user_id" in request_obj.query_params:

        try:

            user_id = int(request_obj.query_params["user_id"])

            session_state["user_id"] = user_id

        except (ValueError, TypeError):

            raise HTTPException(

                status_code=400,

                detail="Invalid user_id in query params. Please provide a valid integer."

            )





def _validate_agent_name(agent_name: str, session_state: dict = None):

    """Validate that the agent name(s) are available"""

    logger.log_message(f"[DEBUG] Validating agent name: '{agent_name}'", level=logging.DEBUG)

    

    if "," in agent_name:

        # Multiple agents

        agent_list = [agent.strip() for agent in agent_name.split(",")]

        logger.log_message(f"[DEBUG] Multiple agents detected: {agent_list}", level=logging.DEBUG)

        for agent in agent_list:

            is_available = _is_agent_available(agent, session_state)

            logger.log_message(f"[DEBUG] Agent '{agent}' availability: {is_available}", level=logging.DEBUG)

            if not is_available:

                available_agents = _get_available_agents_list(session_state)

                logger.log_message(f"[DEBUG] Agent '{agent}' not found. Available: {available_agents}", level=logging.DEBUG)

                raise HTTPException(

                    status_code=400, 

                    detail=f"Agent '{agent}' not found. Available agents: {available_agents}"

                )

    else:

        # Single agent

        is_available = _is_agent_available(agent_name, session_state)

        logger.log_message(f"[DEBUG] Single agent '{agent_name}' availability: {is_available}", level=logging.DEBUG)

        if not is_available:

            available_agents = _get_available_agents_list(session_state)

            logger.log_message(f"[DEBUG] Agent '{agent_name}' not found. Available: {available_agents}", level=logging.DEBUG)

            raise HTTPException(

                status_code=400, 

                detail=f"Agent '{agent_name}' not found. Available agents: {available_agents}"

            )

    

    logger.log_message(f"[DEBUG] Agent validation passed for: '{agent_name}'", level=logging.DEBUG)



def _is_agent_available(agent_name: str, session_state: dict = None) -> bool:

    """Check if an agent is available (standard, template, or custom)"""

    # Check if it's a standard agent

    if _is_standard_agent(agent_name):

        return True

    

    # Check if it's a template agent

    if _is_template_agent(agent_name):

        return True

    

    # Check if it's a custom agent in session

    if session_state and "ai_system" in session_state:

        ai_system = session_state["ai_system"]

        if hasattr(ai_system, 'agents') and agent_name in ai_system.agents:

            return True

    

    return False



def _get_available_agents_list(session_state: dict = None) -> list:

    """Get list of all available agents from database"""

    from src.db.init_db import session_factory

    from src.agents.agents import load_all_available_templates_from_db

    

    # Core agents (always available)

    available = ["preprocessing_agent", "statistical_analytics_agent", "sk_learn_agent", "data_viz_agent"]

    

    # Add template agents from database

    db_session = session_factory()

    try:

        template_agents_dict = load_all_available_templates_from_db(db_session)

        # template_agents_dict is a dict with template_name as keys

        template_names = [template_name for template_name in template_agents_dict.keys() 

                         if template_name not in available and template_name != 'basic_qa_agent']

        available.extend(template_names)

    except Exception as e:

        logger.log_message(f"Error loading template agents: {str(e)}", level=logging.ERROR)

    finally:

        db_session.close()

    

    return available



def _is_standard_agent(agent_name: str) -> bool:

    """Check if agent is one of the 4 core standard agents"""

    standard_agents = ["preprocessing_agent", "statistical_analytics_agent", "sk_learn_agent", "data_viz_agent"]

    return agent_name in standard_agents



def _is_template_agent(agent_name: str) -> bool:

    """Check if agent is a template agent"""

    try:

        from src.db.init_db import session_factory

        from src.db.schemas.models import AgentTemplate

        

        db_session = session_factory()

        try:

            template = db_session.query(AgentTemplate).filter(

                AgentTemplate.template_name == agent_name,

                AgentTemplate.is_active == True

            ).first()

            return template is not None

        finally:

            db_session.close()

    except Exception as e:

        logger.log_message(f"Error checking if {agent_name} is template: {str(e)}", level=logging.ERROR)

        return False



async def _execute_custom_agents(ai_system, agent_names: list, query: str):

    """Execute custom agents using the session's AI system"""

    try:

        # For custom agents, we need to use the AI system's execute_agent method



        agent_results = [ai_system]

        if len(agent_names) == 1:

            # Single custom agent

            agent_name = agent_names[0]

            # Prepare inputs for the custom agent (similar to standard agents like data_viz_agent)

            dict_ = {}

            dict_['dataset'] = ai_system.dataset.retrieve(query)[0].text

            dict_['styling_index'] = ai_system.styling_index.retrieve(query)[0].text

            dict_['goal'] = query

            dict_['Agent_desc'] = str(ai_system.agent_desc)



            # Get input fields for this agent

            if agent_name in ai_system.agent_inputs:

                inputs = {x: dict_[x] for x in ai_system.agent_inputs[agent_name] if x in dict_}

                

                # Execute the custom agent

                agent_name_result, result_dict = await ai_system.agents[agent_name](**inputs)

                return {agent_name_result: result_dict}

            else:

                logger.log_message(f"Agent '{agent_name}' not found in ai_system.agent_inputs", level=logging.ERROR)

                return {"error": f"Agent '{agent_name}' input configuration not found"}

        else:

            # Multiple agents - execute sequentially

            results = {}

            for agent_name in agent_names:

                single_result = await _execute_custom_agents(ai_system, [agent_name], query)

                results.update(single_result)

            return results

            

    except Exception as e:

        logger.log_message(f"Error in _execute_custom_agents: {str(e)}", level=logging.ERROR)

        return {"error": f"Error executing custom agents: {str(e)}"}



def _prepare_query_with_context(query: str, session_state: dict) -> str:

    """Prepare the query with chat context from previous messages"""

    chat_id = session_state.get("chat_id")

    if not chat_id:

        return query

        

    # Get chat manager from app state

    chat_manager = app.state._session_manager.chat_manager

    # Get recent messages

    recent_messages = chat_manager.get_recent_chat_history(chat_id, limit=MAX_RECENT_MESSAGES)

    # Extract response history

    chat_context = chat_manager.extract_response_history(recent_messages)

    

    # Append context to the query if available

    if chat_context:

        return f"### Current Query:\n{query}\n\n{chat_context}"

    return query





def _track_model_usage(session_state: dict, enhanced_query: str, response, processing_time_ms: int):

    """Track model usage statistics in the database"""

    try:

        ai_manager = app.state.get_ai_manager()

        

        # Get model configuration

        model_config = session_state.get("model_config", DEFAULT_MODEL_CONFIG)

        model_name = model_config.get("model", DEFAULT_MODEL_CONFIG["model"])

        provider = ai_manager.get_provider_for_model(model_name)

        

        # Calculate token usage

        try:

            # Try exact tokenization

            prompt_tokens = len(ai_manager.tokenizer.encode(enhanced_query))

            completion_tokens = len(ai_manager.tokenizer.encode(str(response)))

            total_tokens = prompt_tokens + completion_tokens

        except Exception as token_error:

            # Fall back to estimation

            logger.log_message(f"Tokenization error: {str(token_error)}", level=logging.WARNING)

            prompt_words = len(enhanced_query.split())

            completion_words = len(str(response).split())

            prompt_tokens = int(prompt_words * DEFAULT_TOKEN_RATIO)

            completion_tokens = int(completion_words * DEFAULT_TOKEN_RATIO)

            total_tokens = prompt_tokens + completion_tokens

        

        # Calculate cost

        cost = ai_manager.calculate_cost(model_name, prompt_tokens, completion_tokens)

        

        # Save usage to database

        ai_manager.save_usage_to_db(

            user_id=session_state.get("user_id"),

            chat_id=session_state.get("chat_id"),

            model_name=model_name,

            provider=provider,

            prompt_tokens=int(prompt_tokens),

            completion_tokens=int(completion_tokens),

            total_tokens=int(total_tokens),

            query_size=len(enhanced_query),

            response_size=len(str(response)),

            cost=round(cost, 7),

            request_time_ms=processing_time_ms,

            is_streaming=False

        )

    except Exception as e:

        # Log but don't fail the request if usage tracking fails

        logger.log_message(f"Failed to track model usage: {str(e)}", level=logging.ERROR)





async def _generate_streaming_responses(session_state: dict, query: str, session_lm):

    """Generate streaming responses for chat_with_all endpoint"""

    overall_start_time = time.time()

    total_response = ""

    total_inputs = ""

    usage_records = []



    # Add chat context from previous messages

    enhanced_query = _prepare_query_with_context(query, session_state)

    

    # try:

        # Get the plan - planner is now async, so we need to await it

    plan_response = await session_state["ai_system"].get_plan(enhanced_query)

    

    plan_description = format_response_to_markdown(

        {"analytical_planner": plan_response}, 

        datasets=session_state["datasets"]
    )

    

    # Check if plan is valid

    if plan_description == RESPONSE_ERROR_INVALID_QUERY:

        yield json.dumps({

            "agent": "Analytical Planner",

            "content": plan_description,

            "status": "error"

        }) + "\n"

        return

    

    yield json.dumps({

        "agent": "Analytical Planner",

        "content": plan_description,

        "status": "success" if plan_description else "error"

    }) + "\n"

    

    # Track planner usage

    if session_state.get("user_id"):

        planner_tokens = _estimate_tokens(ai_manager=app.state.ai_manager, 

                                        input_text=enhanced_query, 

                                        output_text=plan_description)

        

        usage_records.append(_create_usage_record(

            session_state=session_state,

            model_name=session_state.get("model_config", DEFAULT_MODEL_CONFIG)["model"],

            prompt_tokens=planner_tokens["prompt"],

            completion_tokens=planner_tokens["completion"],

            query_size=len(enhanced_query),

            response_size=len(plan_description),

            processing_time_ms=int((time.time() - overall_start_time) * 1000),

            is_streaming=False

        ))

    

    logger.log_message(f"Plan response: {plan_response}", level=logging.INFO)

    logger.log_message(f"Plan response type: {type(plan_response)}", level=logging.INFO)



    # Check if plan_response is valid

    # if not plan_response or not isinstance(plan_response, dict):

    #     yield json.dumps({

    #         "agent": "Analytical Planner",

    #         "content": "**Error: Invalid plan response**\n\nResponse: " + str(plan_response),

    #         "status": "error"

    #     }) + "\n"

    #     return

    

    # Execute the plan with well-managed concurrency

    with dspy.context(lm = session_lm):

        # try:

            

        async for agent_name, inputs, response in session_state["ai_system"].execute_plan(enhanced_query, plan_response):

            

            if agent_name == "plan_not_found":

                yield json.dumps({

                    "agent": "Analytical Planner",

                    "content": "**No plan found**\n\nPlease try again with a different query or try using a different model.",

                    "status": "error"

                }) + "\n"

                return

                

            if agent_name == "plan_not_formated_correctly":

                yield json.dumps({

                    "agent": "Analytical Planner",

                    "content": "**Something went wrong with formatting, retry the query!**",

                    "status": "error"

                }) + "\n"

                return

            



            formatted_response = format_response_to_markdown(

                {agent_name: response}, 

                datasets=session_state["datasets"]
            ) 



            yield json.dumps({

                "agent": agent_name.split("__")[0] if "__" in agent_name else agent_name,

                "content": formatted_response,

                "status": "success" if response else "error"

            }) + "\n"



            # Handle agent errors

            if isinstance(response, dict) and "error" in response:

                yield json.dumps({

                    "agent": agent_name,

                    "content": f"**Error in {agent_name}**: {response['error']}",

                    "status": "error"

                }) + "\n"

                continue  # Continue with next agent instead of returning







            if formatted_response == RESPONSE_ERROR_INVALID_QUERY:

                yield json.dumps({

                    "agent": agent_name,

                    "content": formatted_response,

                    "status": "error"

                }) + "\n"

                continue  # Continue with next agent instead of returning



            # Send response chunk



            

            # Track agent usage for future batch DB write

            if session_state.get("user_id"):

                agent_tokens = _estimate_tokens(

                    ai_manager=app.state.ai_manager,

                    input_text=str(inputs),

                    output_text=str(response)

                )

                

                # Get appropriate model name for code combiner

                if "code_combiner_agent" in agent_name and "__" in agent_name:

                    provider = agent_name.split("__")[1]

                    model_name = _get_model_name_for_provider(provider)

                else:

                    model_name = session_state.get("model_config", DEFAULT_MODEL_CONFIG)["model"]



                usage_records.append(_create_usage_record(

                    session_state=session_state,

                    model_name=model_name,

                    prompt_tokens=agent_tokens["prompt"],

                    completion_tokens=agent_tokens["completion"],

                    query_size=len(str(inputs)),

                    response_size=len(str(response)),

                    processing_time_ms=int((time.time() - overall_start_time) * 1000),

                    is_streaming=True

                ))

                    

        # except asyncio.TimeoutError:

        #     yield json.dumps({

        #         "agent": "planner",

        #         "content": "The request timed out. Please try a simpler query.",

        #         "status": "error"

        #     }) + "\n"

        #     return

            

        # except Exception as e:

        #     logger.log_message(f"Error executing plan: {str(e)}", level=logging.ERROR)

        #     yield json.dumps({

        #         "agent": "planner",

        #         "content": f"An error occurred while executing the plan: {str(e)}",

        #         "status": "error"

        #     }) + "\n"

        #     return

                

    # except Exception as e:

    #         logger.log_message(f"Error in streaming response: {str(e)}", level=logging.ERROR)

    #         yield json.dumps({

    #             "agent": "planner",

    #             "content": "An error occurred while generating responses. Please try again!" + str(e) + str({k: v for k, v in session_lm.__dict__['kwargs'].items() if k != 'api_key'}),

    #             "status": "error"

    #         }) + "\n"





def _estimate_tokens(ai_manager, input_text: str, output_text: str) -> dict:

    """Estimate token counts, with fallback for tokenization errors"""

    try:

        # Try exact tokenization

        prompt_tokens = len(ai_manager.tokenizer.encode(input_text))

        completion_tokens = len(ai_manager.tokenizer.encode(output_text))

    except Exception:

        # Fall back to estimation

        prompt_words = len(input_text.split())

        completion_words = len(output_text.split())

        prompt_tokens = int(prompt_words * DEFAULT_TOKEN_RATIO)

        completion_tokens = int(completion_words * DEFAULT_TOKEN_RATIO)

    

    return {

        "prompt": prompt_tokens,

        "completion": completion_tokens,

        "total": prompt_tokens + completion_tokens

    }





def _create_usage_record(session_state: dict, model_name: str, prompt_tokens: int, 

                        completion_tokens: int, query_size: int, response_size: int,

                        processing_time_ms: int, is_streaming: bool) -> dict:

    """Create a usage record for the database"""

    ai_manager = app.state.get_ai_manager()

    provider = ai_manager.get_provider_for_model(model_name)

    cost = ai_manager.calculate_cost(model_name, prompt_tokens, completion_tokens)

    

    return {

        "user_id": session_state.get("user_id"),

        "chat_id": session_state.get("chat_id"),

        "model_name": model_name,

        "provider": provider,

        "prompt_tokens": int(prompt_tokens),

        "completion_tokens": int(completion_tokens),

        "total_tokens": int(prompt_tokens + completion_tokens),

        "query_size": query_size,

        "response_size": response_size,

        "cost": round(cost, 7),

        "request_time_ms": processing_time_ms,

        "is_streaming": is_streaming

    }





def _get_model_name_for_provider(provider: str) -> str:

    """Get the model name for a provider"""

    provider_model_map = {

        "openai": "o3-mini",
        "anthropic": "claude-sonnet-4-5-20250929",
        "gemini": "gemini-2.5-pro-preview-03-25"
    }
    return provider_model_map.get(provider, "o3-mini")







# Add an endpoint to list available agents

@app.get("/agents", response_model=dict)

async def list_agents(request: Request, session_id: str = Depends(get_session_id_dependency)):

    """Get all available agents (standard, template, and custom)"""

    session_state = app.state.get_session_state(session_id)

    

    try:

        # Get all available agents from database and session

        available_agents_list = _get_available_agents_list(session_state)

        

        # Categorize agents

        standard_agents = ["preprocessing_agent", "statistical_analytics_agent", "sk_learn_agent", "data_viz_agent"]

        

        # Get template agents from database

        from src.db.init_db import session_factory

        from src.agents.agents import load_all_available_templates_from_db

        

        db_session = session_factory()

        try:

            template_agents_dict = load_all_available_templates_from_db(db_session)

            # template_agents_dict is a dict with template_name as keys

            template_agents = [template_name for template_name in template_agents_dict.keys() 

                             if template_name not in standard_agents and template_name != 'basic_qa_agent']

        except Exception as e:

            logger.log_message(f"Error loading template agents in /agents endpoint: {str(e)}", level=logging.ERROR)

            template_agents = []

        finally:

            db_session.close()

        

        # Get custom agents from session

        custom_agents = []

        if session_state and "ai_system" in session_state:

            ai_system = session_state["ai_system"]

            if hasattr(ai_system, 'agents'):

                custom_agents = [agent for agent in available_agents_list

                               if agent not in standard_agents and agent not in template_agents]

        

        # Ensure template agents are in the available list

        for template_agent in template_agents:

            if template_agent not in available_agents_list:

                available_agents_list.append(template_agent)

        

        return {

            "available_agents": available_agents_list,

            "standard_agents": standard_agents,

            "template_agents": template_agents,

            "custom_agents": custom_agents

        }

    except Exception as e:

        logger.log_message(f"Error getting agents list: {str(e)}", level=logging.ERROR)

        raise HTTPException(status_code=500, detail=f"Error getting agents list: {str(e)}")



@app.get("/health", response_model=dict)

async def health():

    return {"message": "API is healthy and running"}



@app.get("/")

async def index():

    return {

        "title": "Welcome to the AI Analytics API",

        "message": "Explore our API for advanced analytics and visualization tools designed to empower your data-driven decisions.",

        "description": "Utilize our powerful agents and models to gain insights from your data effortlessly.",

        "colors": {

            "primary": "#007bff",

            "secondary": "#6c757d",

            "success": "#28a745",

            "danger": "#dc3545",

        },

        "features": [

            "Real-time data processing",

            "Customizable visualizations",

            "Seamless integration with various data sources",

            "User-friendly interface for easy navigation",

            "Custom Analytics",

        ],

    }



@app.post("/chat_history_name")

async def chat_history_name(request: dict, session_id: str = Depends(get_session_id_dependency)):

    query = request.get("query")

    name = None

    

    lm = dspy.LM(model="gpt-4o-mini", max_tokens=300, temperature=0.5)

    

    with dspy.context(lm=lm):

        name = app.state.get_chat_history_name_agent()(query=str(query))

        

    return {"name": name.name if name else "New Chat"}



@app.post("/deep_analysis_streaming")

async def deep_analysis_streaming(

    request: DeepAnalysisRequest,

    request_obj: Request,

    session_id: str = Depends(get_session_id_dependency)

):

    """Perform streaming deep analysis with real-time updates"""

    session_state = app.state.get_session_state(session_id)

    

    try:

        # Extract and validate query parameters

        _update_session_from_query_params(request_obj, session_state)

        

        # Validate dataset

        if session_state["datasets"] is None:
            raise HTTPException(status_code=400, detail=RESPONSE_ERROR_NO_DATASET)

        

        # Get user_id from session state (if available)

        user_id = session_state.get("user_id")

        

        # Generate a UUID for this report

        import uuid

        report_uuid = str(uuid.uuid4())

        

        # Create initial pending report in the database

        try:

            from src.db.init_db import session_factory

            from src.db.schemas.models import DeepAnalysisReport

            

            db_session = session_factory()

            

            try:

                # Create a pending report entry

                new_report = DeepAnalysisReport(

                    report_uuid=report_uuid,

                    user_id=user_id,

                    goal=request.goal,

                    status="pending",

                    start_time=datetime.now(UTC),

                    progress_percentage=0

                )

                

                db_session.add(new_report)

                db_session.commit()

                db_session.refresh(new_report)

                

                # Store the report ID in session state for later updates

                session_state["current_deep_analysis_id"] = new_report.report_id

                session_state["current_deep_analysis_uuid"] = report_uuid

                

            except Exception as e:

                logger.log_message(f"Error creating initial deep analysis report: {str(e)}", level=logging.ERROR)

                # Continue even if DB storage fails

            finally:

                db_session.close()

                

        except Exception as e:

            logger.log_message(f"Database operation failed: {str(e)}", level=logging.ERROR)

            # Continue even if DB operation fails

        

        # Get session-specific model

        # session_lm = get_session_lm(session_state)

        session_lm = dspy.LM(model="anthropic/claude-sonnet-4-20250514", max_tokens=7000, temperature=0.5)

        

        return StreamingResponse(

            _generate_deep_analysis_stream(session_state, request.goal, session_lm, session_id),

            media_type='text/event-stream',

            headers={

                'Cache-Control': 'no-cache',

                'Connection': 'keep-alive',

                'Content-Type': 'text/event-stream',

                'Access-Control-Allow-Origin': '*',

                'X-Accel-Buffering': 'no'

            }

        )

        

    except HTTPException:

        raise

    except Exception as e:

        logger.log_message(f"Streaming deep analysis failed: {str(e)}", level=logging.ERROR)

        raise HTTPException(status_code=500, detail=f"Streaming deep analysis failed: {str(e)}")



async def _generate_deep_analysis_stream(session_state: dict, goal: str, session_lm, session_id: str):

    """Generate streaming responses for deep analysis"""

    # Track the start time for duration calculation

    start_time = datetime.now(UTC)

    

    try:

        # Get dataset info
        datasets = session_state["datasets"]
        desc = session_state['description']
        
        # Generate dataset info for all datasets
        logger.log_message(f"🔍 DEEP ANALYSIS START - datasets type: {type(datasets)}, keys: {list(datasets.keys()) if datasets else 'None'}", level=logging.DEBUG)
        
        dataset_info = desc
        logger.log_message(f"🔍 DEEP ANALYSIS - dataset_info type: {type(dataset_info)}, length: {len(dataset_info) if isinstance(dataset_info, str) else 'N/A'}", level=logging.DEBUG)
        logger.log_message(f"🔍 DEEP ANALYSIS - dataset_info content: {dataset_info[:200]}...", level=logging.DEBUG)

        

        # Get report info from session state

        report_id = session_state.get("current_deep_analysis_id")

        report_uuid = session_state.get("current_deep_analysis_uuid")

        user_id = session_state.get("user_id")

        

        # Helper function to update report in database

        async def update_report_in_db(status, progress, step=None, content=None):

            if not report_id:

                return

                

            try:

                from src.db.init_db import session_factory

                from src.db.schemas.models import DeepAnalysisReport

                

                db_session = session_factory()

                

                try:

                    report = db_session.query(DeepAnalysisReport).filter(DeepAnalysisReport.report_id == report_id).first()

                    

                    if report:

                        report.status = status

                        report.progress_percentage = progress

                        

                        # Update step-specific fields if provided

                        if step == "questions" and content:

                            report.deep_questions = content

                        elif step == "planning" and content:

                            report.deep_plan = content

                        elif step == "analysis" and content:

                            # For analysis step, we get the full object with multiple fields

                            if isinstance(content, dict):

                                # Update fields from content if they exist

                                if "deep_questions" in content and content["deep_questions"]:

                                    report.deep_questions = content["deep_questions"]

                                if "deep_plan" in content and content["deep_plan"]:

                                    report.deep_plan = content["deep_plan"]

                                if "code" in content and content["code"]:

                                    report.analysis_code = content["code"]

                                if "final_conclusion" in content and content["final_conclusion"]:

                                    report.final_conclusion = content["final_conclusion"]

                                    # Also update summary from conclusion

                                    conclusion = content["final_conclusion"]

                                    conclusion = conclusion.replace("**Conclusion**", "")

                                    report.report_summary = conclusion[:200] + "..." if len(conclusion) > 200 else conclusion

                                

                                # Handle JSON fields

                                if "summaries" in content and content["summaries"]:

                                    report.summaries = json.dumps(content["summaries"])

                                if "plotly_figs" in content and content["plotly_figs"]:

                                    report.plotly_figures = json.dumps(content["plotly_figs"])

                                if "synthesis" in content and content["synthesis"]:

                                    report.synthesis = json.dumps(content["synthesis"])

                        

                        # For the final step, update the HTML report

                        if step == "completed":

                            if content:

                                report.html_report = content

                            else:

                                logger.log_message("No HTML content provided for completed step", level=logging.WARNING)

                                

                            report.end_time = datetime.now(UTC)

                            # Ensure start_time is timezone-aware before calculating duration

                            if report.start_time.tzinfo is None:

                                start_time_utc = report.start_time.replace(tzinfo=UTC)

                            else:

                                start_time_utc = report.start_time

                            report.duration_seconds = int((report.end_time - start_time_utc).total_seconds())

                            

                        report.updated_at = datetime.now(UTC)

                        db_session.commit()

                        

                except Exception as e:

                    db_session.rollback()

                    logger.log_message(f"Error updating deep analysis report: {str(e)}", level=logging.ERROR)

                finally:

                    db_session.close()

            except Exception as e:

                logger.log_message(f"Database operation failed: {str(e)}", level=logging.ERROR)

        

        # Use session model for this request

        with dspy.context(lm=session_lm):

            # Send initial status

            yield json.dumps({

                "step": "initialization",

                "status": "starting",

                "message": "Initializing deep analysis...",

                "progress": 5

            }) + "\n"

            

            # Update DB status to running

            await update_report_in_db("running", 5)

            

            # Get deep analyzer - use the correct session_id from the session_state

            logger.log_message(f"Getting deep analyzer for session_id: {session_id}, user_id: {user_id}", level=logging.INFO)

            deep_analyzer = app.state.get_deep_analyzer(session_id)

            

            # Make all datasets available globally for code execution

            for dataset_name, dataset_df in datasets.items():
                globals()[dataset_name] = dataset_df
            
            # Use the new streaming method and forward all progress updates
            final_result = None

            logger.log_message(f"🔍 CALLING DEEP ANALYSIS - goal: {goal[:100]}...", level=logging.DEBUG)
            logger.log_message(f"🔍 CALLING DEEP ANALYSIS - dataset_info type: {type(dataset_info)}, length: {len(dataset_info) if isinstance(dataset_info, str) else 'N/A'}", level=logging.DEBUG)
            logger.log_message(f"🔍 CALLING DEEP ANALYSIS - session_datasets type: {type(datasets)}, keys: {list(datasets.keys()) if datasets else 'None'}", level=logging.DEBUG)
            
            async for update in deep_analyzer.execute_deep_analysis_streaming(
                goal=goal,
                dataset_info=dataset_info,
                session_datasets=datasets  # Pass all datasets instead of single df
            ):

                # Convert the update to the expected format and yield it

                if update.get("step") == "questions" and update.get("status") == "completed":

                    # Update DB with questions

                    await update_report_in_db("running", update.get("progress", 0), "questions", update.get("content"))

                elif update.get("step") == "planning" and update.get("status") == "completed":

                    # Update DB with planning

                    await update_report_in_db("running", update.get("progress", 0), "planning", update.get("content"))

                elif update.get("step") == "conclusion" and update.get("status") == "completed":

                    # Store the final result for later processing

                    final_result = update.get("final_result")

                    

                    # Convert Plotly figures to JSON format for network transmission

                    if final_result:

                        import plotly.io

                        serialized_return_dict = final_result.copy()

                        

                        # Convert plotly_figs to JSON format

                        if 'plotly_figs' in serialized_return_dict and serialized_return_dict['plotly_figs']:

                            json_figs = []

                            for fig_list in serialized_return_dict['plotly_figs']:

                                if isinstance(fig_list, list):

                                    json_fig_list = []

                                    for fig in fig_list:

                                        if hasattr(fig, 'to_json'):  # Check if it's a Plotly figure

                                            json_fig_list.append(plotly.io.to_json(fig))

                                        else:

                                            json_fig_list.append(fig)  # Already JSON or other format

                                    json_figs.append(json_fig_list)

                                else:

                                    # Single figure case

                                    if hasattr(fig_list, 'to_json'):

                                        json_figs.append(plotly.io.to_json(fig_list))

                                    else:

                                        json_figs.append(fig_list)

                            serialized_return_dict['plotly_figs'] = json_figs

                        

                        # Update DB with analysis results

                        await update_report_in_db("running", update.get("progress", 0), "analysis", serialized_return_dict)

                        

                        # Generate HTML report using the original final_result with Figure objects

                        html_report = None

                        try:

                            html_report = generate_html_report(final_result)

                        except Exception as e:

                            logger.log_message(f"Error generating HTML report: {str(e)}", level=logging.ERROR)

                            # Continue even if HTML generation fails

                        

                        # Send the analysis results

                        yield json.dumps({

                            "step": "analysis",

                            "status": "completed",

                            "content": serialized_return_dict,

                            "progress": 90

                        }) + "\n"

                        

                        # Send report generation status

                        yield json.dumps({

                            "step": "report",

                            "status": "processing",

                            "message": "Generating final report...",

                            "progress": 95

                        }) + "\n"

                        

                        # Send final completion

                        yield json.dumps({

                            "step": "completed",

                            "status": "success",

                            "analysis": serialized_return_dict,

                            "html_report": html_report,

                            "progress": 100

                        }) + "\n"

                        

                        # Update DB with completed report (with HTML if generated)

                        if html_report:

                            logger.log_message(f"Saving HTML report to database, length: {len(html_report)}", level=logging.INFO)

                        else:

                            logger.log_message("No HTML report to save to database", level=logging.WARNING)

                        await update_report_in_db("completed", 100, "completed", html_report)

                elif update.get("step") == "error":

                    # Forward error directly

                    yield json.dumps(update) + "\n"

                    await update_report_in_db("failed", 0)

                    return

                else:

                    # Forward all other progress updates

                    yield json.dumps(update) + "\n"

            

            # If we somehow exit the loop without getting a final result, that's an error

            if not final_result:

                yield json.dumps({

                    "step": "error",

                    "status": "failed",

                    "message": "Deep analysis completed without final result",

                    "progress": 0

                }) + "\n"

                await update_report_in_db("failed", 0)

        

    except Exception as e:

        logger.log_message(f"Error in deep analysis stream: {str(e)}", level=logging.ERROR)

        yield json.dumps({

            "step": "error",

            "status": "failed",

            "message": f"Deep analysis failed: {str(e)}",

            "progress": 0

        }) + "\n"

        

        # Update DB with error status

        if 'update_report_in_db' in locals() and session_state.get("current_deep_analysis_id"):

            await update_report_in_db("failed", 0)



@app.post("/deep_analysis/download_report")

async def download_html_report(

    request: dict,

    session_id: str = Depends(get_session_id_dependency)

):

    """Download HTML report from previous deep analysis"""

    try:

        analysis_data = request.get("analysis_data")

        if not analysis_data:

            raise HTTPException(status_code=400, detail="No analysis data provided")

        

        # Get report UUID from request if available (for saving to DB)

        report_uuid = request.get("report_uuid")

        session_state = app.state.get_session_state(session_id)

        

        # If no report_uuid in request, try to get it from session state

        if not report_uuid and session_state.get("current_deep_analysis_uuid"):

            report_uuid = session_state.get("current_deep_analysis_uuid")

            

        # Convert JSON-serialized Plotly figures back to Figure objects for HTML generation

        processed_data = analysis_data.copy()

        

        if 'plotly_figs' in processed_data and processed_data['plotly_figs']:

            import plotly.io

            import plotly.graph_objects as go

            

            figure_objects = []

            for fig_list in processed_data['plotly_figs']:

                if isinstance(fig_list, list):

                    fig_obj_list = []

                    for fig_json in fig_list:

                        if isinstance(fig_json, str):

                            # Convert JSON string back to Figure object

                            try:

                                fig_obj = plotly.io.from_json(fig_json)

                                fig_obj_list.append(fig_obj)

                            except Exception as e:

                                logger.log_message(f"Error parsing Plotly JSON: {str(e)}", level=logging.WARNING)

                                continue

                        elif hasattr(fig_json, 'to_html'):

                            # Already a Figure object

                            fig_obj_list.append(fig_json)

                    figure_objects.append(fig_obj_list)

                else:

                    # Single figure case

                    if isinstance(fig_list, str):

                        try:

                            fig_obj = plotly.io.from_json(fig_list)

                            figure_objects.append(fig_obj)

                        except Exception as e:

                            logger.log_message(f"Error parsing Plotly JSON: {str(e)}", level=logging.WARNING)

                            continue

                    elif hasattr(fig_list, 'to_html'):

                        figure_objects.append(fig_list)

            

            processed_data['plotly_figs'] = figure_objects

        

        # Generate HTML report

        html_report = generate_html_report(processed_data)

        

        # Save report to database if we have a UUID

        if report_uuid:

            try:

                from src.db.init_db import session_factory

                from src.db.schemas.models import DeepAnalysisReport

                

                db_session = session_factory()

                try:

                    # Try to find existing report by UUID

                    report = db_session.query(DeepAnalysisReport).filter(DeepAnalysisReport.report_uuid == report_uuid).first()

                    

                    if report:

                        # Update existing report with HTML content

                        report.html_report = html_report

                        report.updated_at = datetime.now(UTC)

                        db_session.commit()

                except Exception as e:

                    db_session.rollback()

                finally:

                    db_session.close()

            except Exception as e:

                logger.log_message(f"Database operation failed when storing HTML report: {str(e)}", level=logging.ERROR)

                # Continue even if DB storage fails

        

        # Create a filename with timestamp

        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")

        filename = f"deep_analysis_report_{timestamp}.html"

        

        # Return as downloadable file

        return StreamingResponse(

            iter([html_report.encode('utf-8')]),

            media_type='text/html',

            headers={

                'Content-Disposition': f'attachment; filename="{filename}"',

                'Content-Type': 'text/html; charset=utf-8'

            }

        )

        

    except Exception as e:

        logger.log_message(f"Failed to generate HTML report: {str(e)}", level=logging.ERROR)

        raise HTTPException(status_code=500, detail=f"Failed to generate report: {str(e)}")





# In the section where routers are included, add the session_router

app.include_router(chat_router)

app.include_router(analytics_router)

app.include_router(code_router)

app.include_router(session_router)

app.include_router(feedback_router)

app.include_router(deep_analysis_router)

app.include_router(templates_router)

app.include_router(blog_router)



if __name__ == "__main__":

    port = int(os.environ.get("PORT", 8000))

    uvicorn.run(app, host="0.0.0.0", port=port)

