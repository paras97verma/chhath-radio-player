"""
Admin authentication endpoint.
POST /api/admin/login — returns a JWT token on valid credentials.
"""
import base64
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from app.db.database import get_db
from app.models.admin import Admin
from app.schemas.admin import AdminLogin, Token
from app.auth.security import verify_password, create_access_token

router = APIRouter(prefix="/api/admin", tags=["admin-auth"])


def _decode_password_payload(pw: str) -> str:
    """Decode base64 password payload if obfuscated by frontend, fallback to raw string."""
    if not pw:
        return ""
    try:
        decoded = base64.b64decode(pw).decode("utf-8")
        return decoded
    except Exception:
        return pw


@router.post("/login", response_model=Token)
def admin_login(body: AdminLogin, db: Session = Depends(get_db)) -> Token:
    """
    POST /api/admin/login
    Accepts email + password, returns a signed JWT on success.
    Supports obfuscated base64 password payload and case-insensitive email matching.
    """
    clean_email = body.email.strip().lower()
    raw_password = _decode_password_payload(body.password)

    admin = db.scalar(select(Admin).where(func.lower(Admin.email) == clean_email))

    if not admin or not verify_password(raw_password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(subject=admin.email)
    return Token(access_token=token)