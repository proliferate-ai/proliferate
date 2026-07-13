from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from proliferate.server.workflows.domain.canonical import (
    canonical_bytes,
    canonical_json,
    digest,
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


def test_golden_resolved_bundle_digest_agrees() -> None:
    fixture = _load("resolved-bundle.json")
    assert sha256_hex(fixture["bundle"]) == fixture["sha256"]


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
