"""Input coercion + v2 template resolution (data-contract §1.3 / B6).

Stored grammar is ``{{inputs.<name>}}`` (eager) and ``{{<emit>.<field>}}``
(rewritten to the runtime's indexed ``{{steps[n].output.<field>}}`` at flatten
time). Input types are text|number|choice|boolean (E2)."""

from __future__ import annotations

import pytest

from proliferate.server.cloud.workflows.domain.interpolation import (
    ArgSpec,
    ArgumentError,
    resolve_string,
    resolve_value,
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


def _resolve(value: str, inputs=None, emit_index=None) -> str:
    return resolve_string(value, inputs=inputs or {}, emit_index=emit_index or {})


# --- coercion (renamed types, unchanged machinery) -----------------------------


def test_coerce_fills_defaults_and_coerces_types() -> None:
    from proliferate.server.cloud.workflows.domain.interpolation import coerce_arguments

    specs = [
        _spec("issue", "text", required=True),
        _spec("tries", "number", default=3, has_default=True),
        _spec("dry", "boolean", default=False, has_default=True),
    ]
    coerced = coerce_arguments(specs, {"issue": "PROJ-1", "tries": "5", "dry": "true"})
    assert coerced == {"issue": "PROJ-1", "tries": 5, "dry": True}


def test_choice_input_validated() -> None:
    from proliferate.server.cloud.workflows.domain.interpolation import coerce_arguments

    specs = [_spec("env", "choice", required=True, enum=("prod", "staging"))]
    assert coerce_arguments(specs, {"env": "prod"}) == {"env": "prod"}
    with pytest.raises(ArgumentError):
        coerce_arguments(specs, {"env": "dev"})


# --- resolution ----------------------------------------------------------------


def test_resolves_inputs_and_rewrites_emit_refs() -> None:
    out = _resolve(
        "Fix {{inputs.issue}} using {{verdict.root_cause}}",
        inputs={"issue": "PROJ-1"},
        emit_index={"verdict": 2},
    )
    assert out == "Fix PROJ-1 using {{steps[2].output.root_cause}}"


def test_boolean_and_number_render_predictably() -> None:
    assert _resolve("{{inputs.flag}}", {"flag": True}) == "true"
    assert _resolve("{{inputs.n}}", {"n": 5}) == "5"


def test_input_value_cannot_inject_a_live_step_token() -> None:
    out = _resolve("{{inputs.evil}}", {"evil": "{{steps[0].output.x}}"})
    assert "{{steps[0].output.x}}" not in out
    assert out == "\\{\\{steps[0].output.x\\}\\}"


def test_resolve_is_recursive_over_json() -> None:
    plan = {
        "steps": [
            {"prompt": "hi {{inputs.name}}"},
            {"message": "later {{verdict.z}}", "n": 3, "flag": True},
        ]
    }
    out = resolve_value(plan, inputs={"name": "Ada"}, emit_index={"verdict": 0})
    assert out["steps"][0]["prompt"] == "hi Ada"
    assert out["steps"][1]["message"] == "later {{steps[0].output.z}}"
    assert out["steps"][1]["n"] == 3
    assert out["steps"][1]["flag"] is True


def test_reserved_first_segment_is_rejected() -> None:
    from proliferate.server.cloud.workflows.domain.interpolation import TemplateReferenceError

    # `steps` is reserved as the resolver's rewrite target: it can never be an
    # emit name, so a two-segment `{{steps.foo}}` ref is a parse error.
    with pytest.raises(TemplateReferenceError):
        _resolve("{{steps.foo}}", {}, {"foo": 0})


def test_fields_ref_parses_and_rewrites_to_injected_emit_index() -> None:
    from proliferate.server.cloud.workflows.domain.interpolation import (
        FieldsReference,
        parse_reference,
    )

    # `{{fields.<name>}}` is a recognized reference type (the notify agent-filled
    # follow-up). Its legality is enforced by the definition validator (only in a
    # notify message with agent_fields); the resolver rewrites it to an indexed ref
    # against the injected notify-fields emit's flat position.
    assert parse_reference("fields.summary") == FieldsReference(name="summary")
    resolved = resolve_string(
        "note: {{fields.summary}}", inputs={}, emit_index={}, fields_index=4
    )
    assert resolved == "note: {{steps[4].output.summary}}"


def test_fields_ref_left_verbatim_without_fields_index() -> None:
    # Defensive: post-validation this never happens, but a fields ref with no
    # injected-emit index must be left verbatim (never mis-resolved to a live
    # token) rather than resolved against the wrong step.
    assert _resolve("{{fields.summary}}", {}, {}) == "{{fields.summary}}"
