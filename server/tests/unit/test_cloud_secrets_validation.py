import pytest

from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.secrets.validation import (
    normalize_global_secret_file_path,
    normalize_secret_env_name,
    normalize_workspace_secret_file_path,
    validate_secret_value,
)


def test_secret_env_name_validation_rejects_reserved_metadata() -> None:
    assert normalize_secret_env_name("  API_KEY ") == "API_KEY"

    with pytest.raises(CloudApiError) as error:
        normalize_secret_env_name("PROLIFERATE_WORKSPACE_ID")

    assert error.value.code == "reserved_secret_env_name"


def test_global_secret_file_paths_must_be_absolute_and_outside_system_paths() -> None:
    assert normalize_global_secret_file_path(" /home/user/.env ") == "/home/user/.env"

    with pytest.raises(CloudApiError) as relative_error:
        normalize_global_secret_file_path(".env")
    assert relative_error.value.code == "invalid_secret_file_path"

    with pytest.raises(CloudApiError) as protected_error:
        normalize_global_secret_file_path("/run/e2b/token")
    assert protected_error.value.code == "blocked_secret_file_path"


def test_workspace_secret_file_paths_must_stay_inside_repo() -> None:
    assert normalize_workspace_secret_file_path(" config/.env ") == "config/.env"

    with pytest.raises(CloudApiError) as absolute_error:
        normalize_workspace_secret_file_path("/home/user/.env")
    assert absolute_error.value.code == "invalid_workspace_secret_file_path"

    with pytest.raises(CloudApiError) as traversal_error:
        normalize_workspace_secret_file_path("../.env")
    assert traversal_error.value.code == "invalid_workspace_secret_file_path"


def test_secret_values_must_be_non_empty_and_bounded() -> None:
    assert validate_secret_value("secret") == "secret"

    with pytest.raises(CloudApiError) as empty_error:
        validate_secret_value("")
    assert empty_error.value.code == "empty_secret_value"

    with pytest.raises(CloudApiError) as large_error:
        validate_secret_value("x" * (256 * 1024 + 1))
    assert large_error.value.code == "secret_value_too_large"
