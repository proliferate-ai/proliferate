from __future__ import annotations

from dataclasses import field
from typing import Literal

from pydantic import ConfigDict, StrictInt, StrictStr
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
LaunchOptionsState = Literal[
    "detecting",
    "refreshing",
    "observed",
    "observed_empty",
    "last_good_after_failure",
    "failed_without_observation",
]
CAMEL_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True)
STRICT_CAMEL_CONFIG = ConfigDict(
    alias_generator=to_camel,
    extra="forbid",
    populate_by_name=True,
)


@dataclass(config=CAMEL_CONFIG)
class LaunchOptionsCopyRequest:
    source_revision: int
    payload_json: str


@dataclass(config=STRICT_CAMEL_CONFIG)
class LaunchModel:
    id: StrictStr
    observed_name: StrictStr | None
    observed_description: StrictStr | None


@dataclass(config=STRICT_CAMEL_CONFIG)
class LaunchControlValue:
    value: StrictStr
    observed_label: StrictStr | None
    observed_description: StrictStr | None


@dataclass(config=STRICT_CAMEL_CONFIG)
class LaunchControl:
    id: StrictStr
    observed_label: StrictStr | None
    observed_description: StrictStr | None
    values: list[LaunchControlValue]


@dataclass(config=STRICT_CAMEL_CONFIG)
class LaunchDefaults:
    model_id: StrictStr | None
    control_values: dict[StrictStr, StrictStr]


@dataclass(config=STRICT_CAMEL_CONFIG)
class LaunchModelControls:
    model_id: StrictStr
    controls: list[LaunchControl]
    default_control_values: dict[StrictStr, StrictStr]


@dataclass(config=STRICT_CAMEL_CONFIG)
class LaunchOptions:
    models: list[LaunchModel]
    controls: list[LaunchControl]
    defaults: LaunchDefaults
    model_controls: list[LaunchModelControls] = field(default_factory=list)


@dataclass(config=STRICT_CAMEL_CONFIG)
class CopiedLaunchOptionsState:
    """Verbatim runtime-owned state accepted from a target Worker."""

    harness_kind: StrictStr
    basis_revision: StrictStr
    revision: StrictInt
    state: LaunchOptionsState
    options: LaunchOptions | None
    observed_at: StrictStr | None
    probe_attempted_at: StrictStr
    probe_failure_code: StrictStr | None


@dataclass(config=CAMEL_CONFIG)
class CopiedLaunchOptionsResponse:
    harness_kind: StrictStr
    basis_revision: StrictStr
    revision: StrictInt
    state: LaunchOptionsState
    options: LaunchOptions | None
    observed_at: StrictStr | None
    probe_attempted_at: StrictStr
    probe_failure_code: StrictStr | None
    readiness: AgentReadiness
