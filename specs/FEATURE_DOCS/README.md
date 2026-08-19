# Feature docs

Cross-plane systems you must understand deeply before touching them. Routing
lives in [`AGENTS.md`](../../AGENTS.md); each doc's own header carries its
"read before touching" globs. This file is a plain index.

**The admission bar, stated harshly:** a feature doc exists ONLY when the
system spans planes (client ↔ server ↔ runtime ↔ infra) and no code location
could host the knowledge. If a comment, a lint record, or a test could carry
it, it does not get a doc. Owner-area design judgment belongs in that owner's
README; single-plane systems belong with their owner. Adding a file here
without meeting that bar is how doc trees rot — don't.

| Doc | System |
| --- | --- |
| [`SANDBOX/`](SANDBOX/) | Client ↔ server ↔ E2B ↔ gateway: lifecycle, access, content, gateway, GitHub auth — kept fenced, each file names its neighbors' ownership |
| [`BILLING.md`](BILLING.md) | Stripe ↔ server ↔ gateway ↔ meters |
| [`MANAGED_RUNTIME.md`](MANAGED_RUNTIME.md) | Server ↔ supervisor ↔ worker: the one convergence story |
| [`AGENT_AUTH.md`](AGENT_AUTH.md) | Client ↔ server ↔ runtime ↔ credential vaults |
| [`MODELS.md`](MODELS.md) | Target launch options + session live configuration + model gateway |
| [`WORKFLOWS.md`](WORKFLOWS.md) | Server ↔ runtime ↔ workspace placement |
| [`DESKTOP_HOST.md`](DESKTOP_HOST.md) | Web bundle ↔ native shell ↔ sidecar seam |
