"""
Pytest configuration and shared fixtures for all backend tests.
Uses an isolated in-memory SQLite database so tests never touch production data.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.database import Base, get_db
from app.main import app
from app.models.admin import Admin
from app.auth.security import hash_password, create_access_token

# Use SQLite in-memory for fast, isolated tests
TEST_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function", autouse=True)
def setup_database():
    """Create all tables before each test, drop them after."""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    """Provide a test database session."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    """
    Provide a FastAPI TestClient with the test DB injected.
    Overrides the get_db dependency so all API calls use the test database.
    """
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def admin_user(db):
    """Create a test admin user in the database."""
    admin = Admin(
        email="admin@test.com",
        password_hash=hash_password("testpassword123"),
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


@pytest.fixture
def admin_token(admin_user):
    """Return a valid JWT token for the test admin."""
    return create_access_token(subject=admin_user.email)


@pytest.fixture
def auth_headers(admin_token):
    """Return Authorization headers with the admin JWT."""
    return {"Authorization": f"Bearer {admin_token}"}