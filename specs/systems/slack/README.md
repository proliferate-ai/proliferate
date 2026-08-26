# Slack (product app)

Status: target. Grade C skeleton: this system does not exist on `main`. The
body describes the accepted destination (Core Architecture §6–§7 and the
Slack employee design); [Current gaps](#current-gaps) is the whole build list.

The product Slack app is **a trigger source plus a client — never an
engine**. It is one of the two Slack relationships and must never be conflated
with the other:

| | Product Slack app (this spec) | Slack as an agent tool |
| --- | --- | --- |
| Role | Trigger + client: a thread *is* a view of a session | A company system an agent acts on |
| Credential | Product-owned bot token, held at the control plane | Gateway-held connection, never in the environment |
| Who speaks | The **server**, relaying session events | The **agent**, via the gateway, audited per call |
| Owner | here | [integration_gateway.md](../integration_gateway/README.md) |

## 1. Purpose

`@proliferate fix this` in a thread creates a session before any compute
exists, the thread receives turn-level progress and the final run result,
replies in the thread become prompts, and approvals render as buttons — with
zero Slack-specific machinery in the runtime, the courier, or the gateways.
Slack is the proof case that the seams were drawn right: it lands as a
webhook handler, a bindings table, and message formatting.

## 2. Owned state

| Table (destination) | Row meaning |
| --- | --- |
| `slack_workspace_install` | One Slack workspace ↔ one organization; bot token ciphertext, signing secret reference, install status. |
| `slack_user_link` | Slack user id ↔ Proliferate user (else runs execute under the org's service subject and the ack offers linking). |
| `slack_event_receipt` | Dedup on Slack event id (Slack redelivers aggressively). |

The **external binding** `{kind: "slack", team_id, channel_id, thread_ts}`
is **not** owned here: it is a row on the session registry (sessions spec) so
the same primitive later serves Linear comments, GitHub issue threads, and
email. This system writes bindings only through the sessions public surface.

## 3. Public surface

- `POST /v1/slack/events` — Slack Events API intake (URL verification,
  `app_mention`, thread `message` replies), signature-verified.
- `POST /v1/slack/interactions` — Block Kit interaction intake (approve /
  deny / link account).
- Install flow: `GET /v1/slack/install/start` (org-admin) and
  `GET /v1/slack/install/callback`.
- Outbound: the server posts acks, progress, approvals and results into
  bound threads through the vendor leaf
  [integrations/slack/client.py](../../../server/proliferate/integrations/slack/client.py)
  (`chat_post_message`, `auth_test`, `exchange_oauth_code` already exist
  there, currently unused).

## 4. Consumes

- sessions: create registry row + external binding + queued prompt;
  resolve binding → session for replies.
- automations / runs: freeze an invocation from the mention; run result on
  completion.
- integration_gateway: approvals (the approval verb, attributed approver).
- accounts / organizations: user linking, org service subject.
- Settings: `slack_client_id`, `slack_client_secret`,
  `slack_signing_secret`, `slack_oauth_redirect_url`, and the outbound rate
  / attempt knobs already declared in
  [config.py](../../../server/proliferate/config.py) (dead on `main`, see gaps).

## 5. Laws

**Session before compute.** The registry row, binding and queued prompt are
created and the ack posted *before* any environment exists; the environment
catches up via the courier. Closes: a thread waiting on materialization.

**The server is a client writer, never the log.** Replies append prompts
through the courier attributed to the linked user; the server never writes
into the runtime's event log directly. Closes: a second event authority.

**Ship policy is structural.** Thread posts are driven by the ship-now event
class (message completed, status transitions, run result, milestones); the
runtime never knows a Slack thread is watching. Fan-out by binding happens at
the control plane. Closes: consumer-aware runtimes.

**Approvals never ride the event pipe.** Buttons work when the event path is
degraded because approvals are born at the control plane. Closes: a stuck
approval during a shipping outage.

**Every inbound event is idempotent on Slack's event id.** Closes: duplicate
sessions from redelivery.

**A dead environment is an honest post.** Missed worker heartbeat → run
failed → "lost contact" in the thread, never silence.

## 6. Emits

Thread posts (ack + session link, progress, approval buttons, final summary
with PR link and evidence) — the destination's only output surface.

## 7. Fences

- The binding primitive, registry row, queued prompts: sessions.
- Trigger → invocation freeze and dedup: automations.
- Event shipping and heartbeat-driven failure: the seam.
- Slack-as-tool, scope ceilings, tool policy: [integration_gateway.md](../integration_gateway/README.md).
- Internal notification webhooks (support/signup/billing posts to
  Proliferate's own Slack via
  [notifications.py](../../../server/proliferate/server/notifications.py)) are
  *not* the product app; they use incoming-webhook URLs and stay with their
  owners.

## 8. Code map

Destination (nothing exists yet except the vendor leaf):

```text
server/proliferate/
├── integrations/slack/                 vendor leaf — client.py (oauth exchange, auth.test, chat.postMessage,
│                                       conversations.list), messages.py (mrkdwn blocks), webhooks.py (incoming-webhook post)
└── server/slack/                       ※ new: MANIFEST · api.py (events, interactions, install) · service.py
                                        (mention → invocation, reply → prompt, binding fan-out) · rendering.py (Block Kit)
db/models/slack.py · db/store/slack/    ※ new
```

## 9. Proof

Destination: event-id dedup, signature rejection, mention → session row
before compute (no environment call), reply → courier prompt attributed to
the linked user, approval click → approval verb, result → final post — all
with a mocked Slack API; no live workspace in tests.

## Current gaps

- [ ] Everything in the code map marked ※ new.
- [ ] `external_bindings` on the session registry (sessions spec).
- [ ] Ship-now push from the worker and binding fan-out at ingest (seam).
- [ ] The seven `slack_*` settings in `config.py` and the OAuth/chat
      functions in `integrations/slack/client.py` have zero consumers on
      `main` (residue of the deleted gen-1 workflow lane); reuse or delete
      when this system lands.
- > [!decision] PABLO DECIDES: unlinked Slack users — run under the org's
  > service subject with a link offer in the ack (recommended; a mention
  > from an unknown teammate still works), or refuse until linked.
- > [!decision] PABLO DECIDES: one Slack app for both relationships
  > (product app scopes + the read/search scopes the gateway needs) or two
  > apps. Recommendation: two — the gateway's exact scope ceiling and the
  > distribution-qualification gate (PR0) should not be entangled with the
  > product app's `chat:write` + events scopes.
