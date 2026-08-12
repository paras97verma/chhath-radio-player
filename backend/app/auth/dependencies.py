"""
FastAPI dependency for JWT-protected routes.
Inject `get_current_admin` into any route that requires authentication.
"""
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.auth.security import decode_access_token
from app.db.database import get_db
from app.models.admin import Admin

# auto_error=False so we can return a proper 401 (not 403) when no token is provided
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Admin:
    """
    FastAPI dependency that validates the Bearer JWT token and returns the Admin.

    Raises:
        HTTPException 401: If the token is missing, expired, or invalid.
        HTTPException 401: If the admin no longer exists in the database.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if credentials is None:
        raise credentials_exception

    try:
        payload = decode_access_token(credentials.credentials)
        email: str | None = payload.get("sub")
        if email is None:
            raise credentials_exception
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError:
        raise credentials_exception

    admin = db.query(Admin).filter(Admin.email == email).first()
    if admin is None:
        raise credentials_exception
    return admin