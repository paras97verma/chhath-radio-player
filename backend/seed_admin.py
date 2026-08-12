"""
Admin user seeding script.
Run this once after migrations to create the first admin account.

Usage (inside the container or with venv active):
    python seed_admin.py

Environment variables (read from .env or shell):
    ADMIN_EMAIL    — email for the admin account (default: admin@chhathradio.com)
    ADMIN_PASSWORD — password for the admin account (REQUIRED)
"""
import os
import sys
import uuid

# Ensure the app package is importable when run from the backend/ directory
sys.path.insert(0, os.path.dirname(__file__))

from app.db.database import SessionLocal
from app.models.admin import Admin
from app.auth.security import hash_password
from sqlalchemy import select


def seed_admin() -> None:
    email = os.environ.get("ADMIN_EMAIL", "admin@chhathradio.com")
    password = os.environ.get("ADMIN_PASSWORD", "")

    if not password:
        print("ERROR: ADMIN_PASSWORD environment variable is required.")
        print("  Example: ADMIN_PASSWORD=mysecret python seed_admin.py")
        sys.exit(1)

    db = SessionLocal()
    try:
        existing = db.scalar(select(Admin).where(Admin.email == email))
        if existing:
            print(f"Admin '{email}' already exists — skipping.")
            return

        admin = Admin(
            id=uuid.uuid4(),
            email=email,
            password_hash=hash_password(password),
        )
        db.add(admin)
        db.commit()
        print(f"✓ Admin user created: {email}")
    finally:
        db.close()


if __name__ == "__main__":
    seed_admin()