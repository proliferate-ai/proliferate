# Give Agents a Clean Operating Surface

> [!important] Frozen contract
> Founder-approved on 2026-07-14 and grounded in Proliferate `origin/main` at
> `66f45bfbe2839ae1382133393844ba61dce035cd`, the accepted F1 tracker API, and
> the local Codex/Claude surfaces audited on 2026-07-14. Implementation is
> authorized only after F1 is accepted and the access preflight is green.

- Current slice: **F2 - Give Agents a Clean Operating Surface - frozen**
- Next slice: **founder acceptance and normal issue operations**

## Outcome

A fresh Codex agent and a fresh Claude/Fable agent, with no chat history, can
discover one shared procedure and safely operate the production issue queue.

```text
fresh agent
-> discover shared issue-triage skill
-> obtain machine credential by reference, never prompt value
-> list / poll / claim / inspect
-> follow exact evidence to Sentry, support, Grafana, CloudWatch, or E2B
-> write a concise conclusion / dedup / authoritative PR link
-> release claim
```

This slice removes founder context-switching. It does not change the
issue-tracker application or grant agents license to mutate arbitrary customer
issues or invent fuzzy relationships.

## Preconditions

- F1 is accepted, deployed, and its GitHub-authoritative PR-link proof passes.
- Production source health is fresh and the controlled Sentry, support, and
  Grafana samples from C through E2 are retained.
- `issue-tracker/app.agentApiKey` exists and is readable through the approved
  local AWS credential path.
- Provider access is already proven for Sentry, product support storage,
  Grafana, CloudWatch, E2B, GitHub, and the product browser. F2 does not stop to
  ask Pablo to sign in or mint a key.
- Claude's broken `node_repl` MCP path has been repaired from the absent
  `/Applications/Codex.app/...` runtime to the installed
  `/Applications/ChatGPT.app/...` runtime during P0.

## Canonical interface

REST is the complete operating interface. Do not expand MCP merely for parity:

```text
GET   /v1/issues
GET   /v1/issues/{id}
GET   /v1/issues/poll
GET   /v1/ops
POST  /v1/issues/{id}/claim
POST  /v1/issues/{id}/release-claim
PATCH /v1/issues/{id}
POST  /v1/issues/{id}/deduplicate
POST  /v1/issues/{id}/prs
```

Machine authentication uses `Authorization: Bearer <agentApiKey>`. Every
mutation also requires a unique `X-Run-Id`. Human Web and release credentials
must not work on agent routes, and the agent credential must not impersonate
those boundaries.

Safe issue detail remains sufficient: source key/URL, occurrence event keys
with user/release identity, safe reporter choices/reference, linked PRs, and
audit events. Private support bodies, attachments, raw Sentry payloads, and raw
logs stay in their owning systems.

## Files and ownership

Expected Proliferate documentation changes:

```text
specs/developing/debugging/
├── README.md                 # route to issue triage
└── issue-triage.md           # human-readable operating procedure
```

Expected shared local skill:

```text
~/.agents/skills/triage-production-issue/
├── SKILL.md
└── scripts/
    └── issues.py

~/.claude/skills/triage-production-issue
  -> ~/.agents/skills/triage-production-issue
```

Codex already discovers `~/.agents/skills`. Add a
`~/.codex/skills/triage-production-issue` symlink only if the fresh Codex
acceptance proves this installation does not. There is one source skill, not
separate drifting Codex and Claude copies.

F2 makes no issue-tracker application, schema, deployment, or source-writer
change. A concrete missing REST capability fails the proof and is reported as
a bounded amendment; it is not worked around with browser automation, direct
database writes, or a second protocol.

## Safe REST helper

`scripts/issues.py` supports only:

```text
list
poll
get
ops
claim
release
patch
dedup
link-pr
```

It must:

1. use the fixed origin `https://issues.proliferate.com` and reject every other
   host;
2. fetch `agentApiKey` from `issue-tracker/app` for each invocation through the
   approved AWS path, without printing or persisting it;
3. use bounded connect/read timeouts and fail nonzero on HTTP/protocol errors;
4. emit bounded JSON to stdout and diagnostics to stderr;
5. require an explicit unique run ID for every mutation;
6. preserve poll cursors exactly and expose conflict/precondition responses;
7. never create an issue manually, fetch private report objects, or dump raw
   provider payloads; and
8. redact authorization headers and secret-provider responses in every error.

The local ops environment may contain nonsecret references and the fixed
origin. It does not contain a second durable copy of the agent key.

Exact command mappings are:

```text
release -> POST  /v1/issues/{id}/release-claim
patch   -> PATCH /v1/issues/{id}
dedup   -> POST  /v1/issues/{id}/deduplicate
link-pr -> POST  /v1/issues/{id}/prs
```

## Shared skill behavior

The skill starts with one decision:

```text
read-only investigation
or
approved controlled mutation
```

For mutation, the agent claims first, uses a unique `X-Run-Id`, respects claim
conflicts, and releases its claim when it stops. It records short conclusions,
exact source IDs, links, and next actions rather than copied evidence.

Automatic deduplication is exact-identity only. Similar titles, stack traces,
users, timing, or guessed root causes are not merge authority. Ambiguous cases
remain separate with a note for founder review.

### Sentry and E2B

```text
tracker source key / occurrence event key
-> exact project + event ID
-> Sentry event API
-> user.id + canonical release + relevant tags
-> sandbox_id only when the event itself contains it
-> e2b sandbox info/logs/connect only for that exact sandbox
```

The agent does not add a tracker sandbox column or search all running sandboxes
by user. `connect` is allowed only when the exact sandbox is still running and
the investigation is authorized.

### Support

```text
tracker reportId/private reference
-> existing private support-evidence procedure
-> exact encrypted object/diagnostics only when required
-> safe conclusion in tracker
```

The response and tracker note never include a raw message body, attachment,
diagnostics archive, outreach address, or credential material.

### Grafana and CloudWatch

```text
stable rule UID
-> exact provisioned rule and runbook
-> occurrence firing window
-> annotated group/filter/region when present
-> bounded CloudWatch query
```

The agent does not broaden to all log groups or store raw log lines in the
tracker. Metric-only rules stop at rule/dashboard/runbook evidence.

### GitHub

The agent may compare exact revisions, inspect a PR, and attach a PR through
`POST /v1/issues/{id}/prs`. It does not infer that a similarly named PR fixes
an issue. The relationship must be supported by an explicit issue ID or
reviewed evidence; F1 guarantees the returned fields come from GitHub.

## Human runbook

`issue-triage.md` must be usable without agent knowledge. It documents:

- `/v1/ops` and source freshness;
- list versus cursor-based poll semantics;
- claim, conflict, release, status/note, dedup, and PR-link behavior;
- each exact source investigation path above;
- credential references, never values;
- safe note content and private-evidence boundaries;
- expired sandboxes and unavailable source evidence;
- rotation/revocation of the local agent boundary; and
- stopping without an orphaned claim.

## Fresh-agent acceptance

Create two genuinely fresh sessions with no copied conversation summary:

```text
one Codex session
one Claude/Fable session
```

Each session independently:

1. discovers the shared skill from a plain request to triage production issues;
2. fetches the credential by reference without a value in prompt or output;
3. calls `/v1/ops`, lists issues, and replays one poll cursor with no duplicate;
4. claims an assigned controlled issue with its own run ID;
5. reads safe issue detail and follows the exact owning-source evidence;
6. identifies expected user/release and, for the E2B sample, exact sandbox;
7. on its own **distinct controlled sample initially in `tbd`**, sends exactly:

   ```text
   PATCH status: not_done
   note: F acceptance <run-id>: evidence path verified; no customer action
   ```

8. verifies the resulting `not_done` state and audit event; and
9. releases the claim.

Each agent covers one controlled Sentry issue, one controlled support issue,
and one controlled Grafana issue: six independent read investigations total.
Only the two separately assigned controlled samples are mutated. The
`tbd -> not_done` result is intentional evidence; do not attempt an invalid
agent transition back to `tbd`.

Separately prove on controlled canary issues:

- two agents racing to claim produce one winner and one conflict;
- exact dedup works and fuzzy similarity does not trigger a merge;
- a reviewed F1-authoritative PR link is durable and idempotent;
- missing token, wrong token, and missing `X-Run-Id` fail closed;
- release token fails on agent routes; and
- agent token fails on human Web routes.

The receipt contains session IDs, run IDs, issue IDs, source IDs,
commands/results, and redacted timestamps. It contains no credentials, private
support content, raw logs, or browser cookies.

## Rollout

1. Land and validate the Proliferate human runbook.
2. Install the single shared skill and Claude symlink.
3. Run read-only helper tests against controlled data.
4. Run the two fresh-session proofs.
5. Run controlled mutation/race/auth proofs.
6. Verify no customer issue changed and no claim remains held.
7. Accept the operating surface only when both agents complete without founder
   nudges, credential recovery, or hidden chat context.

## Rollback

- remove the Claude symlink and shared skill directory;
- revoke/rotate `issue-tracker/app.agentApiKey` if it may have been exposed;
- verify machine requests with the old key fail;
- release only the controlled claims created by the proof; and
- leave tracker code/data, provider evidence, and production ingestion
  unchanged.

## Non-goals

- any issue-tracker application, deployment, schema, or source-writer change;
- MCP parity or another issue client;
- autonomous mutation of arbitrary customer issues;
- fuzzy deduplication or guessed PR attribution;
- copying private evidence into tracker notes;
- storing credentials in prompts, Git, local ops files, or per-agent copies;
- adding tracker metadata columns for provider context; or
- replacing the founder's final review and prioritization judgment.
