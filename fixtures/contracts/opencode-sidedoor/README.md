# OpenCode side-door HTTP contract (pinned ground truth)

Pinned for the OpenCode targeted-fork HTTP side-door bridge: the shapes
our `OpencodeSidedoorClient` sends/parses against the vendor `opencode acp`
HTTP server.

## Provenance

| Field | Value |
| --- | --- |
| Vendor | `opencode` (agent kind `opencode` in `catalogs/agents/catalog.json`) |
| Vendor tag | `v1.18.3` |
| Vendor commit | `127bdb30784d508cc556c71a0f32b508a3061517` |
| Verification date | 2026-08-17 |
| Method | Source read of the vendor repo at the pinned tag (`Session.fork`, the `acp` HTTP server bootstrap, and the auth middleware) |

## Files

- `fork-request.json` — body shape for `POST /session/{id}/fork`.
- `auth-header-example.json` — Basic-auth header shape with a FAKE password
  (`OPENCODE_SERVER_PASSWORD`, username defaults to `opencode`).
- `message-list-response.json` — representative `GET /session/{id}/message`
  response (ascending array of `{info, parts}`).
- `qualification-registry-entry.json` — shape of one row in
  `catalogs/agents/qualifications/targeted-fork-sidedoor.json`.

## Vendor hazard (why pre-validation is mandatory)

`Session.fork` walks messages ascending and stops at the first
`msg.info.id >= messageID` -- a raw string comparison with **no existence
check**. An unrecognized id sorting after every real id silently full-copies
the session; one sorting before all real ids silently produces a near-empty
fork. Fork excludes the target message (exclusive boundary). Our client never
dispatches a `messageID` that has not been round-tripped through
`GET /session/{id}/message/{messageID}` (id + role match) AND confirmed
present in `GET /session/{id}/message` (exact membership).
