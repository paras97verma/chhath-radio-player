"""
Unit tests for app.auth.security — password hashing and JWT utilities.
These tests are pure-Python and require no database or network access.
"""
import time
from datetime import timedelta

import jwt
import pytest

from app.auth.security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
)
from app.core.config import settings


# ─── Password hashing ─────────────────────────────────────────────────────────

class TestPasswordHashing:
    def test_hash_password_returns_string(self):
        hashed = hash_password("mysecretpassword")
        assert isinstance(hashed, str)

    def test_hash_is_not_plain_text(self):
        plain = "mysecretpassword"
        hashed = hash_password(plain)
        assert hashed != plain

    def test_same_password_produces_different_hashes(self):
        """bcrypt uses a random salt, so two hashes of the same password differ."""
        h1 = hash_password("samepassword")
        h2 = hash_password("samepassword")
        assert h1 != h2

    def test_verify_correct_password_returns_true(self):
        plain = "correctpassword"
        hashed = hash_password(plain)
        assert verify_password(plain, hashed) is True

    def test_verify_wrong_password_returns_false(self):
        hashed = hash_password("correctpassword")
        assert verify_password("wrongpassword", hashed) is False

    def test_verify_empty_password_returns_false(self):
        hashed = hash_password("somepassword")
        assert verify_password("", hashed) is False

    def test_hash_empty_password(self):
        """Empty passwords can be hashed (validation is the caller's job)."""
        hashed = hash_password("")
        assert verify_password("", hashed) is True


# ─── JWT token creation ───────────────────────────────────────────────────────

class TestCreateAccessToken:
    def test_returns_string(self):
        token = create_access_token("admin@test.com")
        assert isinstance(token, str)

    def test_token_contains_subject(self):
        token = create_access_token("admin@test.com")
        payload = decode_access_token(token)
        assert payload["sub"] == "admin@test.com"

    def test_token_contains_exp_claim(self):
        token = create_access_token("admin@test.com")
        payload = decode_access_token(token)
        assert "exp" in payload

    def test_custom_expiry_is_respected(self):
        """A token with a 1-second expiry should expire after 1 second."""
        token = create_access_token("admin@test.com", expires_delta=timedelta(seconds=1))
        # Should be valid immediately
        payload = decode_access_token(token)
        assert payload["sub"] == "admin@test.com"

        # Wait for it to expire
        time.sleep(2)
        with pytest.raises(jwt.ExpiredSignatureError):
            decode_access_token(token)

    def test_subject_is_coerced_to_string(self):
        """Subject can be any type; it should be stored as a string."""
        token = create_access_token(subject=42)
        payload = decode_access_token(token)
        assert payload["sub"] == "42"

    def test_default_expiry_uses_settings(self):
        """Token expiry should be close to settings.ACCESS_TOKEN_EXPIRE_MINUTES."""
        import time as _time
        before = _time.time()
        token = create_access_token("admin@test.com")
        payload = decode_access_token(token)
        expected_exp = before + settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        # Allow 5-second tolerance for test execution time
        assert abs(payload["exp"] - expected_exp) < 5


# ─── JWT token decoding ───────────────────────────────────────────────────────

class TestDecodeAccessToken:
    def test_decodes_valid_token(self):
        token = create_access_token("user@example.com")
        payload = decode_access_token(token)
        assert payload["sub"] == "user@example.com"

    def test_raises_on_tampered_token(self):
        token = create_access_token("admin@test.com")
        # Tamper with the signature
        tampered = token[:-5] + "XXXXX"
        with pytest.raises(jwt.InvalidTokenError):
            decode_access_token(tampered)

    def test_raises_on_wrong_secret(self):
        """A token signed with a different secret should be rejected."""
        payload = {"sub": "admin@test.com"}
        bad_token = jwt.encode(payload, "wrong-secret", algorithm=settings.ALGORITHM)
        with pytest.raises(jwt.InvalidTokenError):
            decode_access_token(bad_token)

    def test_raises_on_expired_token(self):
        token = create_access_token("admin@test.com", expires_delta=timedelta(seconds=-1))
        with pytest.raises(jwt.ExpiredSignatureError):
            decode_access_token(token)

    def test_raises_on_completely_invalid_string(self):
        with pytest.raises(jwt.InvalidTokenError):
            decode_access_token("this.is.not.a.jwt")