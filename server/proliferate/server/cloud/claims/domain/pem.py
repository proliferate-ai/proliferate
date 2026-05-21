"""PEM parsing helpers for cloud claim auth."""

from __future__ import annotations


def normalize_pem_setting(value: str) -> str:
    """Accept PEM values from .env files where newlines are escaped."""
    return value.replace("\\n", "\n").strip()
