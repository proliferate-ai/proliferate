import type { ProducerRecordV1, RejectionReasonV1 } from "./contract";
import { DiagnosticsContractErrorV1 } from "./validation-support";
import { parseProducerRecordV1 } from "./validation";

export type SequenceDispositionV1 =
  | "accepted_start"
  | "accepted_terminal"
  | "duplicate"
  | "orphan_terminal";

export interface SequenceDecisionV1 {
  disposition: SequenceDispositionV1;
  requires_gap_or_health_violation: boolean;
}

interface OperationStateV1 {
  start?: ProducerRecordV1;
  terminal?: ProducerRecordV1;
}

export class LifecycleSequenceValidatorV1 {
  private readonly operations = new Map<string, OperationStateV1>();

  apply(input: unknown): SequenceDecisionV1 {
    const record = parseProducerRecordV1(input);
    const lifecycle = record.lifecycle;
    if (lifecycle === undefined) {
      fail("invalid_shape");
    }
    const state = this.operations.get(record.operation_id);
    if (state !== undefined) {
      if (state.terminal !== undefined) {
        if (sameRecord(state.terminal, record)) {
          return decision("duplicate", false);
        }
        fail("conflicting_terminal");
      }
      if (lifecycle.phase === "started") {
        if (state.start !== undefined && sameRecord(state.start, record)) {
          return decision("duplicate", false);
        }
        fail("invalid_shape");
      }
      if (state.start === undefined || !sameOperationIdentity(state.start, record)) {
        fail("invalid_shape");
      }
      state.terminal = record;
      return decision("accepted_terminal", false);
    }

    if (lifecycle.phase === "started") {
      this.operations.set(record.operation_id, { start: record });
      return decision("accepted_start", false);
    }
    this.operations.set(record.operation_id, { terminal: record });
    return decision("orphan_terminal", true);
  }
}

function decision(
  disposition: SequenceDispositionV1,
  requiresGapOrHealthViolation: boolean,
): SequenceDecisionV1 {
  return {
    disposition,
    requires_gap_or_health_violation: requiresGapOrHealthViolation,
  };
}

function sameRecord(left: ProducerRecordV1, right: ProducerRecordV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameOperationIdentity(left: ProducerRecordV1, right: ProducerRecordV1): boolean {
  return (
    left.operation_id === right.operation_id &&
    left.producer_boot_id === right.producer_boot_id &&
    left.component === right.component &&
    left.source === right.source &&
    left.name === right.name
  );
}

function fail(reason: RejectionReasonV1): never {
  throw new DiagnosticsContractErrorV1(reason);
}
