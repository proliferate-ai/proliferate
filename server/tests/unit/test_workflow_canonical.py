from __future__ import annotations

import copy
import json
import math
from pathlib import Path

import pytest

from proliferate.server.workflows.domain.canonical import (
    bundle_digest,
    canonical_bytes,
    canonical_json,
    digest,
    runtime_payload_digest,
    sha256_hex,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = REPO_ROOT / "fixtures" / "contracts" / "workflow-run"


def _load(name: str) -> dict:
    return json.loads((FIXTURE_ROOT / name).read_text(encoding="utf-8"))


def test_golden_canonical_cases_agree() -> None:
    cases = _load("canonical-cases.json")["cases"]
    assert cases
    for case in cases:
        assert canonical_json(case["value"]) == case["canonical"], case["name"]
        assert sha256_hex(case["value"]) == case["sha256"], case["name"]


def test_golden_bundle_digest_agrees() -> None:
    fixture = _load("resolved-bundle.json")
    bundle = fixture["bundle"]
    assert bundle_digest(bundle) == fixture["bundleDigest"]
    # The digest covers exactly the four §6.3 members, nothing else.
    covered = {
        key: bundle[key]
        for key in ("definition", "arguments", "resolvedStages", "resolvedPlacement")
    }
    assert sha256_hex(covered) == fixture["bundleDigest"]


def test_bundle_digest_excludes_wire_wrapper_fields() -> None:
    bundle = copy.deepcopy(_load("resolved-bundle.json")["bundle"])
    baseline = bundle_digest(bundle)
    bundle["runId"] = "ffffffff-0000-4000-8000-000000000000"
    bundle["contractVersion"] = 999
    assert bundle_digest(bundle) == baseline
    del bundle["runId"]
    del bundle["contractVersion"]
    assert bundle_digest(bundle) == baseline


def test_bundle_digest_covers_every_logical_member() -> None:
    fixture = _load("resolved-bundle.json")
    baseline = bundle_digest(fixture["bundle"])
    mutations: dict[str, object] = {
        "definition": {"id": "other"},
        "arguments": {"ticket": "PRO-999"},
        "resolvedStages": [],
        "resolvedPlacement": {"kind": "newScratch"},
    }
    for field, value in mutations.items():
        bundle = copy.deepcopy(fixture["bundle"])
        bundle[field] = value
        assert bundle_digest(bundle) != baseline, field


def test_bundle_digest_requires_covered_fields() -> None:
    bundle = copy.deepcopy(_load("resolved-bundle.json")["bundle"])
    del bundle["arguments"]
    with pytest.raises(ValueError, match="arguments"):
        bundle_digest(bundle)
    with pytest.raises(TypeError):
        bundle_digest([])  # type: ignore[arg-type]


def test_golden_runtime_payload_digest_agrees() -> None:
    fixture = _load("runtime-payload.json")
    payload = fixture["payload"]
    assert runtime_payload_digest(payload) == fixture["runtimePayloadDigest"]
    # The digest covers exactly the immutable `run` object.
    assert sha256_hex(payload["run"]) == fixture["runtimePayloadDigest"]


def test_runtime_payload_digest_excludes_epoch_and_control() -> None:
    payload = copy.deepcopy(_load("runtime-payload.json")["payload"])
    baseline = runtime_payload_digest(payload)
    payload["expectedDataEpoch"] = "01J00000000000000000000000"
    payload["control"]["cancelRequested"] = False
    assert runtime_payload_digest(payload) == baseline
    del payload["expectedDataEpoch"]
    del payload["control"]
    assert runtime_payload_digest(payload) == baseline
    # Mutating the run object itself must change the digest.
    payload["run"]["placement"]["kind"] = "worktree"
    assert runtime_payload_digest(payload) != baseline


def test_runtime_payload_digest_requires_run() -> None:
    with pytest.raises(ValueError, match="'run'"):
        runtime_payload_digest({"control": {"cancelRequested": True}})


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (0, "0"),
        (0.0, "0"),
        (-0.0, "0"),
        (1.0, "1"),
        (-1.5, "-1.5"),
        (0.1, "0.1"),
        (4.5, "4.5"),
        (0.002, "0.002"),
        (1e20, "100000000000000000000"),
        (1e21, "1e+21"),
        (1e23, "1e+23"),
        (1e30, "1e+30"),
        (1e-6, "0.000001"),
        (1e-7, "1e-7"),
        (1e-27, "1e-27"),
        (333333333.33333329, "333333333.3333333"),
        (9007199254740994.0, "9007199254740994"),
        (5e-324, "5e-324"),
        (1.7976931348623157e308, "1.7976931348623157e+308"),
        (2.5e22, "2.5e+22"),
        (-2.5e-22, "-2.5e-22"),
        (2**53, "9007199254740992"),
        (-(2**53), "-9007199254740992"),
    ],
)
def test_ecmascript_number_thresholds(value: float | int, expected: str) -> None:
    assert canonical_json(value) == expected


def test_utf16_key_sort_orders_surrogates_before_high_bmp() -> None:
    value = {"דּ": 1, "\U0001f600": 2, "€": 3, "1": 4, "\r": 5}
    assert canonical_json(value) == (
        '{"\\r":5,"1":4,"€":3,"\U0001f600":2,"דּ":1}'
    )


def test_string_escaping_is_minimal() -> None:
    assert canonical_json("€$\x0f\nA'B\"\\\"/") == (
        '"€$\\u000f\\nA\'B\\"\\\\\\"/"'
    )


def test_rejects_non_finite_numbers() -> None:
    for bad in (math.nan, math.inf, -math.inf):
        with pytest.raises(ValueError):
            canonical_json(bad)


def test_rejects_integers_outside_ieee_exact_range() -> None:
    # Includes literals beyond u64/i64, where the Rust twin has already lost
    # the exact value to f64 parsing; Python sees them exactly and is the
    # strict gate at the Cloud write boundary.
    for bad in (2**53 + 1, -(2**53) - 1, 10**21, 2**64, -(2**63) - 1):
        with pytest.raises(ValueError):
            canonical_json(bad)


def test_rejects_lone_surrogates() -> None:
    for bad in ("\ud800", {"\udfff": 1}, ["a\ud800b"]):
        with pytest.raises(ValueError):
            canonical_json(bad)
    # json.loads happily produces lone surrogates from \uXXXX escapes.
    with pytest.raises(ValueError):
        sha256_hex(json.loads('"\\ud800"'))


def test_rejects_non_string_keys_and_unknown_types() -> None:
    with pytest.raises(TypeError):
        canonical_json({1: "a"})
    with pytest.raises(TypeError):
        canonical_json({"a": object()})


def test_canonical_bytes_and_digest_alias() -> None:
    value = {"a": [1, True, None, "x"]}
    assert canonical_bytes(value) == canonical_json(value).encode("utf-8")
    assert digest(value) == sha256_hex(value)
