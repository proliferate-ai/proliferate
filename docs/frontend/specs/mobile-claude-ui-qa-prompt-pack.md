# Mobile Claude UI QA Prompt Pack

Use this prompt with Claude as a visual/product QA reviewer for Proliferate mobile.

```text
You are reviewing Proliferate's mobile web UI against Claude mobile UI references.

Context:
- Repo/worktree: /Users/pablohansen/.proliferate/worktrees/proliferate/web-cloud-local-parity-spec
- Running mobile web URL: http://127.0.0.1:5226/
- User is already logged in.
- Main spec: docs/frontend/specs/mobile-claude-ui-alignment.md
- Claude reference screenshots:
  - docs/frontend/specs/assets/mobile-claude-ui/claude-sidebar.png
  - docs/frontend/specs/assets/mobile-claude-ui/claude-workspaces.png
  - docs/frontend/specs/assets/mobile-claude-ui/claude-new-chat-home.png
  - docs/frontend/specs/assets/mobile-claude-ui/claude-three-dot-menu.png
  - docs/frontend/specs/assets/mobile-claude-ui/claude-three-dot-changing.png

Goal:
Make Proliferate mobile feel like the same class of mobile product as Claude:
- minimal
- calm
- dark native-feeling surfaces
- clean left drawer
- clean home/new-chat page
- clear workspace list
- chat composer that matches the Claude rhythm
- top-right three-dot/config menu that is obvious and elegant
- no desktop-ish dense controls, awkward cards, or random bold typography

Important product mapping:
- Claude "Chats" maps to Proliferate "Workspaces".
- Claude model selector maps to Proliferate model selector.
- Proliferate also needs runtime/source awareness:
  - Cloud sandbox
  - Desktop/Mac dispatch target
  - Mobile dispatch
  - Automation/Slack origins in lists
- Proliferate workspace chat has multiple sessions per workspace; session switching belongs in the top-right actions/config flow.
- Proliferate config controls include model, mode, reasoning effort, fast mode, etc. The current value must be visible, not hidden behind vague rows.

Do not make backend assumptions.
Do not rewrite the whole app.
Focus on visual/product correctness and exact concrete patches.

Please do this:

1. Open the Proliferate mobile URL and capture screenshots at a mobile viewport.
2. Compare these Proliferate screens against the Claude references:
   - left drawer
   - home/new chat
   - workspace list and filter/sort sheet
   - in-workspace chat view
   - chat composer
   - top-right actions/config menu
   - model/config selection state
3. Identify every mismatch that would make a user say "this is not the same taste/system as Claude."
4. For each mismatch, include:
   - severity: P0/P1/P2
   - what is wrong visually or behaviorally
   - exact reference screenshot it should match
   - exact file and style/component likely responsible
   - the smallest concrete fix
5. Then implement only the high-confidence P0/P1 fixes.
6. Preserve Proliferate product requirements:
   - sidebar rows are Home, Automations, Workspaces, Settings
   - recent section is Workspaces
   - bottom drawer action is See all and New chat
   - home has model selector at top, runtime selector under it, repo pill near composer, composer focused/open
   - chat has model/config visibility and can open the config/action sheet
   - top-right menu includes copy branch, claim if needed, config controls with current values, session switcher, new session
7. Run verification:
   - pnpm --filter @proliferate/mobile typecheck
   - visually re-open http://127.0.0.1:5226/ and screenshot the changed screens

Taste notes from the user:
- The previous UI was too chunky/ugly in the drawer.
- Text weights drifted too bold; don't make every label 700/800.
- The session composer looked worse than the home composer; align it with the Claude/home composer rhythm.
- The send icon should be the upward arrow style, not a paper plane.
- Config menus must show current values like "Model  Sonnet 4.7", "Mode  Default", "Reasoning  High", "Fast mode  Off".
- The model selector itself should show "Sonnet 4.7" with a chevron so it is obviously changeable.
- The three-dot/config menu should feel like Claude's floating menu, not a clunky full settings page.

Output format:

Summary:
- 3-6 bullets of the highest-signal observations.

Changed files:
- file path: short explanation

Remaining mismatches:
- P0/P1/P2 list with exact file/style references.

Verification:
- command results
- screenshot notes
```

