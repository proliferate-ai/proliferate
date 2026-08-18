# Delivery Contract

Status: current repository procedure

Use this contract whenever work moves from one delivery node to another: from
specification to implementation, implementation to review, review to repair,
or a completed slice to its next consumer. It defines the repository-facing
handoff. A runner may choose how to schedule agents, but must leave this record
complete enough that chat is not required to reconstruct the next node.

## Node envelope

Record the following before work starts:

- objective and stopping point;
- exact specification revision plus every applicable ruling or erratum;
- exact base revision and expected head relationship;
- allowed writes and explicit non-goals;
- current owner documents and required repository instructions;
- state/recovery map when durable state can change; and
- affected-consumer map when a contract, schema, event, generated surface, or
  shared package can change.

For an optional field, write `not applicable` and the reason. Do not silently
omit it.

## Completion receipt

The producing node leaves:

- exact current head and commit list;
- changed paths and confirmation that they fit the write boundary;
- exact proof commands, results, and environment; for anything not run, its
  state (`pending`, `not applicable`, or `unavailable`), reason, and residual
  risk;
- observability and security/privacy impact, including `none` plus a reason
  when there is no impact;
- documentation impact and exact paths, or `none` plus a reason;
- affected consumers and their proof or follow-up state;
- review head, verdict, and stable finding identifiers, when review occurred;
- product-proof and human-acceptance state, without inferring either from CI;
- limitations, unresolved decisions, and recovery notes; and
- the authority and stopping condition for the next consumer.

`run` means the named evidence actually ran at the recorded head. `pending`
means an assigned next consumer must still run it. `not applicable` requires a
reason. `unavailable` requires the failed prerequisite, residual risk, and the
authority needed to unblock it. A receipt reports evidence; it does not create
review independence, acceptance, release qualification, or live-system proof.

## Revision and review custody

A frozen delivery specification governs one PR delta only. Identify it by an
exact Git revision or immutable content revision, not by a filename alone.
Root `delivery-spec-*.md` files are retained versioned artifacts and provenance,
not current owner law. Do not rewrite history to adjust a frozen contract;
append an explicit erratum or ruling, identify its revision, and chain it from
the original.

Review is against an exact head. A head move invalidates the prior exact-head
verdict until the reviewer examines the new delta and records the new head,
verdict, and surviving stable finding identifiers. Human acceptance remains a
separate, explicit act by the authorized owner.
