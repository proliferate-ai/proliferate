# Building

Doctrine: how we build. This page cites systems and owns no code — the
norms live in [testing](engineering/testing/README.md), the machine in
[ci-cd](engineering/ci-cd/README.md). Sections marked *(ruled 2026-08-26;
Pablo may reword)* carry his recorded rulings verbatim-in-substance,
awaiting his own phrasing.

## How we build here *(drafted from the 2026-08-26 rulings — Pablo's pen)*

Specs first: the spec is ground truth, and code that disagrees with it is
a bug in one of them — raised, never silently absorbed. Small honest PRs
that declare what they prove. Agents are first-class builders: every rule
on this page binds a fleet fork exactly as it binds a person. Red means
red — a masked failure is worse than a failure.

## 1 · The path of a change

**Shape → Build → Prove → Merge → Watch → Release.**

- **Shape** — anything that shapes how Pablo works or how the product
  looks gets a short written proposal he approves *before code exists*;
  culls and mechanical fixes stay fast. *(ruled 2026-08-25/26; Pablo may
  reword.)* Larger work freezes a delivery spec (one PR each) keyed to the
  owning spec's sections.
- **Build** — in your own worktree, never the shared checkout;
  [`make gate`](engineering/ci-cd/pipelines.md) before every push.
- **Prove** — the [PR pipeline](engineering/ci-cd/pipelines.md): the merge
  block entire, ≤10 min.
- **Merge** — the [merge train](engineering/ci-cd/README.md): serial,
  rebase-then-merge, regenerate-never-hand-merge.
- **Watch** — green main auto-deploys staging; the nightly battery writes
  the morning broken-list; alerts only when something is actually quite
  broken.
- **Release** — the worlds qualify one artifact base; a human promotes
  ([prod pipeline](engineering/ci-cd/pipelines.md)).

## 2 · Change buckets

Every PR declares one, against a spec: **bug** (code diverged → fix code)
· **spec gap** (spec silent → fill it) · **system change** (revise one
spec) · **seam change** (two specs move together — the only bucket that
deserves friction).

## 3 · The two commands

`make setup` once — installs the hooks (format-on-commit, gate-on-push).
`make gate` before every push — same commands as CI, same verdicts.

The hard rules, verbatim: **never `--no-verify` · never delete or weaken a
test to go green · baselines only shrink.**

## 4 · Tests: where they go

The [author's rule](engineering/testing/README.md): one system's law →
unit, next to that system · a seam → integration · a wire format → a
contract fixture · "does the product actually work" → a world. Nothing
restated here — the testing spec decides.

## 5 · Review

Every non-trivial PR gets a **completed** fresh-context refuter before
merge; an inline self-review is a fallback note, never a pass.
*(proposed — Pablo to confirm:)* Pablo personally reviews growth of the
lint constitution (`lints/` net-new entries — already CODEOWNERS-gated),
spec changes, seam changes, and anything under Shape. Everything else
merges on green + refuter.

## 6 · For agents specifically

Push WIP after every chunk · progress notes in the PR body · migration ids
minted and verified unique across in-flight branches · a conflicting PR
gets no CI — rebase first · the diagnostic names the fix command — run it
· when a spec and your task disagree, raise the contradiction; never
silently change scope.

---

[testing](engineering/testing/README.md) ·
[lints](engineering/testing/lints.md) ·
[release worlds](engineering/testing/release.md) ·
[ci-cd](engineering/ci-cd/README.md) ·
[pipelines](engineering/ci-cd/pipelines.md) ·
[design system](DESIGN_SYSTEM.md) · [the tree](README.md)
