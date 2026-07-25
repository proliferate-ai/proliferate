Foundation target for charter step b). Derived from reference/codex (26.721.31836) + reference/conductor (0.75.0) evidence and the audit of our current system. Values cite their evidence; items marked DECIDE need Pablo's call before implementation.

Ground truth about our current state (from the audit — why b) is needed):
- tokens.ts looks like the source of truth but is dead for DOM: product.css's hand-authored @theme overrides it in the cascade. 12+ same-named tokens disagree (popover #242424 vs #2d2d2d, ring 0.56 vs 0.28, --radius-composer 0.5rem vs 1rem, all four shadows...). Only --text-* is drift-tested.
- Two parallel type scales in active use: remapped generic Tailwind (text-xs=7.5px?! 326 uses; text-sm=9px, 341 uses) alongside the semantic roles (text-ui etc., 1093 uses).
- No motion token layer: ~30 durations + 6 easing curves inline (one curve in two spellings), 7 JS *_MS constants hand-mirroring CSS keyframes.
- Three independent code-color worlds: Shiki palette, Monaco palette (a stray WARM #1A1715 world), app diff/terminal tokens.
- No z-index scale (one-offs up to z-[2147483647]); 33 raw rounded-[..] literals; ~230 raw width/height literals. Icons are the one bright spot: em-based semantic tiers already enforced (759 uses).

1) Architecture: one authority, generated outward
    1) Single source of truth in packages/design (TS token modules). It GENERATES: the CSS @theme (colors, radii, shadows, type, motion), the React Native bridge, and the Shiki + Monaco base palettes. product.css keeps only rules, never token values.
    2) The @theme-literal → :root color-mix() re-declaration pattern stays (Tailwind constraint) but both halves generate from the same source.
    3) Drift tests extend from --text-* only to colors, radii, shadows, motion, and the JS motion constants.
    4) Kill the dead tokens: overlay-strong, *-subtle (0 references), duplicate .chat-composer-surface and --color-composer-* blocks.

2) Type: one closed ramp, semantic roles only
    1) Closed body ramp (authored px, paired line-height AND letter-spacing per step, Conductor's discipline; sizes anchored where Codex and Conductor converge):
        - 11/15 +0.01em  → meta/labels (text-ui-sm)
        - 12/17 +0.005em → compact UI, sidebar (text-ui)
        - 13/20 0        → chat, message, composer (Codex renders chat exactly 13/20)
        - 14/21 −0.005em → body emphasis, workspace title
        - Titles: 16/23, 19/24; hero 26/34. Nothing else is legal.
    2) One characteristic control weight: 450 (Codex uses 445, Conductor 450 — both live on a variable-font medium-light axis; 450 is Geist-native).
    3) The remapped generic Tailwind steps (text-xs/sm/base/lg/xl) are DELETED; all 734 uses migrate to semantic roles. The runtime appearance ladder keeps working — it rewrites the same, now-single vocabulary.
    4) RULED (Pablo 2026-07-24) — UI font: Geist, architected as swappable: all type references one --font-sans token so testing alternatives (system stack etc.) is a one-line change. We already ship Geist Mono; this unifies UI+code.

3) Icons: keep our tier system, tune the values
    1) The em-based semantic tiers (icon-paired/compact/control/status/large/display) stay — structurally ahead of both references, already CI-enforced.
    2) Tune targets: 16px default glyph box paired with 13px text (Codex), 12px glyph for compact/meta rows (Conductor's dominant size), icon-only controls get a 28px hit target (Codex).
    3) Close the gap the guard misses: the CONTAINER (tap target) sizes join the system — legal boxes 20/24/28px, no more freehand size-N on icon buttons.
    4) New sanctioned primitive: row-action icon-button (hover-revealed controls on rows — sidebar kebab, archive, tab close, file-row actions). Proper glyph size + hit-target box + hover fill, per Codex (16px glyph / 28px box / translucent hover) and Conductor (20px box, hover:bg-accent, group-hover reveal). Motivating specimen: the sidebar kebab (WorkspaceItemMenu.tsx:111) is today a bare 13px glyph at opacity-50 with no box and no hover treatment — Pablo flagged it 2026-07-24. Fix lands as the primitive, not a one-off.

4) Spacing and sizing
    1) 4px base (all three systems agree). Legal gaps 4/6/8/12/16; legal block padding 12/16; major gutters 20/28.
    2) Row heights: compact row 28px (Codex rows AND buttons; our current h-7 sweet spot), dense tree row 28px, roomy list row 36px. Chrome bars 40px (Conductor's two-tier 40px reads cleaner than Codex's 46px and matches our current header weight).
    3) Width sprawl (93 raw w-[..] literals) collapses to a small width scale for panels/popovers/dialogs; content-geometry constraints (file viewer etc.) are exempt but must be named vars.
    4) RULED (Pablo 2026-07-24) — transcript measure: decide by screenshots, not numbers. Slice-2 checkpoint material includes a comparison sheet of our transcript rendered at current/640/768/896px side by side with the Codex + Conductor captures.

5) Color: cool-neutral, one palette
    1) Character: cool neutral mono-dark (Codex #141414/#181818 family). This is already our brand and your stated bar; Conductor's warm #141110 world is noted and rejected. The stray warm Monaco palette (#1A1715/#D4A574) is retired — Monaco + Shiki generate from the app palette.
    2) State model: translucent-white overlays for hover/active/selected (Codex: 0.078/0.052/0.032, border 0.084) instead of our current mix of opaque one-offs.
    3) Semantic roles fixed at: base, underlay, sidebar, card, control, elevated/popover, hover, selected, border, border-heavy, focus-ring, muted-fg, faint-fg, destructive, warning, success, plus diff/git/terminal families. Every drift-list conflict resolves to ONE value at migration time (each resolution listed in the PR).
    4) Elevation: near-flat, border-led (both references agree). Shadows only on floating layers: popover 0 4px 12px, modal 0 25px 50px −12px (Conductor's measured values), subtle 0 1px 2px for the composer card.

6) Radii
    1) RULED (Pablo 2026-07-24) — direction agreed: Codex-soft scale (rows 6px, buttons/controls 8px, popovers/cards 10px, composer 12px, modals 16px, pill=full), but final values confirmed by eye: slice-2 checkpoint material includes the scale rendered on real controls (button, row, popover, composer, modal) vs the 12.5px-chip and 4px-square alternatives.
    2) The 33 raw rounded-[..] literals (5px, 10px, 26px...) migrate to the scale; rounded-[5px] dies.

7) Motion: a real token layer
    1) Durations by role (both references author 150ms default): hover/color 120ms, enter 160ms, exit 120ms, disclosure/collapse 200ms, panel/sidebar slide 240ms, emphasized/spring 300ms. Activity loops (spinners, thinking, snake) are a separate family and never share tokens with interaction motion.
    2) Easing tokens: --ease-out-quint cubic-bezier(0.19,1,0.22,1) for enters (already our --cubic-enter), --ease-spring cubic-bezier(0.16,1,0.3,1) for emphasized (Codex rolling digits, Conductor spring), --ease-standard cubic-bezier(0.4,0,0.2,1), plus linear for loops. The duplicate-spelling curve (0.23,1,.32,1) folds into one name.
    3) The 7 JS *_MS constants import from one shared motion module — no more hand-mirroring.
    4) prefers-reduced-motion handled at the token layer (loops keep, transitions drop to 0).
    5) Honest caveat: both references' motion evidence is authored-intent only (Conductor has zero recordings; Codex one coarse clip). Values above are safe defaults; the specific sidebar/collapse/streaming recipes get verified against recordings during d), not frozen now.

8) Layering: z-index scale
    1) Tokens: base 0, raised 10, sticky 20, overlay 40, popover 50, toast 60, tooltip 70, top 80. All z-[..] one-offs (incl. z-[2147483647]) migrate; lint bans arbitrary z.

9) Enforcement landing WITH this slice (charter 1.4/2.2)
    1) Extend check_appearance_scaling.py-style gates: raw hex outside design (allowlist: brand SVGs, generated code palettes), rounded-[..]/gap-[..]/size-[..] literals, inline cubic-bezier and ms-literals outside design, arbitrary z-[..], generic text-xs/sm/base once migration lands.
    2) Drift tests per 1.3.
    3) Poison-pattern bans from charter e) land here too: backdrop-filter allowlist, unvirtualized-list check.

Operating principle (re-ruled 2026-07-24, supersedes value-preserving): UNIFY AND FIX IN ONE PASS, WITH RETUNES ENUMERATED. The unification slice both collapses the authorities into one token table AND applies the new target values. Safety comes from enumeration, not sequencing: the PR ships an explicit changelog of every deliberate value change (each with before/after proof), and everything NOT on that list is verified unchanged (screenshot/computed-style comparison). Any visual shift not on the list is a bug by definition. Authority conflicts with no retune ruling still resolve to the currently-rendering value.

Implementation slices (each pushed + visually proven, none merged without Pablo; founder checkpoint after slice 1):
    1) THE FOUNDATION PASS: token authority + generation + drift tests + enforcement gates, PLUS the new ramps/roles applied — type retunes (e.g. chat 11px → 13/20 per Codex), Geist as --font-sans default, translucent-white state model, radii scale, motion tokens, z-scale, generic-Tailwind-step migration, row-action icon-button primitive (kebab fix). Ships with the enumerated-retunes changelog. → FOUNDER CHECKPOINT, expect some surfaces temporarily worse. Checkpoint material includes the transcript-measure sheet and radius-on-real-controls sheet per the rulings above, plus a specimen sweep of undersized hit targets / wrong icon-text pairings across main surfaces.
    2) Icon container sizes + width scale + remaining literal migrations + anything the checkpoint kicks back.
    Rendered proof at same viewport per change; before/after under reference/proliferate/.

Evidence gaps accepted for now (do not block): Conductor per-component computed.json deferred (values are Tailwind-class-derived, cross-checked against the 668-element computed baseline); all motion recordings; conductor/components/file-tree-row/dom.html is mis-saved (contains a tab fragment, not a tree row) — recapture lazily if a d)-wave needs it.
