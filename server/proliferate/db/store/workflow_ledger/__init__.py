"""WS2a workflow durable-ledger store (persistence skeleton).

Mechanical persistence operations over the WS2a ledger tables
(``proliferate.db.models.cloud.workflow_ledger``) plus the new ADD-ONLY run
state-axis columns on ``workflow_run``. No business logic lives here: callers
(WS2b/2c compiler-ledger-delivery, WS3 gateway, WS4 workers, WS7 leases) own
sequencing, policy, and derivation. Nothing in the running product calls this
package yet — that is the WS2a contract.

Concurrency-bearing operations and their guarantees:

- ``cas_observed_snapshot``: optimistic ``UPDATE ... WHERE observed_revision``
  accepts exactly revision ``current + 1`` (spec §5.4). An identical-bytes retry
  at the current revision reports ``retry_noop``; a conflicting same-revision
  payload reports ``conflict`` for the caller to audit; stale/future report
  ``stale_rejected`` / ``future_rejected``.
- ``acquire_session_leases``: atomic all-or-nothing reservation of every session
  for a run in one transaction, backed by the §8.2 partial unique index (one
  non-released lease per session_id).
- ``claim_outbox_rows`` + the fenced result CAS family (WF-OUTBOX): generation-
  fenced, reclaimable transactional outbox — see ``outbox.py`` for the full fence
  and authority model.
- ``upsert_poll_inbox_item``: ``INSERT ... ON CONFLICT DO NOTHING`` over the
  ``(trigger_id, external_item_id)`` dedupe identity.
- ``insert_gateway_receipt``: plain insert; ``activation_id`` uniqueness is the
  DB constraint (WS3c recovers by activation identity, never duplicates).
- ``insert_action_effect``: ``ON CONFLICT DO NOTHING`` over the
  ``(run_id, step_key, attempt)`` deterministic action identity (§7.4).
"""

from proliferate.db.store.workflow_ledger.gateway import (
    get_gateway_receipt_by_activation,
    insert_capability_lease,
    insert_gateway_receipt,
    list_capability_leases,
    list_gateway_receipts_for_step,
)
from proliferate.db.store.workflow_ledger.inbox import (
    get_action_effect,
    get_poll_inbox_item,
    insert_action_effect,
    update_action_effect,
    update_poll_inbox_item,
    upsert_poll_inbox_item,
)
from proliferate.db.store.workflow_ledger.leases import (
    acquire_session_leases,
    get_active_session_lease,
    list_session_leases_for_run,
    transition_session_lease,
)
from proliferate.db.store.workflow_ledger.observations import (
    cas_observed_snapshot,
    get_observed_snapshot,
)
from proliferate.db.store.workflow_ledger.control_commands import (
    ack_control_command,
    enqueue_control_command,
    list_undelivered_control_commands,
    mark_control_command_delivered,
)
from proliferate.db.store.workflow_ledger.outbox import (
    claim_outbox_rows,
    complete_outbox_success,
    complete_outbox_with_continuation,
    dead_letter_outbox,
    enqueue_outbox,
    fail_outbox_terminal,
    get_outbox_result,
    get_outbox_row,
    heartbeat_outbox,
    reschedule_outbox,
)
from proliferate.db.store.workflow_ledger.records import (
    SESSION_LEASE_BLOCKING_STATES,
    ActionEffectRecord,
    CapabilityLeaseRecord,
    ControlCommandRecord,
    GatewayReceiptRecord,
    ObservedCasResult,
    OutboxRecord,
    OutboxResultRecord,
    OutboxWriteResult,
    PollInboxRecord,
    SessionLeaseRecord,
)

__all__ = [
    "SESSION_LEASE_BLOCKING_STATES",
    "ActionEffectRecord",
    "CapabilityLeaseRecord",
    "ControlCommandRecord",
    "GatewayReceiptRecord",
    "ObservedCasResult",
    "OutboxRecord",
    "OutboxResultRecord",
    "OutboxWriteResult",
    "PollInboxRecord",
    "SessionLeaseRecord",
    "ack_control_command",
    "acquire_session_leases",
    "cas_observed_snapshot",
    "claim_outbox_rows",
    "complete_outbox_success",
    "complete_outbox_with_continuation",
    "dead_letter_outbox",
    "enqueue_control_command",
    "enqueue_outbox",
    "fail_outbox_terminal",
    "get_action_effect",
    "get_active_session_lease",
    "get_gateway_receipt_by_activation",
    "get_observed_snapshot",
    "get_outbox_result",
    "get_outbox_row",
    "get_poll_inbox_item",
    "heartbeat_outbox",
    "insert_action_effect",
    "insert_capability_lease",
    "insert_gateway_receipt",
    "list_capability_leases",
    "list_gateway_receipts_for_step",
    "list_session_leases_for_run",
    "list_undelivered_control_commands",
    "mark_control_command_delivered",
    "reschedule_outbox",
    "transition_session_lease",
    "update_action_effect",
    "update_poll_inbox_item",
    "upsert_poll_inbox_item",
]
