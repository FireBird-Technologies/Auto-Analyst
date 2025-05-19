from pydantic import BaseModel
from typing import Optional, List

# Pydantic models for request/response validation
class MessageCreate(BaseModel):
    content: str
    sender: str

class ChatResponse(BaseModel):
    chat_id: int
    title: str
    created_at: str
    user_id: Optional[int] = None
    
class MessageResponse(BaseModel):
    message_id: int
    chat_id: int
    content: str
    sender: str
    timestamp: str

class ChatDetailResponse(BaseModel):
    chat_id: int
    title: str
    created_at: str
    user_id: Optional[int] = None
    messages: List[MessageResponse]

class UserInfo(BaseModel):
    username: str
    email: str

# Add this class to define the request model
class ChatCreate(BaseModel):
    user_id: Optional[int] = None
    is_admin: Optional[bool] = False

class ChatUpdate(BaseModel):
    title: Optional[str] = None
    user_id: Optional[int] = None

class ChatMessageCreate(BaseModel):
    """Model for creating a new chat message with AI response"""
    message: str
    model_name: Optional[str] = None
    system_prompt: Optional[str] = None
    formatted_prompt: Optional[str] = None

class MessageFeedbackCreate(BaseModel):
    """Model for creating feedback for a message"""
    message_id: int
    rating: int  # 1-5 star rating
    model_name: Optional[str] = None
    model_provider: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None

class MessageFeedbackResponse(BaseModel):
    """Model for feedback response"""
    feedback_id: int
    message_id: int
    rating: Optional[int] = None
    model_name: Optional[str] = None
    model_provider: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    created_at: str
    updated_at: str