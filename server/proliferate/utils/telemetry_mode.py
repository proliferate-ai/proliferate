from __future__ import annotations

from typing import Literal

from proliferate.config import settings

type TelemetryMode = Literal["local_dev", "self_managed", "hosted_product"]


def get_server_telemetry_mode() -> TelemetryMode:
    mode = settings.telemetry_mode.strip().lower()
    if mode not in {"local_dev", "self_managed", "hosted_product"}:
        raise RuntimeError(
            "Invalid telemetry_mode; expected local_dev, self_managed, or hosted_product."
        )
    return mode


def is_vendor_telemetry_enabled() -> bool:
    return get_server_telemetry_mode() == "hosted_product"


def is_anonymous_telemetry_enabled() -> bool:
    return not settings.anonymous_telemetry_disabled
