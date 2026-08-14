from dataclasses import dataclass
from typing import Literal, Never, TypedDict

from proliferate.lib.product.observability.contract import (
    ProducerRecordV1,
    RejectionReasonV1,
)
from proliferate.lib.product.observability.validation import parse_producer_record_v1
from proliferate.lib.product.observability.validation_error import (
    DiagnosticsContractErrorV1,
)

type SequenceDispositionV1 = Literal[
    "accepted_start", "accepted_terminal", "duplicate", "orphan_terminal"
]


class SequenceDecisionV1(TypedDict):
    disposition: SequenceDispositionV1
    requires_gap_or_health_violation: bool


@dataclass
class _OperationStateV1:
    start: ProducerRecordV1 | None = None
    terminal: ProducerRecordV1 | None = None


class LifecycleSequenceValidatorV1:
    def __init__(self) -> None:
        self._operations: dict[str, _OperationStateV1] = {}

    def apply(self, value: object) -> SequenceDecisionV1:
        record = parse_producer_record_v1(value)
        lifecycle = record.get("lifecycle")
        if lifecycle is None:
            _fail("invalid_shape")
        state = self._operations.get(record["operation_id"])
        if state is not None:
            if state.terminal is not None:
                if state.terminal == record:
                    return _decision("duplicate", False)
                _fail("conflicting_terminal")
            if lifecycle["phase"] == "started":
                if state.start == record:
                    return _decision("duplicate", False)
                _fail("invalid_shape")
            if state.start is None or not _same_operation_identity(state.start, record):
                _fail("invalid_shape")
            state.terminal = record
            return _decision("accepted_terminal", False)

        if lifecycle["phase"] == "started":
            self._operations[record["operation_id"]] = _OperationStateV1(start=record)
            return _decision("accepted_start", False)
        self._operations[record["operation_id"]] = _OperationStateV1(terminal=record)
        return _decision("orphan_terminal", True)


def _decision(
    disposition: SequenceDispositionV1, requires_gap_or_health_violation: bool
) -> SequenceDecisionV1:
    return {
        "disposition": disposition,
        "requires_gap_or_health_violation": requires_gap_or_health_violation,
    }


def _same_operation_identity(left: ProducerRecordV1, right: ProducerRecordV1) -> bool:
    return (
        left["operation_id"] == right["operation_id"]
        and left["producer_boot_id"] == right["producer_boot_id"]
        and left["component"] == right["component"]
        and left["source"] == right["source"]
        and left["name"] == right["name"]
    )


def _fail(reason: RejectionReasonV1) -> Never:
    raise DiagnosticsContractErrorV1(reason)
