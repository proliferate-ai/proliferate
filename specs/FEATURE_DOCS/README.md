# Feature docs

Cross-plane depth references. Each system spec under
[`specs/codebase/systems/`](../codebase/systems/README.md) is the authority on
laws, owned state, fences, and the checked code map; the documents here hold
the flow-level detail a spec links into. Routing lives in
[`AGENTS.md`](../../AGENTS.md); each doc's own header names the spec that
owns it. This file is a plain index.

**The admission bar, stated harshly:** a feature doc exists ONLY when the
system spans planes (client ↔ server ↔ runtime ↔ infra) and no code location
could host the knowledge. If a comment, a lint record, a test, or the system
spec itself could carry it, it does not get a doc. Adding a file here without
meeting that bar is how doc trees rot — don't.

| Doc | System | Owning spec |
| --- | --- | --- |
| [`SANDBOX/`](SANDBOX/) | Client ↔ server ↔ E2B ↔ gateway: lifecycle, access, content, gateway, GitHub auth | [environments](../codebase/systems/product/environments/README.md) (`lifecycle.md` is in staged deletion) |
| [`BILLING.md`](BILLING.md) | Stripe ↔ server ↔ gateway ↔ meters | [billing](../codebase/systems/product/billing/README.md) — superseded, retained as target detail |
| [`MANAGED_RUNTIME.md`](MANAGED_RUNTIME.md) | Server ↔ supervisor ↔ worker: the one convergence story | This document is the spec today |
| [`AGENT_AUTH.md`](AGENT_AUTH.md) | Client ↔ server ↔ runtime ↔ credential vaults | [agent_auth](../codebase/systems/product/agent_auth/README.md) — retained as target detail |
| [`MODELS.md`](MODELS.md) | Target launch options + session live configuration + model gateway | [harnesses](../codebase/systems/runtime/harnesses/README.md) and [model_gateway](../codebase/systems/product/model_gateway/README.md) |
| [`WORKFLOWS.md`](WORKFLOWS.md) | Server ↔ runtime ↔ workspace placement | [automations](../codebase/systems/product/automations/README.md) — narrative reference |
| [`DESKTOP_HOST.md`](DESKTOP_HOST.md) | Web bundle ↔ native shell ↔ sidecar seam | [desktop-host](../codebase/systems/runtime/desktop-host/README.md) |
