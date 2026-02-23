from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, DateTime, Text, Float, Boolean, JSON, UniqueConstraint
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime, UTC

# Define the base class for declarative models
Base = declarative_base()

# Define the Users table
class User(Base):
    __tablename__ = 'users'
    
    user_id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String, nullable=False)  # Removed unique=True
    email = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    # Add relationship for cascade options
    chats = relationship("Chat", back_populates="user", cascade="all, delete-orphan")
    usage_records = relationship("ModelUsage", back_populates="user")
    deep_analysis_reports = relationship("DeepAnalysisReport", back_populates="user", cascade="all, delete-orphan")
    template_preferences = relationship("UserTemplatePreference", back_populates="user", cascade="all, delete-orphan")

# Define the Chats table
class Chat(Base):
    __tablename__ = 'chats'
    
    chat_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.user_id', ondelete="CASCADE"), nullable=True)
    title = Column(String, default='New Chat')
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    # Add relationships for cascade options
    user = relationship("User", back_populates="chats")
    messages = relationship("Message", back_populates="chat", cascade="all, delete-orphan")
    usage_records = relationship("ModelUsage", back_populates="chat")

# Define the Messages table
class Message(Base):
    __tablename__ = 'messages'
    
    message_id = Column(Integer, primary_key=True, autoincrement=True)
    chat_id = Column(Integer, ForeignKey('chats.chat_id', ondelete="CASCADE"), nullable=False)
    sender = Column(String, nullable=False)  # 'user' or 'ai'
    content = Column(Text, nullable=False)
    timestamp = Column(DateTime, default=lambda: datetime.now(UTC))
    # Add relationship for cascade options
    chat = relationship("Chat", back_populates="messages")
    feedback = relationship("MessageFeedback", back_populates="message", uselist=False, cascade="all, delete-orphan")

# Define the Model Usage table
class ModelUsage(Base):
    """Tracks AI model usage metrics for analytics and billing purposes."""
    __tablename__ = 'model_usage'
    
    usage_id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.user_id', ondelete="SET NULL"), nullable=True)
    chat_id = Column(Integer, ForeignKey('chats.chat_id', ondelete="SET NULL"), nullable=True)
    model_name = Column(String(100), nullable=False)
    provider = Column(String(50), nullable=False)
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    query_size = Column(Integer, default=0)  # Size in characters
    response_size = Column(Integer, default=0)  # Size in characters
    cost = Column(Float, default=0.0)  # Cost in USD
    timestamp = Column(DateTime, default=lambda: datetime.now(UTC))
    is_streaming = Column(Boolean, default=False)
    request_time_ms = Column(Integer, default=0)  # Request processing time in milliseconds
    # Add relationships
    user = relationship("User", back_populates="usage_records")
    chat = relationship("Chat", back_populates="usage_records")

# Define the Code Execution table
class CodeExecution(Base):
    """Tracks code execution attempts and results for analysis and debugging."""
    __tablename__ = 'code_executions'
    
    execution_id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(Integer, ForeignKey('messages.message_id', ondelete="CASCADE"), nullable=True)
    chat_id = Column(Integer, ForeignKey('chats.chat_id', ondelete="CASCADE"), nullable=True)
    user_id = Column(Integer, ForeignKey('users.user_id', ondelete="SET NULL"), nullable=True)
    
    # Code tracking
    initial_code = Column(Text, nullable=True)  # First version of code submitted
    latest_code = Column(Text, nullable=True)  # Most recent version of code
    
    # Execution results
    is_successful = Column(Boolean, default=False)
    output = Column(Text, nullable=True)  # Full output including errors
    
    # Model and agent information
    model_provider = Column(String(50), nullable=True)
    model_name = Column(String(100), nullable=True)
    model_temperature = Column(Float, nullable=True)
    model_max_tokens = Column(Integer, nullable=True)
    
    # Failure information
    failed_agents = Column(Text, nullable=True)  # JSON list of agent names that failed
    error_messages = Column(Text, nullable=True)  # JSON map of error messages by agent
    
    # Metadata
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))
    
class MessageFeedback(Base):
    """Tracks user feedback and model settings for each message."""
    __tablename__ = 'message_feedback'
    
    feedback_id = Column(Integer, primary_key=True, autoincrement=True)
    message_id = Column(Integer, ForeignKey('messages.message_id', ondelete="CASCADE"), nullable=False)
    
    # User feedback
    rating = Column(Integer, nullable=True)  # Star rating (1-5)
    
    # Model settings used for this message
    model_name = Column(String(100), nullable=True)
    model_provider = Column(String(50), nullable=True)
    temperature = Column(Float, nullable=True)
    max_tokens = Column(Integer, nullable=True)

    # Metadata
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))
    
    # Relationship
    message = relationship("Message", back_populates="feedback")

class DeepAnalysisReport(Base):
    """Stores deep analysis reports with comprehensive analysis data and metadata."""
    __tablename__ = 'deep_analysis_reports'
    
    report_id = Column(Integer, primary_key=True, autoincrement=True)
    report_uuid = Column(String(100), unique=True, nullable=False)  # Frontend generated ID
    user_id = Column(Integer, ForeignKey('users.user_id', ondelete="CASCADE"), nullable=True)
    
    # Analysis objective and status
    goal = Column(Text, nullable=False)  # The analysis objective/question
    status = Column(String(20), nullable=False, default='pending')  # 'pending', 'running', 'completed', 'failed'
    
    # Timing information
    start_time = Column(DateTime, default=lambda: datetime.now(UTC))
    end_time = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)  # Calculated duration
    
    # Analysis components (stored as text/JSON)
    deep_questions = Column(Text, nullable=True)  # Generated analytical questions
    deep_plan = Column(Text, nullable=True)  # Analysis plan
    summaries = Column(JSON, nullable=True)  # Array of analysis summaries
    analysis_code = Column(Text, nullable=True)  # Generated Python code
    plotly_figures = Column(JSON, nullable=True)  # Array of Plotly figure data
    synthesis = Column(JSON, nullable=True)  # Array of synthesis insights
    final_conclusion = Column(Text, nullable=True)  # Final analysis conclusion
    
    # Report output
    html_report = Column(Text, nullable=True)  # Complete HTML report
    report_summary = Column(Text, nullable=True)  # Brief summary for listing
    
    # Execution tracking
    progress_percentage = Column(Integer, default=0)  # Progress 0-100
    steps_completed = Column(JSON, nullable=True)  # Array of completed step names
    error_message = Column(Text, nullable=True)  # Error details if failed
    
    # Model and cost tracking
    model_provider = Column(String(50), nullable=True)
    model_name = Column(String(100), nullable=True)
    total_tokens_used = Column(Integer, default=0)
    estimated_cost = Column(Float, default=0.0)  # Cost in USD
    credits_consumed = Column(Integer, default=0)  # Credits deducted for this analysis
    
    # Metadata
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))
    
    # Relationships
    user = relationship("User", back_populates="deep_analysis_reports")
    
class AgentTemplate(Base):
    """Stores predefined agent templates that users can enable/disable."""
    __tablename__ = 'agent_templates'
    
    template_id = Column(Integer, primary_key=True, autoincrement=True)
    
    # Template definition
    template_name = Column(String(100), nullable=False, unique=True)  # e.g., 'pytorch_specialist', 'data_cleaning_expert'
    display_name = Column(String(200), nullable=True)  # User-friendly display name
    description = Column(Text, nullable=False)  # Short description for template selection
    prompt_template = Column(Text, nullable=False)  # Main prompt/instructions for agent behavior
    
    # Template appearance
    icon_url = Column(String(500), nullable=True)  # URL to template icon (CDN, data URL, or relative path)
    
    # Template categorization
    category = Column(String(50), nullable=True)  # 'Visualization', 'Modelling', 'Data Manipulation'
    is_premium_only = Column(Boolean, default=False)  # True if template requires premium subscription
    
    # Agent variant support
    variant_type = Column(String(20), default='individual')  # 'planner', 'individual', or 'both'
    base_agent = Column(String(100), nullable=True)  # Base agent name for variants (e.g., 'preprocessing_agent')
    
    # Status and metadata
    is_active = Column(Boolean, default=True)
    
    # Timestamps
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))
    
    # Relationships
    user_preferences = relationship("UserTemplatePreference", back_populates="template", cascade="all, delete-orphan")

class UserTemplatePreference(Base):
    """Tracks user preferences and usage for agent templates."""
    __tablename__ = 'user_template_preferences'
    
    preference_id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.user_id', ondelete="CASCADE"), nullable=False)
    template_id = Column(Integer, ForeignKey('agent_templates.template_id', ondelete="CASCADE"), nullable=False)
    
    # User preferences
    is_enabled = Column(Boolean, default=True)  # Whether user has this template enabled
    
    # Usage tracking
    usage_count = Column(Integer, default=0)  # Track how many times user has used this template
    last_used_at = Column(DateTime, nullable=True)  # Last time user used this template
    
    # Timestamps
    created_at = Column(DateTime, default=lambda: datetime.now(UTC))
    updated_at = Column(DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))
    
    # Relationships
    user = relationship("User", back_populates="template_preferences")
    template = relationship("AgentTemplate", back_populates="user_preferences")
    
    # Constraints - user can only have one preference record per template
    __table_args__ = (
        UniqueConstraint('user_id', 'template_id', name='unique_user_template_preference'),
    )
    
    