from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict
from pydantic.alias_generators import to_camel
from pydantic.dataclasses import dataclass

AgentReadiness = Literal[
    "ready",
    "install_required",
    "credentials_required",
    "login_required",
    "unsupported",
    "error",
]
CAMEL_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)


@dataclass(config=CAMEL_CONFIG)
class LaunchOptionsCopyRequest:
    source_revision: int
    payload_json: str


@dataclass(config=CAMEL_CONFIG)
class LaunchModel:
    id: str
    observed_name: str | None
    observed_description: str | None


@dataclass(config=CAMEL_CONFIG)
class LaunchControlValue:
    value: str
    observed_label: str | None
    observed_description: str | None


@dataclass(config=CAMEL_CONFIG)
class LaunchControl:
    id: str
    observed_label: str | None
    observed_description: str | None
    values: list[LaunchControlValue]


@dataclass(config=CAMEL_CONFIG)
class LaunchDefaults:
    model_id: str | None
    control_values: dict[str, str]


@dataclass(config=CAMEL_CONFIG)
class LaunchOptions:
    models: list[LaunchModel]
    controls: list[LaunchControl]
    defaults: LaunchDefaults


@dataclass(config=CAMEL_CONFIG)
class CopiedLaunchOptionsResponse:
    harness_kind: str
    basis_revision: str
    revision: int
    state: Literal[
        "detecting",
        "refreshing",
        "observed",
        "observed_empty",
        "last_good_after_failure",
        "failed_without_observation",
    ]
    options: LaunchOptions | None
    observed_at: str | None
    probe_attempted_at: str
    probe_failure_code: str | None
    readiness: AgentReadiness
