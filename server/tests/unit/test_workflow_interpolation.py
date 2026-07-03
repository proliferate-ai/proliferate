"""Argument coercion and eager ``{{args.*}}`` interpolation (spec 3.3)."""

from __future__ import annotations

import pytest

from proliferate.server.cloud.workflows.domain.interpolation import (
    ArgSpec,
    ArgumentError,
    coerce_arguments,
    interpolate_args,
    interpolate_args_in_string,
)


def _spec(
    name: str, type_: str, *, required: bool = False, default=None, has_default=False, enum=()
):
    return ArgSpec(
        name=name,
        type=type_,
        required=required,
        has_default=has_default,
        default=default,
        enum_values=tuple(enum),
    )


def test_coerce_fills_defaults_and_coerces_types() -> None:
    specs = [
        _spec("issue", "string", required=True),
        _spec("tries", "number", default=3, has_default=True),
        _spec("dry", "boolean", default=False, has_default=True),
    ]
    coerced = coerce_arguments(specs, {"issue": "PROJ-1", "tries": "5", "dry": "true"})
    assert coerced == {"issue": "PROJ-1", "tries": 5, "dry": True}


def test_missing_required_argument_rejected() -> None:
    specs = [_spec("issue", "string", required=True)]
    with pytest.raises(ArgumentError) as exc:
        coerce_arguments(specs, {})
    assert exc.value.code == "missing_argument"


def test_unknown_argument_rejected() -> None:
    specs = [_spec("issue", "string", required=True)]
    with pytest.raises(ArgumentError) as exc:
        coerce_arguments(specs, {"issue": "x", "bogus": 1})
    assert exc.value.code == "unknown_argument"


def test_enum_argument_validated() -> None:
    specs = [_spec("env", "enum", required=True, enum=("prod", "staging"))]
    assert coerce_arguments(specs, {"env": "prod"}) == {"env": "prod"}
    with pytest.raises(ArgumentError):
        coerce_arguments(specs, {"env": "dev"})


def test_number_rejects_non_numeric_and_bool() -> None:
    specs = [_spec("n", "number", required=True)]
    with pytest.raises(ArgumentError):
        coerce_arguments(specs, {"n": "abc"})
    with pytest.raises(ArgumentError):
        coerce_arguments(specs, {"n": True})


def test_interpolate_replaces_args_and_preserves_step_tokens() -> None:
    out = interpolate_args_in_string(
        "Fix {{args.issue}} then check {{steps[1].output.test}}",
        {"issue": "PROJ-1"},
    )
    assert out == "Fix PROJ-1 then check {{steps[1].output.test}}"


def test_boolean_and_number_render_predictably() -> None:
    assert interpolate_args_in_string("{{args.flag}}", {"flag": True}) == "true"
    assert interpolate_args_in_string("{{args.n}}", {"n": 5}) == "5"


def test_arg_value_cannot_inject_a_live_step_token() -> None:
    # An arg value that literally contains a step token must be neutralized so the
    # runtime's later step-output pass cannot pick it up as a live reference.
    out = interpolate_args_in_string("{{args.evil}}", {"evil": "{{steps[0].output.x}}"})
    assert "{{steps[0].output.x}}" not in out
    assert out == "\\{\\{steps[0].output.x\\}\\}"


def test_interpolate_is_recursive_over_json() -> None:
    plan = {
        "steps": [
            {"prompt": "hi {{args.name}}"},
            {"message": "later {{steps[0].output.z}}", "n": 3, "flag": True},
        ]
    }
    out = interpolate_args(plan, {"name": "Ada"})
    assert out["steps"][0]["prompt"] == "hi Ada"
    assert out["steps"][1]["message"] == "later {{steps[0].output.z}}"
    assert out["steps"][1]["n"] == 3
    assert out["steps"][1]["flag"] is True
