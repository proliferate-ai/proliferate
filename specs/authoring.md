# Authoring Specs

How to write a document under `specs/`. [README.md](README.md) owns what the
categories mean and which document has authority; this guide owns what a good
document looks like once you know where it goes. These rules were settled
during the platform-spec rewrites (model-gateway, agent-distribution,
agent-auth) and apply to every new or rewritten document.

## The core rules

### 1. No abstract claims

Every behavioral claim names its trigger, what happens, and where the code
lives. "Installation is automatic" is not a spec sentence; "every runtime
startup fires a reconcile pass that diffs catalog pins against install
manifests (`spawn_startup_pass` in `runtime.rs`)" is. A reader should never
have to guess which code path a sentence describes. It does not need to be
exhaustive — a file link and one mechanism clause is enough — but the
trigger/mechanism/location triple must be recoverable from the text.

### 2. Code references are real links

Every file or symbol reference is a relative markdown link to the actual
path, not a bare backtick name:

```markdown
[selection_rules.py](../server/proliferate/server/agent_auth/selection_rules.py)
```

[`check_docs.py`](../scripts/check_docs.py) validates link destinations, so a
rename breaks CI instead of silently orphaning the reference. Backticks
without a link are allowed only for things that are not paths: env var
names, table names, JSON keys, command strings.

### 3. Include a file tree

Every document with a code map includes a tree laying out where the pieces
live, ordered by how the data flows (not alphabetically), with a short
annotation per entry:

```text
server/proliferate/
├── db/models/agent_gateway.py     the three tables + constraints
└── server/agent_auth/
    ├── api.py                           routes
    └── selection_rules.py               per-harness cardinality
```

A prose table of layers may follow it, but the tree comes first: it is the
mental model a new reader loads before anything else makes sense.

### 4. Be explicit about what is in and what is out

Every document opens with its ownership and its fences: what it owns, which
neighboring document owns each adjacent concern, and a link to that
neighbor. A concept has exactly one owning document; everyone else links.
When a boundary is subtle, name the split in one memorable line and repeat
it on both sides (e.g. agent-distribution *declares* auth vocabulary,
agent-auth *applies* it). If you cannot say which document owns a fact,
that is a structure problem to resolve before writing, not after.

### 5. Status and the gaps contract

A document describing behavior on `main` needs no status line. A document
describing an accepted destination is labeled `Status: target` in its first
line, its body is written entirely in the ideal state, and every difference
from `main` lives in one `## Current gaps` checklist at the end — each item
naming the delta, the code that embodies it today (linked), and enough
context that a follow-up PR can strike it without re-deriving the decision.
Nothing in the body hedges ("will eventually", "is planned"); the body
asserts the destination and the gaps list holds the honesty. The label
comes off when the list empties.

Follow-ups, known defects, and open oddities found while writing also go in
Current gaps — never as TODOs scattered through the body.

### 6. Laws, stated as laws

Contracts that code must uphold are written as short bold claims followed by
the reason and the enforcing code path:

> **Native is the absence of rows.** `source_kind` has exactly two stored
> values (link the constants file here); zero enabled rows means the
> harness runs on its own login.

A law earns its place by closing a specific failure mode. If you cannot say
what would break without it, it is a description, not a law — write it as
plain prose instead.

### 7. Tables for enumerable contracts, prose for reasoning

Anything a reader will look up row-by-row — per-kind semantics, per-harness
recipes, route maps, error taxonomies — is a table with explicit columns
("what the user is saying", "rendered at launch as"), detailed enough that
implementation can be driven from the row alone. Anything that needs a *why*
is prose around the table, never crammed into a cell.

### 8. Failure modes are part of the contract

Every behavioral document ends with the failure modes a consumer can
observe: the condition, the typed error or status it produces, and what
recovers it. "What happens when this breaks" is spec content, not runbook
content — the runbook owns the operator's response, the spec owns the
system's behavior.

### 9. A mental model before mechanism

When a section describes a pipeline or multi-stage process, open with the
one-paragraph mental model (what question the machinery answers, in plain
words) before naming stages. Stage names (`resolve`, `render`,
`materialize`) are implementation vocabulary; a reader should understand
the section with the stage names deleted.

## Per-kind expectations

The core rules apply everywhere. Each document kind adds a shape:

### Codebase platform specs (`codebase/platforms/**`)

The contract for a capability multiple systems reuse. Must name: the durable
state or contract it owns, the structures implementing it, the systems
consuming it, the API/SDK/runtime shape, document laws, failure modes, and
proof (tests/smokes). The per-directory README's platform map row is part of
the deliverable: one sentence of "owns", a link, and the status label.

### Codebase system specs (`codebase/systems/**`)

A complete product or engineering domain, including its screens, flows, and
acceptance behavior. Systems consume platforms by link; a system document
restating a platform contract is a bug.

### Codebase structure specs (`codebase/structures/**`)

Source-area organization: the tree, what each module owns, and dependency
direction. Structure docs describe *where code lives and why*, never product
behavior — behavior claims belong in the owning platform/system doc, linked.

### Procedures (`guides/**`)

Operator- or developer-facing steps for a current task. Must name required
tools and permissions, the happy path from trigger to verified completion,
verification, failure modes with first responses, and the applicable
secrets policy. Procedures link to the owning spec for behavior and never
duplicate architecture; if you find yourself explaining *why* the system
works some way, move that text to the spec and link it.

### Delivery specifications (outside `specs/`)

Founder-approved intent for one PR: frozen at approval, governs only that
PR's delta, and never lands in the permanent documentation path. If a
delivery spec contradicts a current document, stop and report the exact
contradiction (see [README.md](README.md)).

## Process rules

- Update current documentation in the same PR that changes behavior; a truth
  pass that only re-aligns documents is its own PR.
- Run [`check_docs.py`](../scripts/check_docs.py) before every push.
- When a ruling in one document obsoletes text elsewhere, either fix the
  other document in the same PR or pin it as an explicit gap item naming the
  file — never leave the contradiction undocumented.
