# Desktop QA checklist — agents/auth re-cut (founder-driven, ~15 min)

Runbook §6. Everything server-side that could be proven without the desktop app
is already green (see LIVE-VALIDATION-RESULTS.md); these seven are the ones that
need a human looking at the UI.

**Setup.** Boot the desktop app against a dev profile with the gateway enabled.
Do NOT build the Rust runtime for this — boot with the shared prebuilt binary:

```
SKIP_RUST=1 ANYHARNESS_DEV_RUNTIME_BIN=~/.proliferate-local/dev/runtime-bin/anyharness \
  make dev PROFILE=<name>
```

Note: the prebuilt binary on disk is dated Jul 4 and predates this re-cut. If a
check below depends on new runtime behavior (2, 3, 5, 6 all do), it needs a
runtime built from a tree containing `15098c21a` — see the "runtime binary"
blocker in the results doc. Items 1, 4, 7 exercise mostly server/web behavior.

For each item, write PASS / FAIL / SKIP and paste what you saw.

---

### 1. Auth switch shows "Applying…" then applied, and the model list refreshes

Settings → Agents → claude → local auth. Switch from **gateway** to an
**api_key** entry.

- [ ] The pane shows an "Applying…" (pending) state, then resolves to applied
- [ ] The model list refreshes after it applies (the auth-apply probe event)

Verdict: `____`  Notes:

---

### 2. Restart-running-sessions modal — exact copy, same session preserved

Start a claude session and leave it running. Now switch that harness's local
auth.

- [ ] A modal appears with EXACTLY this copy:
      - title: **"Restart running sessions on old auth?"**
      - confirm: **"yes, restart now"**
      - decline: **"no"**
- [ ] It lists ONLY that harness + surface's running sessions (nothing else)
- [ ] Choosing **yes** relaunches in place: the SAME session, transcript preserved
- [ ] Choosing **no** does nothing — no badge, no error
- [ ] After declining, switching again RE-OFFERS the modal

Verdict: `____`  Notes:

---

### 3. All-Models: one composed observation, and refresh failure keeps last-good

Settings → Agents → any harness → All Models.

- [ ] Exactly ONE composed observation (not a per-slot list)
- [ ] A "refreshed N min ago" line
- [ ] A provenance line (binary + install identity), visually muted
- [ ] Now revoke the credential and hit **Refresh**: the last-good list STAYS,
      and a "last refresh failed" badge appears
- [ ] The picker is NEVER empty

Verdict: `____`  Notes:

---

### 4. opencode with gateway + provider api_key = honest union

Enable BOTH a gateway source and a provider api_key for opencode.

- [ ] The model list is the union of both (not one replacing the other)
- [ ] Provider is carried per model

Verdict: `____`  Notes:

---

### 5. Unsupported saved model → one typed refusal, no "gated" language

Pick a model, then switch auth so that model is no longer in the active
universe. Launch.

- [ ] A SINGLE typed refusal that names the active universe
- [ ] The word "gated" appears NOWHERE in the message

Verdict: `____`  Notes:

---

### 6. cursor: no gateway option, api_key works, probe is manual-only

- [ ] cursor offers NO gateway option (it is deliberately not gateway-capable)
- [ ] The api_key slot works
- [ ] The probe only runs on manual refresh

Verdict: `____`  Notes:

---

### 7. Fresh-signup onboarding card

Fresh signup on a healthy stack.

- [ ] The "Setting up your agents…" card appears and resolves within ~20s

Then point `AGENT_GATEWAY_LITELLM_BASE_URL` at a dead port, restart the server,
and sign up again:

- [ ] Signup STILL completes
- [ ] The card auto-advances at the grace window (~20s) instead of hanging
- [ ] Harness panes show the ordinary pending state
- [ ] NO error surface anywhere

Note: the server half of this is already proven live — with LiteLLM unreachable,
signup completed in 102 ms, the enrollment row went `sync_status=failed` without
raising, `/capabilities` returned `enrollmentStatus: "failed"` at HTTP 200, and
the state doc rendered `{"harness_kind":"claude","sources":[]}` (fails closed,
`applied: false`). What is left here is purely whether the CARD behaves.

Verdict: `____`  Notes:

---

## If something fails

File it as a comment on the owning PR so the corridor context attaches, not as a
new issue: **#1551** billing, **#1552** catalog/observation, **#1553** delivery,
**#1558** typed keys.

Do not fix the typed-config UI submit handler in `HarnessAuthApiKeyDetails.tsx`
if you notice it discards input — that is a known placeholder owned by #1554
step 3, and the server side behind it is already proven working.
