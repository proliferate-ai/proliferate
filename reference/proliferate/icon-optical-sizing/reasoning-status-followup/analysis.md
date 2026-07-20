# Reasoning and status follow-up

Primary reference owner: Codex Desktop. The exact inspected state is the founder-supplied 700×296 recording of the completed-work disclosure expanding and collapsing over a populated transcript; it is preserved at `reference/codex/reasoning-disclosure/codex-work-disclosure.mov`.

Matched properties:

- completed work expands and collapses in normal document flow instead of mounting instantly;
- height and opacity settle together over a compact transition while the disclosure chevron rotates;
- the next transcript item is pushed smoothly and returns to the same position after collapse;
- the composer reasoning setting is an icon-only control with its full current value retained in the tooltip and accessible name;
- loading spinners keep a stationary square wrapper and rotate around the SVG center;
- live Thinking exposes elapsed seconds after the first complete second;
- error, warning, progress, and unread indicators use semantic optical tiers rather than one-off pixel sizes.

Intentional Proliferate divergences:

- Proliferate keeps its own work labels, tool icons, ledger rows, colors, and transcript spacing rather than copying Codex content or chrome;
- the disclosure uses a 200ms ease-out grid/opacity transition and honors reduced-motion preferences;
- the status matrix keeps the existing right-slot precedence and fixed row hit targets while only scaling the glyphs/dots;
- copy/timestamp layout, Markdown end-resource cards, and Cloud work-history rows remain Proliferate-owned components, with their ordering and clearance repaired in place.

No mock was required: the Codex recording fully specified the requested disclosure motion, and the founder-provided Proliferate screenshots specified the copy clipping, spinner-center, and Markdown-order failures directly.

Exact compiled motion measurement at 1280×800: the first activity ledger progressed from 0px collapsed to 117.06px at 20ms, 175.56px at 60ms, 219.78px at 120ms, and 228px settled at 240ms. The wrapper stayed in normal flow throughout. Across five samples spanning a full spinner rotation, the wrapper center and SVG center both remained `(286.34, 320.99)`; the wrapper animation was `none`, the SVG animation was `proliferate-spinner-rotate`, and the computed transform box was `fill-box`. The sidebar status dot measured 8.80×8.80px from the `0.55em` token, while warning and waiting controls both measured 17.33×17.33px. Live proof used app version 0.3.45, isolated profile `ui-icon-optical-sizing` for the real product, a frontend-only Desktop renderer at `http://127.0.0.1:39111/` for the final recording, dark mode, and active HMR on port 39112.
