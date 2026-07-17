from __future__ import annotations

import pytest

from proliferate.integrations.sandbox import (
    SandboxProviderConfigurationError,
    SandboxProviderTargetUnavailableError,
    SandboxProviderUnavailableError,
)
from proliferate.server.cloud.materialization.failures import materialization_error_receipt
from proliferate.server.cloud.materialization.sandbox_io.target import (
    CloudMaterializationCommandError,
)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (
            SandboxProviderConfigurationError("secret-config-value"),
            "Sandbox provider configuration prevents materialization. Contact support.",
        ),
        (
            SandboxProviderTargetUnavailableError("secret-provider-id"),
            "The provider sandbox no longer exists. Retry to create a replacement.",
        ),
        (
            SandboxProviderUnavailableError("secret-provider-response"),
            "The sandbox provider is temporarily unavailable. Retry later.",
        ),
        (
            CloudMaterializationCommandError("secret-command-output"),
            "The sandbox runtime did not become ready. Retry later.",
        ),
        (RuntimeError("secret-token"), "Sandbox materialization failed. Retry later."),
    ],
)
def test_materialization_error_receipt_is_stable_and_secret_safe(
    error: Exception,
    expected: str,
) -> None:
    receipt = materialization_error_receipt(error)

    assert receipt == expected
    assert "secret" not in receipt
