# Engineering Systems

Engineering systems are cross-cutting: they own no product state. Each one
consumes every product and runtime spec's `Emits` section (named events and
signals) and `Proof` section (pinning tests), and serves one property —
legibility by session id: one readable, machine-legible story per session
from user action to agent to gateways to failure.

- [Analytics](analytics/README.md) — product/adoption measurement, anonymous
  telemetry, PostHog routing, and durable Metabase facts and views.
- [Customer loop](customer-loop/README.md) — report → triage → fix → test →
  notify-the-reporter; consumes product support's capture, owns no product
  state.
- [Delivery](delivery/README.md) — release and update behavior.
- [Observability](observability/README.md) — the legible session story:
  one `session_id` across Sentry, structured logs → Grafana, and Honeycomb;
  the closed catalog, correlation vocabulary, scrubbing law, and the
  per-system Emits audit.
- [Testing and Linting](testing/README.md) — the tier contract
  ([`specs/TESTING.md`](../../../TESTING.md) stays the per-PR standard), rule
  records, ratchets, checkers, and the issue→test loop that pins every
  spec's laws.
- [Building Loop](building-loop/README.md) — the path from intent to a
  trusted commit on `main`: PR metadata, rollups, the constitution as data,
  generated-artifact and migration discipline, and the multi-agent merge
  train.
- Alerting, Customer loop — landing tonight as `alerting/`,
  `customer-loop/`; until each lands,
  [`specs/OBSERVABILITY.md`](../../../OBSERVABILITY.md) is the per-PR law.

Retired (2026-08-25, engineering cull PR #2214): the issue-lifecycle system
and its hosted tracker. Support report *capture* is a product system
([support](../product/support/README.md)); what happens after capture is the
customer-loop spec's question.

Contributor procedures for operating these systems live under
[Developing](../../../../guides/README.md).
