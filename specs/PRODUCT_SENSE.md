# Product Sense

Sparse cross-product judgment primitives: the taste calls a competent model
gets wrong — style, copy, naming, tone. Each carries one good/bad pair.
Enforcement mode is review, legitimately.

Admission bar: if it only applies to one system, it lives with that system
(design tokens → the
[design system doc](codebase/platforms/product/design-system.md), area
judgment → the owner README). If a competent model gets it right anyway, it is not here.
If this doc grows past ~15 entries, cut it back.

## Copy

**1. No em-dashes in user-visible copy.** Anywhere: app, landing, changelog,
toasts. Rewrite the sentence instead.

- Bad: `Sessions run in the cloud — no setup required.`
- Good: `Sessions run in the cloud. No setup required.`

**2. Strip the AI tells.** Rule-of-three lists, "not X but Y" constructions,
symmetrical hedging, puffery adjectives, bold-header bullet mush. If a sentence
reads like a launch tweet, cut it. And when editing copy a human wrote, keep
their voice — do not re-polish it into model-speak.

- Bad: `Proliferate isn't just a tool — it's a seamless, powerful platform
  that transforms how you build, ship, and iterate.`
- Good: `Proliferate runs coding agents against real codebases, end to end.`

**3. Concise beats complete.** Changelogs are plain bulleted Improvements /
Fixes, one line each — no expandable sections, no per-item ceremony. Error and
status copy says the one thing the user needs.

- Bad: a changelog entry with a dropdown revealing three paragraphs per fix.
- Good: `- Fixed transcript scroll jumping on session re-entry.`

**4. Refusals and errors name the specific thing.** Generic failure copy is a
dead end; the message states which model, target, or setting is the problem so
the user's next step is obvious.

- Bad: `This model is unavailable.`
- Good: `claude-opus-5 isn't enabled for this workspace. Enable it in
  Settings → Models.`

**5. Our vocabulary, never another product's name.** Describe what a treatment
or feature IS. No competitor names in user-visible copy, titles, marketing
positioning, comments, class names, commit messages, branch names, or PR text.
(Real product vocabulary stays: `codex` as a harness, `cursor` as an editor
target.)

- Bad: `A Cursor-style composer with Linear-quality polish.`
- Good: `The composer expands as you type and caps at a quarter of the
  window.`

## Naming

**6. Name things for the job, not the feature that needed them.** A reusable
thing named after its first consumer is a lie within a month.

- Bad: `WorkspaceListRow` reused for sessions and repos.
- Good: `ListRow`, `PageHeader`, `ConfirmationDialog`.

## Visual judgment

**7. Never the colored left-border treatment.** No colored left-edge notice
boxes, callouts, or ownership stripes, ever. Convey ownership and emphasis
through structure: grouping, tinted glyphs, weight.

- Bad: an info callout with a 3px blue left border and tinted background.
- Good: a plain bordered card with an icon and heavier title.

**8. Semantic color is earned.** Color states meaning the user must act on
(destructive, failing, running). Decorative color to make a state "feel"
important reads as noise — a human-input step is neutral, not amber.

- Bad: amber badge + amber border on every step that waits for a person.
- Good: neutral surface; the running step alone carries the accent.

**9. No emoji as icons, no emoji in product copy.** Glyphs come from the icon
set; brand marks are the real assets, never redrawn from memory or
approximated.

- Bad: `🚀 Deploy` button; a hand-written SVG path "close enough" to a brand
  logo.
- Good: the icon module's glyph; the brand's actual mark, imported.

**10. Micro-alignment is the bar.** Text inside chips, pills, and badges is
optically centered, not just box-centered — cap-height and descenders shift
the visual middle. This class of one-pixel wrongness is what separates the
product from a demo.

- Bad: chip text sitting 1px low because the container centers the line box.
- Good: a nudged padding pair that makes the text read centered.

## Showing the product

**11. The real thing or nothing.** Demos, screenshots, and marketing visuals
show the actual running product. Never a hand-built mock of a widget, never a
fake terminal-UI graphic, never a recreation "for illustration."

- Bad: an inline mock recreating the composer for a demo.
- Good: a screenshot or recording of the served app, even if it takes longer.

**12. Lead with product and receipts.** Positioning shows what it does and
proves it — no competitor comparisons in titles, no category-claiming
superlatives.

- Bad: `The best alternative to <competitor>` as a page title.
- Good: the launch post is the product doing the work, with numbers.
