# Same-Harness Model Switch — Root Cause + Fix Design

Status: design note for a recurring chat-view bug — **selecting a different model
from the same harness opens a new chat instead of switching the current session's
model in place.** Grounds the root cause in the actual code on both sides of the
ACP seam and proposes the fix.

Related: `specs/codebase/structures/anyharness/README.md` (session engine),
`specs/codebase/structures/frontend/architecture.md` (chat workflows).

---

## 1. Symptom

In the chat view, switching to another model **within the same harness** (e.g.
another Claude model while already in a Claude session) sometimes forks a brand-new
chat rather than re-pointing the running session at the new model. It is
**deterministic per harness**, not racy: harnesses whose running session doesn't
advertise the full model list hit it every time.

---

## 2. The principle (decided)

> Within one harness it is the **same** ACP provider process on the **same**
> connection; the model is a per-turn parameter. If the provider can run a model at
> all, it can switch to it mid-session. There is **no** "runnable but not
> switchable" capability split inside a single harness.

Therefore the only legitimate "new chat" is **no active session** (cold composer =
first launch, not a switch). Same harness + active session must **always** switch
in place.

---

## 3. Root cause

### 3a. The runtime advertises eagerly, but coverage is partial

`available_models` is populated **synchronously at session-create** from the
`new_session` / `load_session` / `fork_session` response — never in a later
notification — and the model control is built and emitted during startup, before
the session goes `Idle`:

- `live/sessions/driver/types.rs:21-94` — `NativeSessionStartupState::from_new_session`
  / `from_load_session` extract `available_models` from the ACP response.
- `domains/sessions/live_config/controls.rs:63-98` — `into_acp_model_control`:

  ```rust
  if current_model_id.is_none() && available_models.is_empty() {
      return None;                 // no provider models → NO control at all
  }
  ...
  settable: values.len() > 1,      // a single model → control exists but not settable
  ```

So there is **no empty-before-first-turn window** (an earlier hypothesis — now
ruled out). The control is fully populated at startup *if and only if* the provider
advertised its models. The catalog the UI shows is a **richer superset**, so any
harness that under-advertises in `new_session` ends up with catalog models that
have no matching live-control entry.

### 3b. The frontend gate is preemptive and derives entirely from the live control

`hooks/chat/workflows/use-chat-launch-actions.ts:67-85` — the in-place branch:

```ts
if (
  scopedActiveSessionId
  && scopedCurrentLaunchIdentity?.kind === selection.kind   // same harness
  && scopedCurrentModelConfigId                             // == modelControl.rawConfigId
  && (
    !scopedModelControl
    || scopedModelControl.values.some((v) => v.value === selection.modelId)
  )
) {
  void setActiveSessionConfigOption(scopedCurrentModelConfigId, selection.modelId) ...
  return;
}
// else → falls through to createEmptySessionWithResolvedConfig (NEW CHAT)
```

Both preconditions trace back to the live control:

- `scopedCurrentModelConfigId` **is** `modelControl.rawConfigId`
  (`hooks/chat/derived/use-active-session-config-state.ts`). No control built ⇒ no
  config id ⇒ the `&&` fails **before** the `values` check is even reached.
- `scopedModelControl.values` is the advertised set; a catalog-only model isn't in
  it.

Mirrored in `lib/domain/chat/models/model-selector-options.ts:224-244`
(`resolveModelSelectionActionKindForModel`): `!model.liveSwitchable` +
non-exact-match ⇒ `open_new_chat`, where `liveSwitchable` is true only for models
sourced from the active control.

**Net:** in-place switching is possible only when a *settable* live control exists
**and** the target is in its advertised `values`. For harnesses that under-advertise
(or advertise a single model), every other same-harness catalog model forks a new
chat. That is the bug — a **coverage gap conflated with a capability boundary**.

---

## 4. Why the fix is safe

A rejected `set_session_model` is **clean** — it cannot wedge the session:

- `live/sessions/actor/config/apply.rs:374-395` — `apply_model_via_direct_setter`
  awaits `conn.set_session_model(...)` and propagates any error as `anyhow::Result`.
- `apply.rs:167-179` — wrapped as `SetConfigOptionCommandError::Rejected(msg)`.
- `live/sessions/actor/event_loop.rs:127-154` — error is returned via
  `respond_to.send(Err(error))`; the actor stays `Idle`, the connection is intact.

The frontend already surfaces this: the in-place branch `.catch`es and toasts
`Failed to switch model: …`. So **attempting a switch has no downside** — success
switches in place, failure degrades cleanly. That removes the last reason to gate
preemptively.

---

## 5. The fix

**Make the same-harness path reactive, not preemptive.** Same harness + active
session ⇒ always attempt the in-place switch; only fork a new chat on *no active
session* or a *real runtime rejection*.

### Frontend

1. `use-chat-launch-actions.ts:67-85` — drop the live-control preconditions for the
   same-harness case. The decision becomes:

   ```
   no active session                         → new chat (first launch)
   active session, DIFFERENT harness         → new chat
   active session, SAME harness              → setActiveSessionConfigOption(modelConfigId, modelId)
       on success → stay (same chat)
       on rejection → surface toast (already wired); optionally offer "open in new chat"
   ```

   This needs a **stable model config id** that doesn't depend on the control being
   present. The runtime already uses a fixed compat id for the model control
   (`ACP_MODEL_COMPAT_CONFIG_ID`, `controls.rs:63-98`), so the frontend can target
   that id for same-harness model writes rather than reading it back off a control
   that may not exist.

2. `model-selector-options.ts:224-244` — for `activeSelection.kind === agentKind`,
   return `update_current_chat` for any non-exact match **regardless of
   `liveSwitchable`**. Keep `open_new_chat` only for the cross-harness case
   (`activeSelection.kind !== agentKind`). `liveSwitchable` can still drive *UI
   hints* (e.g. a label), but must no longer gate session creation.

### Open item to verify before implementing

Does the runtime accept a `set_session_model` on the compat config id when the
provider **did not advertise** that model — i.e. does
`should_apply_model_via_direct_setter` (`apply.rs`) permit the write, letting the
provider be the authority? If that guard itself filters on the advertised set, it
must be relaxed too so the provider (not our projection) is the one that
accepts/rejects. This is the single dependency that decides whether the frontend
change is sufficient on its own.

---

## 6. Scope / non-goals

- **Cross-harness** switches still create a new session — unchanged and correct (a
  different provider process genuinely requires a new ACP session).
- **`available_models` coverage**: improving which harnesses advertise their full
  list is a *nice-to-have for UI labeling*, not a prerequisite — the reactive fix
  works without it.
- **Subagents ("aux")**: a separate concern; model selection must never route into
  `create_subagent` (`domains/sessions/subagents/mcp/calls.rs`). If an "aux" ever
  appears on a model switch, that is a distinct wiring bug, out of scope here.

---

## 7. Test plan

- Same harness, model present in live control → switches in place (regression).
- Same harness, model **absent** from live control (under-advertising harness) →
  switches in place (the fix).
- Same harness, single-model live control (`settable == false`) → switches in place.
- Provider rejects the switch → toast shown, session stays healthy, **no** new chat.
- Different harness → new chat (unchanged).
- No active session → new chat / first launch (unchanged).
