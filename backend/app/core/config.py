"""
Application configuration using Pydantic Settings.
Reads from environment variables or a .env file.
"""
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator


class Settings(BaseSettings):
    # Application
    APP_NAME: str = "Chhath Radio"
    DEBUG: bool = False
    SECRET_KEY: str = Field(default="")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours

    # Database
    DATABASE_URL: str = Field(
        default="postgresql://chhath:chhath@localhost:5432/chhath_radio"
    )

    # Redis
    REDIS_URL: str = Field(default="redis://localhost:6379/0")

    # Presence
    PRESENCE_TTL_SECONDS: int = 45
    PRESENCE_HEARTBEAT_INTERVAL_SECONDS: int = 15

    @field_validator("SECRET_KEY")
    @classmethod
    def secret_key_must_be_strong(cls, v: str) -> str:
        if not v or len(v) < 32:
            raise ValueError(
                "SECRET_KEY env var must be set and at least 32 characters long. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        return v

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"  # silently ignore unknown env vars (e.g. ADMIN_EMAIL, COMPOSE_*)


settings = Settings()