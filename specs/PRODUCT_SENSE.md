# Product Sense

This doc is for things that require *taste* and judgment: copy, design,
architectural positioning. Sparse by design: each entry is a call a competent
model gets wrong, with one good/bad pair. Enforcement mode is review,
legitimately. System-specific taste lives with that system (design tokens →
the [design system doc](codebase/platforms/product/design-system.md), area
judgment → the owner README).

## Broadly we like

- Non-AI text. No em-dashes in ANY product text. No AI tells.
- Concise beats complete.
- Always do the work for the user. Is there a bug? Tell them how to fix it if
  they can.
- NO EMOJIS.
- Readable and plain beats clever.
- The user is smart. Present them with the tools they need to build.
- Make the user's day better. If we can inject some whimsy into the product we
  should, but organized.

## Copy

**1. No em-dashes, no AI tells.** Anywhere users read: app, landing,
changelog, toasts. Rule-of-three lists, "not X but Y" constructions,
symmetrical hedging, puffery. Rewrite the sentence. When editing copy a human
wrote, keep their voice.

- Bad: `Proliferate isn't just a tool — it's a seamless, powerful platform.`
- Good: `Proliferate runs coding agents against real codebases, end to end.`

**2. Do the work for the user.** Errors and refusals name the specific thing
and the next step. Generic failure copy hands the user a dead end.

- Bad: `This model is unavailable.`
- Good: `claude-opus-5 isn't enabled for this workspace. Enable it in
  Settings → Models.`

**3. No qualifier for a distinction the user cannot act on.** If there is
only one kind of the thing, don't name the kind.

- Bad: the only item under a "New workspace" trigger reads `New cloud
  workspace` when cloud is the only option.
- Good: `New workspace`.

**4. Our vocabulary, never another product's name.** Describe what a
treatment or feature IS. No competitor names in copy, titles, comments, class
names, commit messages, branch names, or PR text. (Real product vocabulary
stays: `codex` as a harness, `cursor` as an editor target.)

- Bad: `A Cursor-style composer with Linear-quality polish.`
- Good: `The composer expands as you type and caps at a quarter of the
  window.`

## Naming

**5. Name things for the job, not the feature that needed them.** A reusable
thing named after its first consumer is a lie within a month.

- Bad: `WorkspaceListRow` reused for sessions and repos.
- Good: `ListRow`, `PageHeader`, `ConfirmationDialog`.

## Design

**6. Never the colored left-border treatment.** No colored left-edge notice
boxes, callouts, or ownership stripes, ever. Convey ownership and emphasis
through structure: grouping, tinted glyphs, weight.

- Bad: an info callout with a 3px blue left border and tinted background.
- Good: a plain bordered card with an icon and heavier title.

**7. Semantic color is earned.** Color states meaning the user must act on
(destructive, failing, running). Decorative color to make a state "feel"
important reads as noise. A human-input step is neutral, not amber.

- Bad: amber badge + amber border on every step that waits for a person.
- Good: neutral surface; the running step alone carries the accent.

**8. Don't ship an affordance the user can never use.** A permanently
disabled control, or a control that becomes unreachable in a legal layout
state, is a promise the product doesn't keep. Remove it or make it work.

- Bad: a floating prev/next pair that renders permanently disabled; an update
  affordance that vanishes when the sidebar is collapsed.
- Good: the control exists only where it can act, in every layout state.

**9. Readable and plain beats clever.** If the user has to decode a
visualization before they can read the number, it's the wrong visualization.

- Bad: two concentric rings encoding usage percentages.
- Good: status rows: label, percentage used, remaining.

**10. Micro-alignment is the bar.** Text inside chips, pills, and badges is
optically centered, not just box-centered. This class of one-pixel wrongness
is what separates the product from a demo.

- Bad: chip text sitting 1px low because the container centers the line box.
- Good: a nudged padding pair that makes the text read centered.

## Amending this doc

This doc grows from real misses: when an agent (or a person) makes a taste
call that gets rejected in review, and the miss is cross-product, it becomes
an entry, in the same PR or the next one, with the actual rejected thing as
the bad example. An entry that stops being violated gets cut; a competent
model getting it right is the retirement bar. Founder review on every change
here.
