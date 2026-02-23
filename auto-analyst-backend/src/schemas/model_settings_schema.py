from pydantic import BaseModel
class ModelSettings(BaseModel):
    provider: str
    model: str
    api_key: str = ""
    temperature: float = 1.0
    max_tokens: int = 6000