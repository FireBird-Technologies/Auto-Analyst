from sqlalchemy import create_engine, desc, func, exists
from sqlalchemy.orm import sessionmaker, scoped_session
from sqlalchemy.exc import SQLAlchemyError
from src.db.schemas.models import Base, User, Chat, Message, ModelUsage, MessageFeedback
import logging
import requests
import json
from typing import List, Dict, Optional, Tuple, Any
from datetime import datetime
import time
import tiktoken
from src.utils.logger import Logger
import re

logger = Logger("chat_manager", see_time=True, console_log=False)


class ChatManager:
    """
    Manages chat operations including creating, storing, retrieving, and updating chats and messages.
    Provides an interface between the application and the database for chat-related operations.
    """
    
    def __init__(self, db_url):
        """
        Initialize the ChatManager with a database connection.
        
        Args:
            db_url: Database connection URL (defaults to SQLite)
        """
        self.engine = create_engine(db_url)
        Base.metadata.create_all(self.engine)  # Ensure tables exist
        self.Session = scoped_session(sessionmaker(bind=self.engine))
        
        # Add price mappings for different models
        self.model_costs = {
            "openai": {
                "gpt-4": {"input": 0.03, "output": 0.06},  
                "gpt-4o": {"input": 0.0025, "output": 0.01},  
                "gpt-4.5-preview": {"input": 0.075, "output": 0.15},
                "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},  
                "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015},  
                "o1": {"input": 0.015, "output": 0.06},  
                "o1-mini": {"input": 0.00011, "output": 0.00044},  
                "o3-mini": {"input": 0.00011, "output": 0.00044}  
            },
            "anthropic": {
                "claude-3-opus-latest": {"input": 0.015, "output": 0.075},  
                "claude-3-7-sonnet-latest": {"input": 0.003, "output": 0.015},   
                "claude-3-5-sonnet-latest": {"input": 0.003, "output": 0.015}, 
                "claude-3-5-haiku-latest": {"input": 0.0008, "output": 0.0004},
            },
            "groq": {
                "deepseek-r1-distill-llama-70b": {"input": 0.00075, "output": 0.00099},
                "llama-3.3-70b-versatile": {"input": 0.00059, "output": 0.00079},
                "llama3-8b-8192": {"input": 0.00005, "output": 0.00008},
                "llama3-70b-8192": {"input": 0.00059, "output": 0.00079},
                "llama-3.1-8b-instant": {"input": 0.00005, "output": 0.00008},
                "mistral-saba-24b": {"input": 0.00079, "output": 0.00079},
                "gemma2-9b-it": {"input": 0.0002, "output": 0.0002},
                "qwen-qwq-32b": {"input": 0.00029, "output": 0.00039},
                "meta-llama/llama-4-maverick-17b-128e-instruct": {"input": 0.0002, "output": 0.0006},
                "meta-llama/llama-4-scout-17b-16e-instruct": {"input": 0.00011, "output": 0.00034},
            },
            "gemini": {
                "gemini-2.5-pro-preview-03-25": {"input": 0.00015, "output": 0.001}
            }
        }
                
        
        # Add model providers mapping
        self.model_providers = {
            "gpt-": "openai",
            "claude-": "anthropic", 
            "llama-": "groq",
            "mistral-": "groq",
        }
    
    def create_chat(self, user_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Create a new chat session.
        
        Args:
            user_id: Optional user ID if authentication is enabled
            
        Returns:
            Dictionary containing chat information
        """
        session = self.Session()
        try:
            # Create a new chat
            chat = Chat(
                user_id=user_id,
                title='New Chat',
                created_at=datetime.utcnow()
            )
            session.add(chat)
            session.flush()  # Flush to get the ID before commit
            
            chat_id = chat.chat_id  # Get the ID now
            session.commit()
            
            logger.log_message(f"Created new chat {chat_id} for user {user_id}", level=logging.INFO)
            
            return {
                "chat_id": chat_id,
                "user_id": chat.user_id,
                "title": chat.title,
                "created_at": chat.created_at.isoformat()
            }
        except SQLAlchemyError as e:
            session.rollback()
            logger.log_message(f"Error creating chat: {str(e)}", level=logging.ERROR)
            raise
        finally:
            session.close()
    
    def add_message(self, chat_id: int, content: str, sender: str, user_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Add a message to a chat.
        
        Args:
            chat_id: ID of the chat to add the message to
            content: Message content
            sender: Message sender ('user' or 'ai')
            user_id: Optional user ID to verify ownership
            
        Returns:
            Dictionary containing message information
        """
        session = self.Session()
        try:
            # Check if chat exists and belongs to the user if user_id is provided
            query = session.query(Chat).filter(Chat.chat_id == chat_id)
            if user_id is not None:
                query = query.filter((Chat.user_id == user_id) | (Chat.user_id.is_(None)))
            
            chat = query.first()
            if not chat:
                raise ValueError(f"Chat with ID {chat_id} not found or access denied")
            
            ##! Ensure content length is reasonable for PostgreSQL
            # max_content_length = 10000  # PostgreSQL can handle large text but let's be cautious
            # if content and len(content) > max_content_length:
            #     logger.log_message(f"Truncating message content from {len(content)} to {max_content_length} characters", 
            #                       level=logging.WARNING)
            #     content = content[:max_content_length]
            
            # Create a new message
            message = Message(
                chat_id=chat_id,
                content=content,
                sender=sender,
                timestamp=datetime.utcnow()
            )
            session.add(message)
            session.flush()  # Flush to get the ID before commit
            
            message_id = message.message_id  # Get ID now
            
            # If this is the first AI response and chat title is still default,
            # update the chat title based on the first user query
            if sender == 'ai':
                first_ai_message = session.query(Message).filter(
                    Message.chat_id == chat_id,
                    Message.sender == 'ai'
                ).first()
                
                if not first_ai_message and chat.title == 'New Chat':
                    # Get the user's first message
                    first_user_message = session.query(Message).filter(
                        Message.chat_id == chat_id,
                        Message.sender == 'user'
                    ).order_by(Message.timestamp).first()
                    
                    if first_user_message:
                        # Generate title from user query
                        new_title = self.generate_title_from_query(first_user_message.content)
                        chat.title = new_title
            
            session.commit()
            
            return {
                "message_id": message_id,
                "chat_id": message.chat_id,
                "content": message.content,
                "sender": message.sender,
                "timestamp": message.timestamp.isoformat()
            }
        except SQLAlchemyError as e:
            session.rollback()
            logger.log_message(f"Error adding message: {str(e)}", level=logging.ERROR)
            raise
        finally:
            session.close()
    

    def get_chat(self, chat_id: int, user_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Get a chat by ID with all its messages.
        
        Args:
            chat_id: ID of the chat to retrieve
            user_id: Optional user ID to verify ownership
            
        Returns:
            Dictionary containing chat information and messages
        """
        session = self.Session()
        try:
            # Get the chat
            query = session.query(Chat).filter(Chat.chat_id == chat_id)
            
            # If user_id is provided, ensure the chat belongs to this user
            if user_id is not None:
                query = query.filter((Chat.user_id == user_id) | (Chat.user_id.is_(None)))
            
            chat = query.first()
            if not chat:
                raise ValueError(f"Chat with ID {chat_id} not found or access denied")
            
            # Get the chat messages ordered by timestamp
            messages = session.query(Message).filter(
                Message.chat_id == chat_id
            ).order_by(Message.timestamp).all()
            
            # Create a safe serializable dictionary
            return {
                "chat_id": chat.chat_id,
                "title": chat.title,
                "created_at": chat.created_at.isoformat() if chat.created_at else None,
                "user_id": chat.user_id,
                "messages": [
                    {
                        "message_id": msg.message_id,
                        "chat_id": msg.chat_id,
                        "content": msg.content,
                        "sender": msg.sender,
                        "timestamp": msg.timestamp.isoformat() if msg.timestamp else None
                    } for msg in messages
                ]
            }
        except SQLAlchemyError as e:
            logger.log_message(f"Error retrieving chat: {str(e)}", level=logging.ERROR)
            raise
        finally:
            session.close()
    
    def get_user_chats(self, user_id: Optional[int] = None, limit: int = 10, offset: int = 0) -> List[Dict[str, Any]]:
        """
        Get recent chats for a user, or all chats if no user_id is provided.
        
        Args:
            user_id: Optional user ID to filter chats
            limit: Maximum number of chats to return
            offset: Number of chats to skip (for pagination)
            
        Returns:
            List of dictionaries containing chat information
        """
        session = self.Session()
        try:
            query = session.query(Chat)
            
            # Filter by user_id if provided
            if user_id is not None:
                query = query.filter(Chat.user_id == user_id)
            
            # Apply safe limits for both SQLite and PostgreSQL
            safe_limit = min(max(1, limit), 100)  # Between 1 and 100
            safe_offset = max(0, offset)          # At least 0
            
            chats = query.order_by(Chat.created_at.desc()).limit(safe_limit).offset(safe_offset).all()
            
            return [
                {
                    "chat_id": chat.chat_id,
                    "user_id": chat.user_id,
                    "title": chat.title,
                    "created_at": chat.created_at.isoformat() if chat.created_at else None
                } for chat in chats
            ]
        except SQLAlchemyError as e:
            logger.log_message(f"Error retrieving chats: {str(e)}", level=logging.ERROR)
            return []
        finally:
            session.close()

    def delete_chat(self, chat_id: int, user_id: Optional[int] = None) -> bool:
        """
        Delete a chat and all its messages while preserving model usage records.
        
        Args:
            chat_id: ID of the chat to delete
            user_id: Optional user ID to verify ownership
            
        Returns:
            True if deletion was successful, False otherwise
        """
        session = self.Session()
        try:
            # Fetch chat with ownership check if user_id provided
            query = session.query(Chat).filter(Chat.chat_id == chat_id)
            if user_id is not None:
                query = query.filter(Chat.user_id == user_id)

            chat = query.first()
            if not chat:
                return False  # Chat not found or ownership mismatch
            
            # ORM-based deletion with model_usage preservation
            # The SET NULL in the foreign key should handle this, but we ensure it explicitly for both
            # SQLite and PostgreSQL compatibility
            
            # For SQLite which might not respect ondelete="SET NULL" always:
            # Update model_usage records to set chat_id to NULL
            session.query(ModelUsage).filter(ModelUsage.chat_id == chat_id).update(
                {"chat_id": None}, synchronize_session=False
            )
            
            # Now delete the chat - relationships will handle cascading to messages
            session.delete(chat)
            session.commit()
            return True
        except SQLAlchemyError as e:
            session.rollback()
            logger.log_message(f"Error deleting chat: {str(e)}", level=logging.ERROR)
            return False
        finally:
            session.close()



    def get_or_create_user(self, username: str, email: str) -> Dict[str, Any]:
        """
        Get an existing user by email or create a new one if not found.
        
        Args:
            username: User's display name
            email: User's email address
            
        Returns:
            Dictionary containing user information
        """
        session = self.Session()
        try:
            # Validate and sanitize inputs
            if not email or not isinstance(email, str):
                raise ValueError("Valid email is required")
            
            # Limit input length for PostgreSQL compatibility
            max_length = 255  # Standard limit for varchar fields
            if username and len(username) > max_length:
                username = username[:max_length]
            if email and len(email) > max_length:
                email = email[:max_length]
            
            # Try to find existing user by email
            user = session.query(User).filter(User.email == email).first()
            
            if not user:
                # Create new user if not found
                user = User(username=username, email=email)
                session.add(user)
                session.flush()  # Get ID before committing
                user_id = user.user_id
                session.commit()
                logger.log_message(f"Created new user: {username} ({email})", level=logging.INFO)
            else:
                user_id = user.user_id
            
            return {
                "user_id": user_id,
                "username": user.username,
                "email": user.email,
                "created_at": user.created_at.isoformat() if user.created_at else None
            }
        except SQLAlchemyError as e:
            session.rollback()
            logger.log_message(f"Error getting/creating user: {str(e)}", level=logging.ERROR)
            raise
        finally:
            session.close()
    
    def update_chat(self, chat_id: int, title: Optional[str] = None, user_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Update a chat's title or user_id.
        
        Args:
            chat_id: ID of the chat to update
            title: New title for the chat (optional)
            user_id: New user ID for the chat (optional)
            
        Returns:
            Dictionary containing updated chat information
        """
        session = self.Session()
        try:
            # Get the chat
            chat = session.query(Chat).filter(Chat.chat_id == chat_id).first()
            if not chat:
                raise ValueError(f"Chat with ID {chat_id} not found")
            
            # Update fields if provided
            if title is not None:
                # Limit title length for PostgreSQL compatibility
                if len(title) > 255:  # Assuming String column has a reasonable length
                    title = title[:255]
                chat.title = title
                
            if user_id is not None:
                chat.user_id = user_id
            
            session.commit()
            
            return {
                "chat_id": chat.chat_id,
                "title": chat.title,
                "created_at": chat.created_at.isoformat() if chat.created_at else None,
                "user_id": chat.user_id
            }
        except SQLAlchemyError as e:
            session.rollback()
            logger.log_message(f"Error updating chat: {str(e)}", level=logging.ERROR)
            raise
        finally:
            session.close()
    
    def generate_title_from_query(self, query: str) -> str:
        """
        Generate a title for a chat based on the first query.
        
        Args:
            query: The user's first query in the chat
            
        Returns:
            A generated title string
        """
        try:
            # Validate input
            if not query or not isinstance(query, str):
                return "New Chat"
                
            # Simple title generation - take first few words
            words = query.strip().split()
            if len(words) > 3:
                title = "Chat about " + " ".join(words[0:3]) + "..."
            else:
                title = "Chat about " + query.strip()
            
            # Limit title length for PostgreSQL compatibility
            max_title_length = 255
            if len(title) > max_title_length:
                title = title[:max_title_length-3] + "..."
            
            return title
        except Exception as e:
            logger.log_message(f"Error generating title: {str(e)}", level=logging.ERROR)
            return "New Chat"
    
    def delete_empty_chats(self, user_id: Optional[int] = None, is_admin: bool = False) -> int:
        """
        Delete empty chats (chats with no messages) for a user.
        
        Args:
            user_id: ID of the user whose empty chats should be deleted
            is_admin: Whether this is an admin user
            
        Returns:
            Number of chats deleted
        """
        session = self.Session()
        try:
            # Get all chats for the user
            query = session.query(Chat)
            if user_id is not None:
                query = query.filter(Chat.user_id == user_id)
            elif not is_admin:
                return 0  # Don't delete anything if not a user or admin
            
            # Get chats with no messages using a subquery - works in both SQLite and PostgreSQL
            empty_chats = query.filter(
                ~exists().where(Message.chat_id == Chat.chat_id)
            ).all()
            
            # Collect chat IDs to delete
            chat_ids = [chat.chat_id for chat in empty_chats]
            
            deleted_count = 0
            if chat_ids:
                # Update model_usage records to set chat_id to NULL for any associated usage records
                session.query(ModelUsage).filter(ModelUsage.chat_id.in_(chat_ids)).update(
                    {"chat_id": None}, synchronize_session=False
                )
                
                # Delete the empty chats one by one to ensure proper relationship handling
                for chat_id in chat_ids:
                    chat = session.query(Chat).filter(Chat.chat_id == chat_id).first()
                    if chat:
                        session.delete(chat)
                        deleted_count += 1
                
                session.commit()
                
            return deleted_count
        except SQLAlchemyError as e:
            session.rollback()
            logger.log_message(f"Error deleting empty chats: {str(e)}", level=logging.ERROR)
            return 0
        finally:
            session.close()

    def get_usage_summary(self, start_date: Optional[datetime] = None, 
                          end_date: Optional[datetime] = None) -> Dict[str, Any]:
        """
        Get a summary of model usage including total costs, tokens, and usage by model.
        
        Args:
            start_date: Optional start date for the summary period
            end_date: Optional end date for the summary period
            
        Returns:
            Dictionary containing usage summary
        """
        session = self.Session()
        try:
            # Build base query - convert None values to default values for compatibility
            base_query = session.query(ModelUsage)
            
            # Apply date filters
            if start_date:
                base_query = base_query.filter(ModelUsage.timestamp >= start_date)
            if end_date:
                base_query = base_query.filter(ModelUsage.timestamp <= end_date)
                
            # Get summary data using aggregate functions
            summary_query = session.query(
                func.coalesce(func.sum(ModelUsage.cost), 0.0).label("total_cost"),
                func.coalesce(func.sum(ModelUsage.prompt_tokens), 0).label("total_prompt_tokens"),
                func.coalesce(func.sum(ModelUsage.completion_tokens), 0).label("total_completion_tokens"),
                func.coalesce(func.sum(ModelUsage.total_tokens), 0).label("total_tokens"),
                func.count(ModelUsage.usage_id).label("request_count"),
                func.coalesce(func.avg(ModelUsage.request_time_ms), 0.0).label("avg_request_time")
            ).select_from(base_query.subquery())
            
            result = summary_query.first()
            
            # Get usage breakdown by model - using the same base query for consistency
            model_query = session.query(
                ModelUsage.model_name,
                func.coalesce(func.sum(ModelUsage.cost), 0.0).label("model_cost"),
                func.coalesce(func.sum(ModelUsage.total_tokens), 0).label("model_tokens"),
                func.count(ModelUsage.usage_id).label("model_requests")
            ).select_from(base_query.subquery()).group_by(ModelUsage.model_name)
            
            model_breakdown = model_query.all()
            
            # Get usage breakdown by provider using the same base query
            provider_query = session.query(
                ModelUsage.provider,
                func.coalesce(func.sum(ModelUsage.cost), 0.0).label("provider_cost"),
                func.coalesce(func.sum(ModelUsage.total_tokens), 0).label("provider_tokens"),
                func.count(ModelUsage.usage_id).label("provider_requests")
            ).select_from(base_query.subquery()).group_by(ModelUsage.provider)
            
            provider_breakdown = provider_query.all()
            
            # Get top users by cost
            user_query = session.query(
                ModelUsage.user_id,
                func.coalesce(func.sum(ModelUsage.cost), 0.0).label("user_cost"),
                func.coalesce(func.sum(ModelUsage.total_tokens), 0).label("user_tokens"),
                func.count(ModelUsage.usage_id).label("user_requests")
            ).select_from(base_query.subquery()).group_by(ModelUsage.user_id).order_by(
                func.sum(ModelUsage.cost).desc()
            ).limit(10)
            
            user_breakdown = user_query.all()
            
            # Handle the result data carefully to avoid None/NULL issues
            return {
                "summary": {
                    "total_cost": float(result.total_cost) if result and result.total_cost is not None else 0.0,
                    "total_prompt_tokens": int(result.total_prompt_tokens) if result and result.total_prompt_tokens is not None else 0,
                    "total_completion_tokens": int(result.total_completion_tokens) if result and result.total_completion_tokens is not None else 0,
                    "total_tokens": int(result.total_tokens) if result and result.total_tokens is not None else 0,
                    "request_count": int(result.request_count) if result and result.request_count is not None else 0,
                    "avg_request_time_ms": float(result.avg_request_time) if result and result.avg_request_time is not None else 0.0
                },
                "model_breakdown": [
                    {
                        "model_name": model.model_name,
                        "cost": float(model.model_cost) if model.model_cost is not None else 0.0,
                        "tokens": int(model.model_tokens) if model.model_tokens is not None else 0,
                        "requests": int(model.model_requests) if model.model_requests is not None else 0
                    } for model in model_breakdown
                ],
                "provider_breakdown": [
                    {
                        "provider": provider.provider,
                        "cost": float(provider.provider_cost) if provider.provider_cost is not None else 0.0,
                        "tokens": int(provider.provider_tokens) if provider.provider_tokens is not None else 0,
                        "requests": int(provider.provider_requests) if provider.provider_requests is not None else 0
                    } for provider in provider_breakdown
                ],
                "top_users": [
                    {
                        "user_id": user.user_id,
                        "cost": float(user.user_cost) if user.user_cost is not None else 0.0,
                        "tokens": int(user.user_tokens) if user.user_tokens is not None else 0,
                        "requests": int(user.user_requests) if user.user_requests is not None else 0
                    } for user in user_breakdown
                ]
            }
        
        except SQLAlchemyError as e:
            logger.log_message(f"Error retrieving usage summary: {str(e)}", level=logging.ERROR)
            return {
                "summary": {
                    "total_cost": 0.0,
                    "total_tokens": 0,
                    "request_count": 0
                },
                "model_breakdown": [],
                "provider_breakdown": [],
                "top_users": []
            }
        finally:
            session.close()

    def get_recent_chat_history(self, chat_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Get recent message history for a chat, limited to the last 'limit' messages.
        
        Args:
            chat_id: ID of the chat to get history for
            limit: Maximum number of recent messages to return
            
        Returns:
            List of dictionaries containing message information
        """
        session = self.Session()
        try:
            # Ensure safe limit for both databases
            safe_limit = min(max(1, limit), 50) * 2  # Between 2 and 100 messages
            
            # Use subquery for more efficient pagination in PostgreSQL
            subquery = session.query(Message).filter(
                Message.chat_id == chat_id
            ).order_by(Message.timestamp.desc()).limit(safe_limit).subquery()
            
            # Query from the subquery and sort in chronological order
            messages = session.query(Message).from_statement(
                session.query(subquery).order_by(subquery.c.timestamp).statement
            ).all()
            
            return [
                {
                    "message_id": msg.message_id,
                    "chat_id": msg.chat_id,
                    "content": msg.content,
                    "sender": msg.sender,
                    "timestamp": msg.timestamp.isoformat() if msg.timestamp else None
                } for msg in messages
            ]
        except SQLAlchemyError as e:
            logger.log_message(f"Error retrieving chat history: {str(e)}", level=logging.ERROR)
            return []
        finally:
            session.close()


    def extract_response_history(self, messages: List[Dict[str, Any]]) -> str:
        """
        Extract response history from message history.

        Args:
            messages: List of message dictionaries

        Returns:
            String containing combined response history in a structured format
        """
        
        summaries = []
        user_messages = []
        
        # Input validation
        if not messages or not isinstance(messages, list):
            return ""
            
        try:
            for msg in messages:
                # Skip invalid messages
                if not isinstance(msg, dict):
                    continue
                    
                # Get User Messages
                if msg.get("sender") == "user":
                    user_messages.append(msg)
                # Ensure content exists and is from AI before extracting summary
                if msg.get("sender") == "ai" and "content" in msg and msg["content"]:
                    content = msg["content"]
                    # Use a safer regex pattern with timeout protection
                    try:
                        matches = re.findall(r"### Summary\n(.*?)(?=\n\n##|\Z)", content, re.DOTALL)                
                        summaries.extend(match.strip() for match in matches if match)
                    except Exception as e:
                        logger.log_message(f"Error extracting summaries: {str(e)}", level=logging.ERROR)
    
            # Combine user messages with summaries in a structured format
            combined_conversations = []
            for i, user_msg in enumerate(user_messages):
                if i < len(summaries):
                    # Ensure content exists and is not too long
                    user_content = user_msg.get('content', '')
                    if user_content and isinstance(user_content, str):
                        # Truncate if needed
                        if len(user_content) > 500:
                            user_content = user_content[:497] + "..."
                        
                        summary = summaries[i]
                        if len(summary) > 500:
                            summary = summary[:497] + "..."
                            
                        combined_conversations.append(f"Query: {user_content}\nSummary: {summary}")
    
            # Return the last 3 conversations to maintain context
            formatted_context = "\n\n".join(combined_conversations[-3:])
            
            # Add a clear header to indicate this is past interaction history
            if formatted_context:
                return f"### Previous Interaction History:\n{formatted_context}"
            return ""
        except Exception as e:
            logger.log_message(f"Error in extract_response_history: {str(e)}", level=logging.ERROR)
            return ""  

    def add_message_feedback(self, message_id: int, rating: int,
                           model_settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Add or update feedback for a message.
        
        Args:
            message_id: ID of the message to add feedback for
            rating: Star rating (1-5)
            model_settings: Optional dictionary containing model settings (name, provider, temperature, etc.)
            
        Returns:
            Dictionary containing feedback information
        """
        session = self.Session()
        try:
            # Check if message exists
            message = session.query(Message).filter(Message.message_id == message_id).first()
            if not message:
                raise ValueError(f"Message with ID {message_id} not found")
            
            # Check if feedback already exists
            existing_feedback = session.query(MessageFeedback).filter(
                MessageFeedback.message_id == message_id
            ).first()
            
            now = datetime.utcnow()
            
            # Extract model settings
            model_name = None
            model_provider = None
            temperature = None
            max_tokens = None
            
            if model_settings:
                model_name = model_settings.get('model_name')
                model_provider = model_settings.get('model_provider')
                temperature = model_settings.get('temperature')
                max_tokens = model_settings.get('max_tokens')
            
            if existing_feedback:
                # Update existing feedback
                existing_feedback.rating = rating
                existing_feedback.model_name = model_name
                existing_feedback.model_provider = model_provider
                existing_feedback.temperature = temperature
                existing_feedback.max_tokens = max_tokens
                existing_feedback.updated_at = now
                feedback_record = existing_feedback
            else:
                # Create new feedback
                feedback_record = MessageFeedback(
                    message_id=message_id,
                    rating=rating,
                    model_name=model_name,
                    model_provider=model_provider,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    created_at=now,
                    updated_at=now
                )
                session.add(feedback_record)
            
            session.commit()
            
            return {
                "feedback_id": feedback_record.feedback_id,
                "message_id": feedback_record.message_id,
                "rating": feedback_record.rating,
                "model_name": feedback_record.model_name,
                "model_provider": feedback_record.model_provider,
                "temperature": feedback_record.temperature,
                "max_tokens": feedback_record.max_tokens,
                "created_at": feedback_record.created_at.isoformat(),
                "updated_at": feedback_record.updated_at.isoformat()
            }
        except SQLAlchemyError as e:
            session.rollback()
            logger.log_message(f"Error adding feedback: {str(e)}", level=logging.ERROR)
            raise
        finally:
            session.close()
    
    def get_message_feedback(self, message_id: int) -> Optional[Dict[str, Any]]:
        """
        Get feedback for a specific message.
        
        Args:
            message_id: ID of the message to get feedback for
            
        Returns:
            Dictionary containing feedback information or None if no feedback exists
        """
        session = self.Session()
        try:
            feedback = session.query(MessageFeedback).filter(
                MessageFeedback.message_id == message_id
            ).first()
            
            if not feedback:
                return None
                
            return {
                "feedback_id": feedback.feedback_id,
                "message_id": feedback.message_id,
                "rating": feedback.rating,
                "model_name": feedback.model_name,
                "model_provider": feedback.model_provider,
                "temperature": feedback.temperature,
                "max_tokens": feedback.max_tokens,
                "created_at": feedback.created_at.isoformat(),
                "updated_at": feedback.updated_at.isoformat()
            }
        except SQLAlchemyError as e:
            logger.log_message(f"Error getting feedback: {str(e)}", level=logging.ERROR)
            raise
        finally:
            session.close()
            
    def get_chat_feedback(self, chat_id: int) -> List[Dict[str, Any]]:
        """
        Get all feedback for messages in a specific chat.
        
        Args:
            chat_id: ID of the chat to get feedback for
            
        Returns:
            List of dictionaries containing feedback information
        """
        session = self.Session()
        try:
            feedback_records = session.query(MessageFeedback).join(
                Message, Message.message_id == MessageFeedback.message_id
            ).filter(
                Message.chat_id == chat_id
            ).all()
            
            return [{
                "feedback_id": feedback.feedback_id,
                "message_id": feedback.message_id,
                "rating": feedback.rating,
                "model_name": feedback.model_name,
                "model_provider": feedback.model_provider,
                "temperature": feedback.temperature,
                "max_tokens": feedback.max_tokens,
                "created_at": feedback.created_at.isoformat(),
                "updated_at": feedback.updated_at.isoformat()
            } for feedback in feedback_records]
        except SQLAlchemyError as e:
            logger.log_message(f"Error getting chat feedback: {str(e)}", level=logging.ERROR)
            raise
        finally:
            session.close()
            
    def get_feedback_statistics(self, user_id: Optional[int] = None, 
                              start_date: Optional[datetime] = None,
                              end_date: Optional[datetime] = None) -> Dict[str, Any]:
        """
        Get feedback statistics for analysis.
        
        Args:
            user_id: Optional user ID to filter by
            start_date: Optional start date to filter by
            end_date: Optional end date to filter by
            
        Returns:
            Dictionary containing feedback statistics
        """
        session = self.Session()
        try:
            # Base query for all feedback
            query = session.query(MessageFeedback).join(
                Message, Message.message_id == MessageFeedback.message_id
            )
            
            # Apply filters if provided
            if user_id is not None:
                query = query.join(Chat, Chat.chat_id == Message.chat_id).filter(
                    Chat.user_id == user_id
                )
                
            if start_date is not None:
                query = query.filter(MessageFeedback.created_at >= start_date)
                
            if end_date is not None:
                query = query.filter(MessageFeedback.created_at <= end_date)
            
            # Get all feedback records
            feedback_records = query.all()
            
            # Calculate statistics
            if not feedback_records:
                return {
                    "total_feedback_count": 0,
                    "average_rating": 0,
                    "rating_distribution": {
                        "1": 0, "2": 0, "3": 0, "4": 0, "5": 0
                    },
                    "model_ratings": {}
                }
            
            # Calculate average rating
            ratings = [record.rating for record in feedback_records if record.rating is not None]
            average_rating = sum(ratings) / len(ratings) if ratings else 0
            
            # Calculate rating distribution
            rating_distribution = {
                "1": 0, "2": 0, "3": 0, "4": 0, "5": 0
            }
            
            for record in feedback_records:
                if record.rating is not None:
                    rating_distribution[str(record.rating)] += 1
                    
            # Calculate ratings by model
            model_ratings = {}
            for record in feedback_records:
                if record.model_name and record.rating is not None:
                    if record.model_name not in model_ratings:
                        model_ratings[record.model_name] = {
                            "count": 0,
                            "total": 0,
                            "average": 0
                        }
                    
                    model_ratings[record.model_name]["count"] += 1
                    model_ratings[record.model_name]["total"] += record.rating
            
            # Calculate average for each model
            for model_name, data in model_ratings.items():
                data["average"] = data["total"] / data["count"] if data["count"] > 0 else 0
            
            return {
                "total_feedback_count": len(feedback_records),
                "average_rating": average_rating,
                "rating_distribution": rating_distribution,
                "model_ratings": model_ratings
            }
        except SQLAlchemyError as e:
            logger.log_message(f"Error getting feedback statistics: {str(e)}", level=logging.ERROR)
            raise
        finally:
            session.close()  
