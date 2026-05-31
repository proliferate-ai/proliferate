from __future__ import annotations

from proliferate.server.support.redaction import redact_mapping


def test_support_redaction_scrubs_strings_nested_inside_lists() -> None:
    opaque = "a" * 56

    redacted = redact_mapping(
        {
            "notes": [
                f"Authorization: Bearer {opaque}",
                "AWS_SECRET_ACCESS_KEY=abc123",
                {
                    "url": (
                        "https://s3.example/object?"
                        "X-Amz-Signature=super-secret&X-Amz-Date=20260531"
                    )
                },
                [f"token={opaque}"],
            ],
            "metadata": {"apiKey": "already summary"},
        }
    )

    assert redacted == {
        "notes": [
            "Authorization: Bearer [REDACTED]",
            "AWS_SECRET_ACCESS_KEY=[REDACTED]",
            {
                "url": (
                    "https://s3.example/object?X-Amz-Signature=[REDACTED]&X-Amz-Date=[REDACTED]"
                )
            },
            ["token=[REDACTED]"],
        ],
        "metadata": {"apiKey": "[REDACTED]"},
    }
