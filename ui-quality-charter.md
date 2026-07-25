What this workspace is for: ensuring our UX and quality bar is up to Codex standards (and beyond) in a streamlined, scalable way. Quality comes from systems, not per-surface heroics.

What does that take?
- Taken for granted: use our existing organizational layout for logic (ie hook organization, etc.)

1) Foundations: one closed system for a) tokens/theming, b) sizing, c) type/icons, d) motion. This is the basis for everything
    1) Small closed ramps: ~4 body font sizes with paired line-heights (Codex authors 12/13/14/16px tokens; renders ~11/12/13/15 at its 0.9 window zoom — distill from authored tokens), spacing steps, color roles, radii
    2) Motion as tokens: durations/easings for enter/exit/collapse/slide (sidebar open-close, "Worked for…" collapse all draw from one vocabulary)
    3) Icon size + color paired to text steps — one legal icon size/color per step, so icon/text unevenness is structurally impossible
    4) Enforced by CI lint gate: no arbitrary values (text-[..px], raw hex, one-off icon sizes, ad-hoc easings) outside the design package

2) Primitives: cleanest possible set that works well together, WITHOUT duplicates or unintentional creations
    1) Every creation/visual fork of a component MUST be sanctioned (no willy-nilly design by models unless instructed; freely USE the agreed-upon catalog)
        1) eg updates re-use our existing component system with clean mapping onto it
    2) Enforced by a catalog boundary check (new component outside catalog → CI red), so sanctioning is cheap, not tribal knowledge
    3) Dedupe audit BEFORE the catalog freezes (don't bless existing twins: double update-nag, parallel naming pipelines)
    4) One derivation function per user-visible fact (display name, unread state, update availability); surfaces import it, never re-derive

3) Latency: speed/rendering guarantees on our actual substrate (WKWebView), as outcome budgets not just re-commit counts
    1) Static lint bans per-PR: backdrop-filter outside allowlist (measured 200-400ms/keystroke), unvirtualized unbounded lists near transcript
    2) Dev-mode budget warnings: keystroke-to-paint / flush-cadence / scroll-frame budgets warn loudly at author time
    3) Deterministic replay tests per-PR: playground recorded-session replay asserts flush cadence + React commit counts (tripwire, not headline)
    4) Prod telemetry: same budgets sampled in prod; sustained violations emit telemetry. "We noticed it's slow" apology UI only later, once thresholds prove reliable
    5) No wall-clock e2e timing in per-PR CI (noise → ignored red); true keystroke-to-paint is a pre-release trend check

4) Consultable library: code + spec + gates, referenced before every new feature
    1) Code is the system: tokens in packages/design, primitives in ui/product-ui
    2) Compact spec: which type step for which content, which primitive for which use case (and which near-miss NOT to build), disclosure grammar, motion recipes, icon pairing table
    3) Workflow: consult spec + catalog first → covered? use the sanctioned thing → not covered? escalate as a design decision, never improvise inline

5) Interaction design: reference-grounded, never guessed
    1) Motion/disclosure/affordance decisions made against captured Codex/Conductor evidence, written as observable contracts before implementing
    2) Standing ruling: tab strip stays (Conductor is the clean-tab-strip reference), title fallback fixed via the one-derivation rule

So the approach here is to:
a) Map as MUCH as possible of Codex + Conductor using agents (they have clean-af UIs): every page/surface, plus states (hover, loading, error, streaming, empty) and motion recordings, saved as a permanent reference library per the artifact contract (reference/<app>/<feature>/)
    - This library outlives the project: any later "make X more/less similar to Codex/Conductor" is a lookup, not a recapture
    - Hunch to confirm: Codex token/sizing, Conductor font/icon
    - Live capture serialized (one operator per app); analysis/distillation fans out to agents
    - Done-criterion (so this doesn't run unbounded): covers (i) every surface on the complaint list, (ii) enough evidence to distill the b) targets (ramp, motion values, icon pairs, color roles), (iii) one representative state-set per surface type. Long-tail states get captured lazily during d) when an area needs them — the library grows on demand
b) Redo the OVERALL styling — tokens, sizing, type/icon pairing, color roles, motion vocabulary — so we have a CLEAN base to work with
    - Lint gates land WITH this step, not after, or c)/d) drift off the new system while it's being applied
    - This shifts every surface at once by design → ends in a FOUNDER CHECKPOINT: Pablo reviews the whole app on the new base and blesses it before d) waves fan out
    - Expect some surfaces to look temporarily WORSE at this checkpoint (they were compensating for bad tokens with local hacks) — that's anticipated, not a regression
c) Cull duplicated components, narrow down and be specific about the components we have → sanctioned catalog v1 + boundary check
    - Dedupe first (double update-nag, parallel naming pipelines), then catalog v1 ships with the gate
    - c) is a gate, not a finished phase: d) work will keep surfacing duplicates; the catalog refines as areas get cleaned (removals get easier; additions still need sanction)
d) In parallel waves, clean up product areas by cleaning the components/surfaces/pages they consume — including motion, CSS, icons, text scaling, interaction states — each area referencing the mapped Codex/Conductor captures from a)
    - Non-overlapping areas = parallelizable; one workstream per area, all consuming the b) tokens and c) catalog
    - Already-root-caused fixes (tab-title fallback, double update-nag, duplicate repo rows, empty Threads header, width clamping) are token-independent → start day one
e) Be strict about latency and speed. FAST.
    - Budgets, replay tests, prod telemetry per 3) above
    - Carve-out landing early (with b): the two static poison-pattern lint bans (backdrop-filter, unvirtualized lists), so b)-d) never build on patterns e) would rip out

Execution shape (steps are distinct by DELIVERABLE, not calendar — this is not a waterfall):
- a) → b) sequential (captures feed the token targets); c) runs alongside b)
- Founder checkpoint after b), then d) fans out in waves
- Root-caused fixes + poison-pattern lint bans run from day one, independent of everything
- e) focus-pass last
- Pablo reviews every change's effect on look/UI with a close eye — visual proof (before/after screenshots, recordings for motion) accompanies every landed change per the artifact contract

End state:
- A CLEAN design system inspired by Codex/Conductor (tokens, sizing, motion, icon/text pairing — all gated)
- A cleanly redesigned product where every component is approved: motion, CSS, icons, text scaling included
- The referenceable capture library from a), for future "more/less like Codex/Conductor" adjustments
- A clean set of specs for building UI in general (which type step for what, which primitive for what, disclosure grammar, motion recipes)
