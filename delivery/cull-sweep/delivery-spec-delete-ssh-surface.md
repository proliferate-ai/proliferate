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
