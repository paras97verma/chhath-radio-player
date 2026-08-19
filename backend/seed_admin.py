"""
Admin user seeding script.
Run this once after migrations to create the first admin account.

Usage (inside the container or with venv active):
    ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=mysecret python seed_admin.py

Environment variables (both REQUIRED — no defaults):
    ADMIN_EMAIL    — email for the admin account
    ADMIN_PASSWORD — password for the admin account (min 12 chars recommended)
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
    email = os.environ.get("ADMIN_EMAIL", "")
    password = os.environ.get("ADMIN_PASSWORD", "")

    if not email:
        print("ERROR: ADMIN_EMAIL environment variable is required.")
        print("  Example: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=mysecret python seed_admin.py")
        sys.exit(1)

    if not password:
        print("ERROR: ADMIN_PASSWORD environment variable is required.")
        print("  Example: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=mysecret python seed_admin.py")
        sys.exit(1)

    db = SessionLocal()
    try:
        existing = db.scalar(select(Admin).where(Admin.email == email))
        if existing:
            existing.password_hash = hash_password(password)
            db.commit()
            print(f"✓ Admin user '{email}' password updated successfully.")
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