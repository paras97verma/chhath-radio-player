"""
Admin authentication endpoint.
POST /api/admin/login — returns a JWT token on valid credentials.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.db.database import get_db
from app.models.admin import Admin
from app.schemas.admin import AdminLogin, Token
from app.auth.security import verify_password, create_access_token

router = APIRouter(prefix="/api/admin", tags=["admin-auth"])


@router.post("/login", response_model=Token)
def admin_login(body: AdminLogin, db: Session = Depends(get_db)) -> Token:
    """
    POST /api/admin/login
    Accepts email + password, returns a signed JWT on success.
    Returns 401 if credentials are invalid (intentionally vague for security).
    """
    admin = db.scalar(select(Admin).where(Admin.email == body.email))

    if not admin or not verify_password(body.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(subject=admin.email)
    return Token(access_token=token)