import logging
import dspy
from src.managers.session_manager import SessionManager
from src.managers.ai_manager import AI_Manager
from src.utils.logger import Logger

logger = Logger("app_manager", see_time=True, console_log=False)

class AppState:
    def __init__(self, styling_instructions, chat_history_name_agent, default_model_config):
        self._session_manager = SessionManager(styling_instructions, {})  # Empty dict, agents loaded from DB
        self.model_config = default_model_config.copy()
        
        # Update the SessionManager with the current model_config
        self._session_manager._app_model_config = self.model_config
        
        self.ai_manager = AI_Manager()
        self.chat_name_agent = chat_history_name_agent
        
        # Initialize deep analysis module
        self.deep_analyzer = None

    def get_session_state(self, session_id: str):
        """Get or create session-specific state using the SessionManager"""
        return self._session_manager.get_session_state(session_id)

    def clear_session_state(self, session_id: str):
        """Clear session-specific state using the SessionManager"""
        self._session_manager.clear_session_state(session_id)

    def update_session_dataset(self, session_id: str, datasets, names, desc, pre_generated=False):
        """Update dataset for a specific session using the SessionManager"""
        self._session_manager.update_session_dataset(session_id, datasets, names, desc, pre_generated=pre_generated)

    def reset_session_to_default(self, session_id: str):
        """Reset a session to use the default dataset using the SessionManager"""
        self._session_manager.reset_session_to_default(session_id)

    def set_session_user(self, session_id: str, user_id: int, chat_id: int = None):
        """Associate a user with a session using the SessionManager"""
        return self._session_manager.set_session_user(session_id, user_id, chat_id)

    def get_ai_manager(self):
        """Get the AI Manager instance"""
        return self.ai_manager

    def get_provider_for_model(self, model_name):
        return self.ai_manager.get_provider_for_model(model_name)

    def calculate_cost(self, model_name, input_tokens, output_tokens):
        return self.ai_manager.calculate_cost(model_name, input_tokens, output_tokens)

    def save_usage_to_db(self, user_id, chat_id, model_name, provider, prompt_tokens, completion_tokens, total_tokens, query_size, response_size, cost, request_time_ms, is_streaming=False):
        return self.ai_manager.save_usage_to_db(user_id, chat_id, model_name, provider, prompt_tokens, completion_tokens, total_tokens, query_size, response_size, round(cost, 7), request_time_ms, is_streaming)

    def get_tokenizer(self):
        return self.ai_manager.tokenizer

    def get_chat_history_name_agent(self):
        return dspy.Predict(self.chat_name_agent)

    def get_deep_analyzer(self, session_id: str):
        """Get or create deep analysis module for a session"""
        session_state = self.get_session_state(session_id)
        user_id = session_state.get("user_id")
        
        # Check if we need to recreate the deep analyzer (user changed or doesn't exist)
        current_analyzer = session_state.get('deep_analyzer')
        analyzer_user_id = session_state.get('deep_analyzer_user_id')
        
        logger.log_message(f"Deep analyzer check - session: {session_id}, current_user: {user_id}, analyzer_user: {analyzer_user_id}, has_analyzer: {current_analyzer is not None}", level=logging.INFO)
        
        if (not current_analyzer or 
            analyzer_user_id != user_id or 
            not hasattr(session_state, 'deep_analyzer')):
            
            logger.log_message(f"Creating/recreating deep analyzer for session {session_id}, user_id: {user_id} (reason: analyzer_exists={current_analyzer is not None}, user_match={analyzer_user_id == user_id})", level=logging.INFO)
            
            # Load user-enabled agents from database using preference system
            from src.db.init_db import session_factory
            from src.agents.agents import load_user_enabled_templates_for_planner_from_db
            
            db_session = session_factory()
            try:
                # Load user-enabled agents for planner (respects preferences)
                if user_id:
                    enabled_agents_dict = load_user_enabled_templates_for_planner_from_db(user_id, db_session)
                else:
                    enabled_agents_dict = {}
                
                if not enabled_agents_dict:
                    # Fallback to default agents if no user preferences
                    enabled_agents_dict = {
                        "preprocessing_agent": "preprocessing_agent",
                        "statistical_analytics_agent": "statistical_analytics_agent", 
                        "sk_learn_agent": "sk_learn_agent",
                        "data_viz_agent": "data_viz_agent"
                    }
                
                # Import deep analysis module
                from src.agents.deep_agents import deep_analysis_module
                from src.agents.agents import get_agent_description
                
                deep_agents = {}
                deep_agents_desc = {}
                
                for agent_name, signature in enabled_agents_dict.items():
                    deep_agents[agent_name] = signature
                    deep_agents_desc[agent_name] = get_agent_description(agent_name)
                
                logger.log_message(f"Deep analyzer initialized with {len(deep_agents)} agents: {list(deep_agents.keys())}", level=logging.INFO)
                
            finally:
                db_session.close()
            
            session_state['deep_analyzer'] = deep_analysis_module(
                agents=deep_agents, 
                agents_desc=deep_agents_desc
            )
            # Set datasets separately or pass them when needed
            session_state['deep_analyzer'].datasets = session_state.get("datasets")
            session_state['deep_analyzer_user_id'] = user_id  # Track which user this analyzer was created for

        else:
            logger.log_message(f"Using existing deep analyzer for session {session_id}, user_id: {user_id}", level=logging.INFO)
        
        return session_state['deep_analyzer']
