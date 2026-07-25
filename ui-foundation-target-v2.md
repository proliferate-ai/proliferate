# UI Foundation Target — v2 (redo alignment)

Status: DRAFT for Pablo's review. Nothing implements until this is blessed.
Supersedes PR #1484 (`ui-foundation-pass`), which closes as superseded when the redo PR opens.
Base: fresh branch off `ls-remote`-verified `origin/main` (post-#1485). #1484 commits are prior art to mine — never cherry-picked.

## 1. What carries over unchanged (the bulk)

Everything in `ui-foundation-target.md` (v1) and the frozen `retune-spec.md` §8 stands unless amended in §2–§4 below. Specifically re-affirmed:

- **Token authority architecture**: `packages/design/src/tokens.ts` (+ `motion.ts`) as single source; `generate-theme.mjs` emits `dist/theme.css` (@theme block, dark/light roots, z/duration/ease/icon utilities); `check-theme.mjs` re-projects and asserts byte-equality; `product.css`/`dom.css` keep rules only, never token values; Shiki + Monaco palettes generate from the same source (Monaco's warm `#1A1715` world stays dead); RN bridge derives from the same inputs.
- **All 45 enumerated retunes** ([TYPE-01..12], [TY-XS..XL], [ICON-01..04], [STATE-01..04], [RAD-01..07], [SPACE-01], [SHADOW-01..04], [MOTION-01..06], [LAYER-01], [ROW-ACTION-01]) — full list + census in `retune-spec.md` §8 (readable at `origin/ui-foundation-pass:.foundation-scout/retune-spec.md`).
- **The closed ramp**: 11/15 +0.01em · 12/17 +0.005em · 13/20 0 · 14/21 −0.005em · 16/23 −0.01em · 19/24 −0.025em · 26/34 −0.025em; control weight 450; generic `text-xs/sm/base/lg/xl` deleted (756 census sites migrate); Geist as swappable `--font-sans` (RULED 2026-07-24).
- **Gates land WITH the base**, in the CI-wired `scripts/check_appearance_scaling.py` + its unit tests: arbitrary text/radius/z/gap/size bans, old-shadow + old-accent + foreground-alpha bans, numeric-duration ban, raw-hex ban, **backdrop-filter ban** (composer-only ownership), **unvirtualized-long-list ban** (shrink-only baseline JSON). The two poison-pattern bans are phase-5's early carve-out and ship here.
- **Pre-commit hook (RULED Pablo 2026-07-25)**: local drift protection in addition to CI. The repo has no hook framework — ship a checked-in `scripts/git-hooks/pre-commit` (no new dependency) running the appearance-scaling check on staged frontend files plus the theme byte-equality check when `packages/design` files are staged; wired via `git config core.hooksPath scripts/git-hooks` from the standard dev-setup entrypoint so every clone/worktree gets it. Fast (<2s staged-only), bypassable only with `--no-verify` (CI still catches).
- **Post-landing tweakability is a design goal**: because every value flows from `tokens.ts`, tuning any font/icon/motion/color value later is a one-file edit + regenerate — the checkpoint blesses the system, not eternal values.
- Migration mechanics: manual per-file against the census matrix (no blind codemod), `ui-foundation-escalation:` tag convention for ambiguous mappings, zero tags remaining at completion.

## 2. Ruling delta — R-V2-1: Codex-first reference precedence (NEW)

Pablo, 2026-07-25: Codex UI is preferred in general; Conductor is authority only where the product's shape matches Conductor and not Codex.

Operationalized:
- **Codex is the default authority** for every Codex-analogous surface: chat input/composer, transcript/messages, buttons and icon controls, popovers/menus, settings, file tree, panels/toolbars, empty states. Where v1 cited both references, the Codex value wins unless this doc says otherwise.
- **Conductor is the authority for product shapes Codex doesn't have**: the multi-tab chat strip (WE KEEP multiple chat tabs; align tab anatomy/motion with `reference/conductor/components/center-tab-strip/` + `center-session-tab/`), and any other multi-session sidebar/workspace structures without a Codex analogue.
- Tie-break: Codex wins on style (color roles, type, radii, shadows, motion feel); Conductor wins only on structure Codex lacks.
- Every adopted value cites its capture evidence path (same discipline as v1). Note: #1484 already chose Codex numbers at its decision points (13/20 chat, 16px-glyph/28px-box row actions, Codex-soft radii) — v2 makes that law rather than case-by-case.

## 3. New retune family — [CHAT-01..05]: composer/chat-input Codex alignment (NEW work vs #1484)

#1484 only *mechanically de-hardcoded* the composer (literal → semantic token swaps, no design change). Pablo wants the chat input to actually lean Codex. Evidence base: `reference/codex/components/input-composer/{computed.json,dom.html,states.png}`, `reference/codex/tokens.md`, `reference/codex/pages/thread/`.

- **[CHAT-01] Composer frame**: surface/border/shadow/radius aligned to Codex's input anatomy — input surface as translucent mix over primary (Codex: `rgba(45,45,45,.96)`-class role, standard white-8% border, subtle 1px/2px elevation per [SHADOW-01], 12px radius per [RAD-04]). Exact frame values extracted verbatim from `input-composer/computed.json` at implementation start into a short addendum table (same format as §8 of the retune spec).
- **[CHAT-02] Control row anatomy**: 28×28px icon-only controls, 16px glyphs, 4px-base spacing with 8px standard inline gap, translucent hover 7.8%/active 5.2% (all already legal vocabulary — this retune applies them to the composer's actual control row and send-button anatomy).
- **[CHAT-03] Placeholder/tertiary text**: placeholder + helper text on the tertiary role (Codex: white ~49.8%), not ad-hoc alpha mixes.
- **[CHAT-04] Transcript rhythm**: message block spacing/readable-width vs `pages/thread/` (Codex: 40rem readable Markdown max, 64rem wide) — adopt or consciously deviate, cited either way.
- **[CHAT-05] Chat tab strip** (Conductor carve-out per R-V2-1): multi-tab anatomy from the Conductor captures; 6px tab radius per [RAD-07] stands.

The addendum table with pinned px values is produced as the FIRST implementation artifact and included in the founder checkpoint — flagged if anything conflicts with a v1 retune.

## 4. Clean-redo laws (lessons encoded from #1484's failure commits)

1. **Validate generated CSS through a real engine from commit one**: `check-theme.mjs` includes the Tailwind `compile()` pass and the `dom.css` import-order assertion from the start (in #1484 these were retrofits after a syntactically-broken `--shadow-modal` shipped undetected and 500'd the JIT stylesheet).
2. **Gate regexes at full strength from commit one**: `FOREGROUND_ALPHA_RE` catches static (not just interaction-prefixed) bracket-alpha fills; shadow ban includes `keystone` — both were detection gaps that let 7 violations survive #1484's first pass.
3. **Adversarial review is a planned stage, not a favor**: an independent review agent sweeps the census after migration (it caught the 7 gaps last time); its findings must reach zero before the founder checkpoint.
4. **Known collision points, handled explicitly**: `RepoActionsPane.tsx` and `RepoPicker.tsx` changed on main via #1485 (className literals in retune-relevant lines) — their retunes are re-derived against the new content, not pattern-copied from #1484's diff. These are the ONLY two drifted files out of #1484's 473-file footprint.
5. **Rendered visual verification is in-scope** (deferred in #1484): served build inspected before the checkpoint, per-surface against the reference contact sheets.
6. **No exception without a sanction trail**: every new entry a baseline file would need (long-list, z-index, any ban exemption) requires a written sanction in the component catalog / spec — baselines otherwise only shrink.

## 5. Implementation plan (aligned 2026-07-25)

Engine: **dynamic workflows first** (probe verified stable today; `opus` pin currently resolves to Opus 4.8 and auto-upgrades when the alias flips to Opus 5). Fallback: same brief handed to a Codex desktop thread + append-only comms file if workflow instability recurs — engine swap, no redesign.

1. **Workflow 1 — token authority core** (opus + adversarial verifier, serial): tokens.ts/motion.ts, generators, check-theme with §4 laws, gate extensions, all in one coherent unit.
2. **Workflow 2 — consumer migration waves** (sonnet, pipeline): census partitioned into file-disjoint sets by package/surface; one agent per partition; scoped gates per partition, full-gate barrier only at the end.
3. **Workflow 3 — enumerated retunes + [CHAT-*]** (sonnet mechanical / opus for composer + judgment retunes).
4. **Inline (Fable)**: brief authorship, mid-run answers, independent gate run, serialized dist builds, served build → **FOUNDER CHECKPOINT** (whole-app review on the new base; temporarily-worse surfaces anticipated) → PR → Pablo merges.

Machine limits bind every agent: no cargo/rustc, no Docker, builds serialized.

## 6. Rulings (Pablo, 2026-07-25 — doc blessed, implementation authorized)

- **D-V2-1 RULED**: R-V2-1 Codex-first precedence approved as stated in §2.
- **D-V2-2 RULED**: [CHAT-*] values pinned via implementation-start addendum; the table goes to Pablo the moment Workflow 1 produces it (mid-flight ping), reviewed again at checkpoint.
- **D-V2-3 RULED**: #1484 closes when the redo PR opens.
- **R-V2-2 (new)**: pre-commit drift hook ships with the base (§1); token system is explicitly tweak-after-landing (§1).
- **D-V2-4 RULED (2026-07-25)**: [CHAT-*] addendum reviewed mid-flight; all seven flagged calls resolved per the addendum's recommended defaults (see the RULED block in `ui-foundation-chat-addendum.md`): composer radius 12px, composer control gaps 8px (amends [SPACE-01]'s composer sites), press overlay 5.2%, NEW 40rem/64rem transcript max-width tokens, NEW 12px transcript-turn-gap token, tab strip 28px, underline-tab redesign out of scope, tab close button → 20px `--size-icon-button-sm`.
