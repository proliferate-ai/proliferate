# UI optical sizing repair

Primary reference owner: Codex Desktop 26.715.31925. The comparison reuses the fresh Codex file-browser and multi-file tool-result captures already under `reference/codex/`.

Matched properties:

- semantic small/paired/control glyph hierarchy rather than fixed pixels;
- compact reasoning icon-to-label spacing;
- stable-color links with a hover-only underline;
- a stationary spinner box with only the inner glyph rotating;
- thin, consistently themed editor carets and selections.

Intentional Proliferate divergences:

- provider identities, top-left navigation, primary composer actions, and right-pane controls use the larger control tier at founder request;
- the Home onboarding stack is centered around the composer rather than copied from Codex;
- sidebar usage geometry, Goal bar, Scratch, xterm, and transparent Desktop chrome remain Proliferate-owned surfaces.

Live verification used app version 0.3.45, profile `ui-icon-optical-sizing`, renderer `http://127.0.0.1:39101/`, 1280×720, dark theme, UI Extra Small, code Small, window zoom 100%, and active HMR. Spinner wrapper center was `(314.5, 552)` before and after the 3-second recording while the SVG animation name was `proliferate-spinner-rotate` and the wrapper animation was `none`.
