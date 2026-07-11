"""Python leg of T1-WF-CONTRACT-01.

Exercises the shared golden workflow contract fixtures through the Python
contract models, canonical hashing, schema profile, legacy UUIDv5 upgrade, and
credential-canary redaction. The same checks run standalone under
`scripts/check_workflow_contract_fixtures.py`.
"""

from __future__ import annotations

import pytest

from proliferate.server.cloud.workflows.contracts import verify
from proliferate.server.cloud.workflows.contracts.schema_profile import (
    SchemaProfileError,
    validate_schema_profile,
)


@pytest.mark.parametrize("check", verify.CHECKS, ids=lambda c: c.__name__)
def test_contract_check_group(check) -> None:
    check()


def test_run_all_checks_passes() -> None:
    verify.run_all_checks()


def test_schema_profile_rejects_unsupported_keyword() -> None:
    with pytest.raises(SchemaProfileError) as exc:
        validate_schema_profile(
            {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "additionalProperties": False,
                "properties": {"x": {"type": "string", "pattern": "^a"}},
            }
        )
    assert exc.value.code == "unsupported_keyword"
