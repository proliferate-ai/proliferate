# Delivery Spec · Track D · `delete-ssh-surface`

Status: frozen delivery specification
Program: cull-sweep
Approved: founder approval 2026-08-25 (all cull-sweep tracks)
Evidence: cull-sweep investigation notes (live-reachability verification; zero
ssh-named Rust in runtime crates verified)

Shared rules for all cull-sweep tracks: own worktree + branch, moves never mix
with behavior changes, narrowest proof that establishes the delta, docs updated
in the same PR, commit trailers per repo convention.

Merge order: E and G anytime · A → B → C → F → D, mechanical rebase after each
(SDK regen, alembic head bump).

---

**Intent:** Delete the SSH product surface; runtime target-agnosticism
unchanged (zero ssh-named Rust — verified).

**Scope:** `install/proliferate-target-install.sh`,
`install/proliferate-git-credential-helper`,
`scripts/cloud-ssh-worker-smoke.py` (598), Makefile targets (≈:1485/:1500),
`CloudTargetKind.ssh` **last** (after UI branches), HomeTargetPicker ssh
branches + `use-home-target-agent-launch-options` ssh paths + sidebar ssh
variant icons (careful surgery — golden-path launch flow; local + cloud
behavior pinned by existing tests), supervisor/worker/TESTING doc rows,
env-vars.yaml.

**Acceptance:** home launch flow tests green for local + cloud; no `ssh`
product references in client; runtime crates untouched
(`git diff --stat anyharness/` empty).

---

## Amendments (founder re-rulings, 2026-08-25)

1. **`install/proliferate-git-credential-helper` is KEPT.** Evidence during
   execution showed it is SANDBOX github-auth surface, not SSH surface: the
   managed-cloud template build bakes it into the sandbox image
   (`tests/release/src/worlds/managed-cloud/template.ts`), materialization
   points git at it (`server/.../cloud/materialization/materialize/paths.py`),
   and `specs/FEATURE_DOCS/SANDBOX/github-auth.md` owns its credential flow.
   Only `install/proliferate-target-install.sh` (SSH onboarding only, per
   `install/README.md`) is deleted; `install/README.md` is rewritten around
   the helper. Ruled by the coordinating session on execution-time evidence.
2. **Two scope mentions were stale at execution time**: `env-vars.yaml`
   contains no SSH rows, and `use-home-target-agent-launch-options.ts`
   contains no SSH paths (the SSH launch state lived in
   `use-home-next-state.ts` / `use-home-next-target-selection-state.ts`,
   which were cut instead). No behavior delta.
3. **Desktop tunnel machinery ruled in scope**: `DesktopSshBridge`, the
   tauri `ssh_tunnel` commands, and the `ssh` threading through the
   session/workspace connection stack are the SSH target's transport;
   consumer-graph proof (recorded in the PR description) shows the ssh
   target-kind paths were their only callers. `apps/desktop/src-tauri` is
   client-native Rust, not a runtime crate — the acceptance line
   "`git diff --stat anyharness/` empty" is unaffected and holds.
4. **Unconsumed config settings deleted with the installer**:
   `proliferate_target_installer_url` / `proliferate_target_artifact_base_url`
   had zero consumers.
