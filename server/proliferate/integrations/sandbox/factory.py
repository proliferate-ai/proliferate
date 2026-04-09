"""Factory helpers for selecting sandbox providers."""

from __future__ import annotations

from proliferate.config import settings
from proliferate.integrations.sandbox.base import (
    SandboxProvider,
    SandboxProviderError,
    SandboxProviderKind,
)


def get_configured_sandbox_provider() -> SandboxProvider:
    return get_sandbox_provider(settings.sandbox_provider)


def get_sandbox_provider(kind: SandboxProviderKind | str) -> SandboxProvider:
    try:
        resolved = SandboxProviderKind(str(kind))
    except ValueError as exc:
        raise SandboxProviderError(f"Unsupported sandbox provider: {kind}") from exc

    if resolved is SandboxProviderKind.e2b:
        from proliferate.integrations.sandbox.e2b import E2BSandboxProvider

        return E2BSandboxProvider()

    if resolved is SandboxProviderKind.daytona:
        from proliferate.integrations.sandbox.daytona import DaytonaSandboxProvider

        return DaytonaSandboxProvider()

    raise SandboxProviderError(f"Unsupported sandbox provider: {resolved}")
