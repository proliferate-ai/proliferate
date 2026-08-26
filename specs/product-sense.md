# Product Sense

Things that require *taste* and judgment: copy, design, architectural positioning. Enforced by review. System-specific taste lives with that system (design tokens → the [design system doc](DESIGN_SYSTEM.md), area judgment → the owner README).

## Broadly we like

- Non-AI text. No em-dashes in ANY product text. No AI tells.
- Concise beats complete.
- Always do the work for the user. Is there a bug? Tell them how to fix it if
  they can.
- NO EMOJIS.
- Readable and plain beats clever.
- The user is smart. Present them with the tools they need to build.
- Make the user's day better. If we can inject some whimsy into the product we
  should, but be organized.

## Copy

- No AI tells: rule-of-three lists, "not X but Y", symmetrical hedging,
  puffery. When editing copy a human wrote, keep their voice.
- Errors name the specific thing and the next step. No dead ends.
- No qualifier for a distinction the user cannot act on. If there is only one
  kind of the thing, don't name the kind (not `New cloud workspace` when
  cloud is the only option).
- Our vocabulary, never another product's name. Anywhere: copy, comments,
  class names, commits, PRs. (Real product vocabulary stays: `codex` as a
  harness, `cursor` as an editor target.)

## Naming

- Name things for the job, not the feature that first needed them (`RosterRow`,
  never `WorkspaceRosterRow`).

## Design

- Never the colored left-border treatment. Emphasis and ownership come from
  structure: grouping, tinted glyphs, weight.
- Semantic color is earned: it marks state the user must act on. A human-input
  step is neutral, not amber.
- Never ship an affordance the user can't use: no permanently disabled
  controls, no controls unreachable in a legal layout state.
- If the user has to decode a visualization before reading the number, it's
  the wrong visualization.
- Sweat micro-alignment: chip and pill text is optically centered, not
  box-centered. One-pixel wrongness separates the product from a demo.

## Amending this doc

Grows from real misses: a taste call rejected in review becomes an entry in the same PR, with the rejected thing named. Add a good/bad example only when agents keep not grokking the rule. Entries that stop being violated get cut. Founder review on every change.
