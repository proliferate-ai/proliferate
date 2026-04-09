"""Unit tests for auth schemas."""

from proliferate.auth.models import UserCreate, UserRead, UserRole


class TestUserRole:
    def test_values(self) -> None:
        assert UserRole.USER == "user"
        assert UserRole.ADMIN == "admin"

    def test_user_role_is_string(self) -> None:
        assert isinstance(UserRole.USER, str)


class TestUserCreate:
    def test_minimal(self) -> None:
        user = UserCreate(email="test@example.com", password="secret123")
        assert user.email == "test@example.com"
        assert user.display_name is None

    def test_with_display_name(self) -> None:
        user = UserCreate(
            email="test@example.com",
            password="secret123",
            display_name="Test User",
        )
        assert user.display_name == "Test User"


class TestUserRead:
    def test_default_role(self) -> None:
        user = UserRead(
            id="00000000-0000-0000-0000-000000000001",
            email="test@example.com",
            is_active=True,
            is_verified=False,
            is_superuser=False,
        )
        assert user.role == UserRole.USER
