"""Unit coverage for the pure event helpers behind the workspace-move E2E.

These run in the normal suite (no live cloud) and pin the codeword-recall
detection the real round-trip test depends on.
"""

from __future__ import annotations

from tests.e2e.cloud.helpers.mobility_runtime import (
    assistant_message_texts,
    latest_event_seq,
    turn_contains_text,
)


def _assistant_completed(seq: int, text: str) -> dict[str, object]:
    return {
        "seq": seq,
        "event": {
            "type": "item_completed",
            "item": {
                "kind": "assistant_message",
                "status": "completed",
                "contentParts": [{"type": "text", "text": text}],
            },
        },
    }


def test_latest_event_seq_returns_zero_when_empty() -> None:
    assert latest_event_seq([]) == 0


def test_latest_event_seq_is_the_max_seq_not_the_last() -> None:
    events = [{"seq": 7}, {"seq": 42}, {"seq": 12}, {"seq": None}, {}]
    assert latest_event_seq(events) == 42


def test_assistant_message_texts_extracts_only_assistant_prose() -> None:
    events = [
        {"seq": 1, "event": {"type": "turn_started"}},
        {
            "seq": 2,
            "event": {
                "type": "item_completed",
                "item": {
                    "kind": "tool_invocation",
                    "contentParts": [{"type": "text", "text": "ls"}],
                },
            },
        },
        _assistant_completed(3, "The codeword is PLUM-42."),
    ]
    assert assistant_message_texts(events) == ["The codeword is PLUM-42."]


def test_turn_contains_text_matches_assistant_prose() -> None:
    events = [_assistant_completed(5, "It was PLUM-42, I remember.")]
    assert turn_contains_text(events, "PLUM-42") is True
    assert turn_contains_text(events, "MANGO-99") is False


def test_turn_contains_text_falls_back_to_delta_envelopes() -> None:
    # Some agents stream prose only through deltas (no completed content parts).
    events = [
        {"seq": 8, "event": {"type": "item_delta", "delta": {"appendText": "answer: PLUM-42"}}},
    ]
    assert assistant_message_texts(events) == []
    assert turn_contains_text(events, "PLUM-42") is True


def test_turn_contains_text_ignores_non_content_events() -> None:
    events = [{"seq": 9, "event": {"type": "turn_ended", "detail": "PLUM-42"}}]
    assert turn_contains_text(events, "PLUM-42") is False
