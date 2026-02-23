import io
import os
import time
import uuid
import logging
import pandas as pd
from typing import Dict, Any, List

from fastapi import HTTPException
from llama_index.core import Document, VectorStoreIndex
from src.utils.logger import Logger
from src.managers.user_manager import get_current_user
from src.agents.agents import auto_analyst, dataset_description_agent, data_context_gen
from src.agents.retrievers.retrievers import make_data
from src.managers.chat_manager import ChatManager
from src.utils.model_registry import mid_lm
from dotenv import load_dotenv
import duckdb
import dspy
from src.utils.dataset_description_generator import generate_dataset_description
from fastapi import Request

load_dotenv()

# Initialize logger
logger = Logger("session_manager", see_time=False, console_log=False)

# Helper to clamp temperature to valid range
def _get_clamped_temperature():
    return min(1.0, max(0.0, float(os.getenv("TEMPERATURE", "1.0"))))

class SessionManager:
    """
    Manages session-specific state, including datasets, retrievers, and AI systems.
    Handles creation, retrieval, and updating of sessions.
    """
    
    def __init__(self, styling_instructions: List[str], available_agents: Dict):
        """
        Initialize SessionManager with styling instructions and available agents
        
        Args:
            styling_instructions: List of styling instructions for visualization
            available_agents: Dictionary of available agents (deprecated - agents now loaded from DB)
        """
        self.styling_instructions = styling_instructions
        self._sessions = {}
        self._default_df = None
        self._default_retrievers = None
        self._default_ai_system = None
        self._make_data = None

        # Initialize chat manager

        self._default_name = "Housing.csv"

        
        self._dataset_description = """This dataset contains residential property information with details about pricing, physical characteristics, and amenities. The data can be used for real estate market analysis, property valuation, and understanding the relationship between house features and prices.

Key Features:
- Property prices range from 1.75M to 13.3M (currency units)
- Living areas from 1,650 to 16,200 (square units)
- Properties vary from 1-6 bedrooms and 1-4 bathrooms
- Various amenities tracked including parking, air conditioning, and hot water heating

TECHNICAL CONSIDERATIONS FOR ANALYSIS:

Numeric Columns:
- price (int): Large values suggesting currency units; range 1.75M-13.3M
- area (int): Square units measurement; range 1,650-16,200
- bedrooms (int): Discrete values 1-6
- bathrooms (int): Discrete values 1-4
- stories (int): Discrete values 1-4
- parking (int): Discrete values 0-3

Binary Categorical Columns (stored as str):
- mainroad (str): 'yes'/'no' - Consider boolean conversion
- guestroom (str): 'yes'/'no' - Consider boolean conversion
- basement (str): 'yes'/'no' - Consider boolean conversion
- hotwaterheating (str): 'yes'/'no' - Consider boolean conversion
- airconditioning (str): 'yes'/'no' - Consider boolean conversion
- prefarea (str): 'yes'/'no' - Consider boolean conversion

Other Categorical:
- furnishingstatus (str): Categories include 'furnished', 'semi-furnished' - Consider one-hot encoding

Data Handling Recommendations:
1. Binary variables should be converted to boolean or numeric (0/1) for analysis
2. Consider normalizing price and area values for certain analyses
3. Furnishing status will need categorical encoding for numerical analysis
4. No null values detected in the dataset
5. All numeric columns are properly typed as numbers (no string conversion needed)
6. Consider treating bedrooms, bathrooms, stories, and parking as categorical despite numeric storage

This dataset appears clean with consistent formatting and no missing values, making it suitable for immediate analysis with appropriate categorical encoding.
        """
        self.available_agents = available_agents
        self.chat_manager = ChatManager(db_url=os.getenv("DATABASE_URL"))
        
        self.initialize_default_dataset()
    
    def initialize_default_dataset(self):
        """Initialize the default dataset and store it"""
        try:
            self._default_df = pd.read_csv("Housing.csv")
            self._make_data = {'dataset_python_name':"this dataset is loaded as `df`","description":self._dataset_description}
            self._default_retrievers = self.initialize_retrievers(self.styling_instructions, [str(self._make_data)])
            # Create default AI system - agents will be loaded from database
            self._default_ai_system = auto_analyst(agents=[], retrievers=self._default_retrievers)
        except Exception as e:
            logger.log_message(f"Error initializing default dataset: {str(e)}", level=logging.ERROR)
            raise e
    
    def initialize_retrievers(self,styling_instructions: List[str], doc: List[str]):
        try:
            style_index = VectorStoreIndex.from_documents([Document(text=x) for x in styling_instructions])
            
            return {"style_index": style_index, "dataframe_index": doc}
        except Exception as e:
            logger.log_message(f"Error initializing retrievers: {str(e)}", level=logging.ERROR)
            raise e

    def get_session_state(self, session_id: str) -> Dict[str, Any]:
        """
        Get or create session-specific state
        
        Args:
            session_id: The session identifier
            
        Returns:
            Dictionary containing session state
        """
        # Use the global model config from app_state when available
        # Get the most up-to-date model config
        if hasattr(self, '_app_model_config') and self._app_model_config:
            default_model_config = self._app_model_config
        else:
            default_model_config = {
                "provider": os.getenv("MODEL_PROVIDER", "anthropic"),
                "model": os.getenv("MODEL_NAME", "claude-sonnet-4-5-20250929"),
                "api_key": os.getenv("ANTHROPIC_API_KEY"),
                "temperature": _get_clamped_temperature(),
                "max_tokens": int(os.getenv("MAX_TOKENS", 6000))
            }
        
        if session_id not in self._sessions:
            # Check if we need to create a brand new session
            logger.log_message(f"Creating new session state for session_id: {session_id}", level=logging.INFO)
            
            # Initialize DuckDB connection for this session

            
            # Initialize with default state
            self._sessions[session_id] = {
                "datasets": {"df":self._default_df.copy() if self._default_df is not None else None},
                "dataset_names": ["df"],
                "retrievers": self._default_retrievers,
                "ai_system": self._default_ai_system,
                "make_data": self._make_data,
                "description": self._dataset_description,
                "name": self._default_name,
                "model_config": default_model_config,
                "creation_time": time.time(),
                "duckdb_conn": None,
            }
        else:
            # Verify dataset integrity in existing session
            session = self._sessions[session_id]
            
            # Always update model_config to match global settings
            session["model_config"] = default_model_config
            
            # If dataset is somehow missing, restore it
            if "datasets" not in session or session["datasets"] is None:
                logger.log_message(f"Restoring missing dataset for session {session_id}", level=logging.WARNING)
                session["datasets"] = {"df":self._default_df.copy() if self._default_df is not None else None}
                session["retrievers"] = self._default_retrievers
                session["ai_system"] = self._default_ai_system
                session["description"] = self._dataset_description
                session["name"] = self._default_name
            
            # Ensure we have the basic required fields
            if "name" not in session:
                session["name"] = self._default_name
            if "description" not in session:
                session["description"] = self._dataset_description
            
            # Update last accessed time
            session["last_accessed"] = time.time()
            
        return self._sessions[session_id]

   


    def update_session_dataset(self, session_id: str, datasets, names, desc: str, pre_generated=False):
        """
        Update session with new dataset and optionally auto-generate description
        """
        try:
            # Get default model config for new sessions
            default_model_config = {
                "provider": os.getenv("MODEL_PROVIDER", "anthropic"),
                "model": os.getenv("MODEL_NAME", "claude-sonnet-4-5-20250929"),
                "api_key": os.getenv("ANTHROPIC_API_KEY"),
                "temperature": _get_clamped_temperature(),
                "max_tokens": int(os.getenv("MAX_TOKENS", 6000))
            }
            
            # Get or create DuckDB connection for this session
            
            # Register the new dataset in DuckDB
            
            # Auto-generate description if we have datasets
            if datasets and pre_generated==False:
                try:
                    generated_desc = generate_dataset_description(datasets, desc, names)
                    desc = generated_desc  # No need to format again since it's already formatted
                    logger.log_message(f"Auto-generated description for session {session_id}", level=logging.INFO)
                except Exception as e:
                    logger.log_message(f"Failed to auto-generate description: {str(e)}", level=logging.WARNING)
                    # Keep the original description if generation fails
                    pass
            
            # Initialize retrievers and AI system BEFORE creating session_state
            # Update make_data with the description
            self._make_data = {'description': desc}
            retrievers = self.initialize_retrievers(self.styling_instructions, [str(self._make_data)])
            
            # Check if session has a user_id to create user-specific AI system
            current_user_id = None
            if session_id in self._sessions and "user_id" in self._sessions[session_id]:
                current_user_id = self._sessions[session_id]["user_id"]
            
            ai_system = self.create_ai_system_for_user(retrievers, current_user_id)
            
            # Create a completely fresh session state for the new dataset
            session_state = {
                "datasets": datasets,
                "dataset_names": names,
                "retrievers": retrievers,  # Now retrievers is defined
                "ai_system": ai_system,    # Now ai_system is defined
                "make_data": self._make_data,
                "description": desc,
                "name": names[0],
                "duckdb_conn": None,
                "model_config": default_model_config,
            }
            
            # Preserve user_id, chat_id, and model_config if they exist in the current session
            if session_id in self._sessions:
                if "user_id" in self._sessions[session_id]:
                    session_state["user_id"] = self._sessions[session_id]["user_id"]
                if "chat_id" in self._sessions[session_id]:
                    session_state["chat_id"] = self._sessions[session_id]["chat_id"]
                if "model_config" in self._sessions[session_id]:
                    session_state["model_config"] = self._sessions[session_id]["model_config"]
            
            # Replace the entire session with the new state
            self._sessions[session_id] = session_state
            
            logger.log_message(f"Updated session {session_id} with completely fresh dataset state: {str(names)}", level=logging.INFO)
        except Exception as e:
            logger.log_message(f"Error updating dataset for session {session_id}: {str(e)}", level=logging.ERROR)
            raise e

    def reset_session_to_default(self, session_id: str):
        """
        Reset a session to use the default dataset

        Args:
            session_id: The session identifier
        """
        try:
            # Get default model config from environment
            default_model_config = {
                "provider": os.getenv("MODEL_PROVIDER", "anthropic"),
                "model": os.getenv("MODEL_NAME", "claude-sonnet-4-5-20250929"),
                "api_key": os.getenv("ANTHROPIC_API_KEY"),
                "temperature": _get_clamped_temperature(),
                "max_tokens": int(os.getenv("MAX_TOKENS", 6000))
            }
            
            # Clear any custom data associated with the session first
            if session_id in self._sessions:
                del self._sessions[session_id]
                logger.log_message(f"Cleared existing state for session {session_id} before reset.", level=logging.INFO)

            # Create new DuckDB connection for default session

            # Initialize with default state
            self._sessions[session_id] = {
                "datasets": {'df':self._default_df.copy()},
                "dataset_names": ["df"], # Use a copy
                "retrievers": self._default_retrievers,
                "ai_system": self._default_ai_system,
                "description": self._dataset_description,
                "name": self._default_name, # Explicitly set the default name
                "make_data": None, # Clear any custom make_data
                "model_config": default_model_config, # Initialize with default model config
                "duckdb_conn": None, # Create new DuckDB connection
            }
            logger.log_message(f"Reset session {session_id} to default dataset: {self._default_name}", level=logging.INFO)
        except Exception as e:
            logger.log_message(f"Error resetting session {session_id}: {str(e)}", level=logging.ERROR)
            raise e

    def create_ai_system_for_user(self, retrievers, user_id=None):
        """
        Create an AI system with user-specific agents (including custom agents)
        
        Args:
            retrievers: The retrievers for the AI system
            user_id: Optional user ID to load custom agents for
            
        Returns:
            An auto_analyst instance with all available agents (standard + custom)
        """
        try:
            if user_id:
                # Import here to avoid circular imports
                from src.db.init_db import session_factory
                
                # Create a database session
                db_session = session_factory()
                try:
                    # Create AI system with user context to load custom agents
                    ai_system = auto_analyst(
                        agents=[], 
                        retrievers=retrievers,
                        user_id=user_id,
                        db_session=db_session
                    )
                    logger.log_message(f"Created AI system for user {user_id}", level=logging.INFO)
                    return ai_system
                finally:
                    db_session.close()
            else:
                # Create standard AI system without custom agents
                return auto_analyst(agents=[], retrievers=retrievers)
                
        except Exception as e:
            logger.log_message(f"Error creating AI system for user {user_id}: {str(e)}", level=logging.ERROR)
            # Fallback to standard AI system
            return auto_analyst(agents=[], retrievers=retrievers)

    def set_default_lm_for_user(self, session_id: str, user_id: int = None):
        """
        Set the default language model for a user upon signin using MODEL_OBJECTS.
        
        Args:
            session_id: The session identifier
            user_id: The authenticated user ID (optional)
            
        Returns:
            Dictionary containing the default model configuration
        """
        try:
            # Import MODEL_OBJECTS directly
            from src.utils.model_registry import MODEL_OBJECTS
            
            # Set Claude Sonnet 4.5 as default model
            default_model_name = "claude-sonnet-4-5-20250929"
            
            # Ensure the model exists in MODEL_OBJECTS
            if default_model_name not in MODEL_OBJECTS:
                logger.log_message(f"Default model '{default_model_name}' not found in MODEL_OBJECTS, using gpt-5-mini", level=logging.WARNING)
                default_model_name = "gpt-5-mini"
            
            # Get the model object directly from MODEL_OBJECTS
            model_object = MODEL_OBJECTS[default_model_name]
            
            # Determine provider from model name
            provider = "anthropic"  # Claude models use Anthropic
            
            # Create default model configuration
            default_model_config = {
                "provider": provider,
                "model": default_model_name,
                "api_key": os.getenv(f"{provider.upper()}_API_KEY"),
                "temperature": getattr(model_object, 'kwargs', {}).get('temperature', 0.7),
                "max_tokens": getattr(model_object, 'kwargs', {}).get('max_tokens', 4000)
            }
            
            # Ensure we have a session state for this session ID
            if session_id not in self._sessions:
                self.get_session_state(session_id)
            
            # Set the default model configuration in session state
            self._sessions[session_id]["model_config"] = default_model_config
            
            # Also update the app-level model config if available
            if hasattr(self, '_app_model_config'):
                self._app_model_config.update(default_model_config)
            
            logger.log_message(f"Set default LM '{default_model_name}' for session {session_id} (user: {user_id})", level=logging.INFO)
            
            return {
                "status": "success",
                "model_config": default_model_config,
                "message": f"Default model '{default_model_name}' set successfully"
            }
            
        except Exception as e:
            logger.log_message(f"Error setting default LM for user {user_id}: {str(e)}", level=logging.ERROR)
            # Return fallback configuration
            return {
                "status": "error",
                "model_config": {
                    "provider": "anthropic",
                    "model": "claude-sonnet-4-5-20250929",
                    "temperature": 0.7,
                    "max_tokens": 4000
                },
                "message": f"Failed to set default model, using fallback: {str(e)}"
            }

    def set_session_user(self, session_id: str, user_id: int, chat_id: int = None):
        """
        Associate a user with a session
        
        Args:
            session_id: The session identifier
            user_id: The authenticated user ID
            chat_id: Optional chat ID for tracking conversation
            
        Returns:
            Updated session state dictionary
        """
        # Ensure we have a session state for this session ID
        if session_id not in self._sessions:
            self.get_session_state(session_id)  # Initialize with defaults
        
        # Store user ID
        self._sessions[session_id]["user_id"] = user_id
        
        # Set default LM for user upon signin
        self.set_default_lm_for_user(session_id, user_id)
        
        # Generate or use chat ID
        if chat_id:
            chat_id_to_use = chat_id
        else:
            # Check if chat_id already exists
            if "chat_id" not in self._sessions[session_id] or not self._sessions[session_id]["chat_id"]:
                # Use current timestamp + random number to generate a more readable ID
                import random
                chat_id_to_use = int(time.time() * 1000) % 1000000 + random.randint(1, 999)
            else:
                chat_id_to_use = self._sessions[session_id]["chat_id"]
        
        # Store chat ID
        self._sessions[session_id]["chat_id"] = chat_id_to_use
        
        # Recreate AI system with user context to load custom agents
        try:
            session_retrievers = self._sessions[session_id]["retrievers"]
            user_ai_system = self.create_ai_system_for_user(session_retrievers, user_id)
            self._sessions[session_id]["ai_system"] = user_ai_system
            logger.log_message(f"Updated AI system for session {session_id} with user {user_id}", level=logging.INFO)
        except Exception as e:
            logger.log_message(f"Error updating AI system for user {user_id}: {str(e)}", level=logging.ERROR)
            # Continue with existing AI system if update fails
        
        # Make sure this data gets saved
        logger.log_message(f"Associated session {session_id} with user {user_id}, chat_id: {chat_id_to_use}", level=logging.INFO)
        
        # Return the updated session data
        return self._sessions[session_id]

async def get_session_id(request: Request, session_manager):
    """
    Get or create a session ID from the request
    """
    # Debug: Log all headers
    logger.log_message(f"🔍 ALL REQUEST HEADERS: {dict(request.headers)}", level=logging.DEBUG)
    
    # Try to get session ID from headers FIRST (primary method)
    session_id = request.headers.get("X-Session-ID")
    logger.log_message(f"🔍 Session ID from X-Session-ID header: {session_id}", level=logging.DEBUG)
    
    # If not in headers, try query parameters (fallback for backward compatibility)
    if not session_id:
        session_id = request.query_params.get("session_id")
        logger.log_message(f"🔍 Session ID from query params: {session_id}", level=logging.DEBUG)
    
    logger.log_message(f"🔍 Final session_id before validation: '{session_id}' (type: {type(session_id)})", level=logging.DEBUG)
    
    # STOP auto-generating sessions
    if not session_id:
        logger.log_message(f"❌ No session ID found in request", level=logging.ERROR)
        raise HTTPException(status_code=400, detail="Session ID required")
    else:
        logger.log_message(f"✅ Using existing session ID: {session_id}", level=logging.INFO)
    
    # Get or create the session state
    session_state = session_manager.get_session_state(session_id)
    
    # First, check if we already have a user associated with this session
    if session_state.get("user_id") is not None:
        return session_id
    
    # Next, try to get authenticated user using the API key
    current_user = await get_current_user(request)
    if current_user:
        # Use the authenticated user instead of creating a guest
        session_manager.set_session_user(
            session_id=session_id,
            user_id=current_user.user_id
        )
        logger.log_message(f"Associated session {session_id} with authenticated user_id {current_user.user_id}", level=logging.INFO)
        return session_id
    
    # Check if a user_id was provided in the request params
    user_id_param = request.query_params.get("user_id")
    if user_id_param:
        try:
            user_id = int(user_id_param)
            session_manager.set_session_user(session_id=session_id, user_id=user_id)
            logger.log_message(f"Associated session {session_id} with provided user_id {user_id}", level=logging.INFO)
            return session_id
        except (ValueError, TypeError):
            logger.log_message(f"Invalid user_id in query params: {user_id_param}", level=logging.WARNING)
    
    # No user was found or created - just return the session ID without associating a user
    logger.log_message(f"No authenticated user found for session {session_id}, continuing without user association", level=logging.INFO)
    return session_id