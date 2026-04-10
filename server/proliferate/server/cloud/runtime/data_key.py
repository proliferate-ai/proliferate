"""Workspace-scoped runtime data-key helpers."""

from __future__ import annotations

import base64
import secrets


def generate_anyharness_data_key() -> str:
    return base64.b64encode(secrets.token_bytes(32)).decode("ascii")
