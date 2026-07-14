# Codebase Documentation

Status: current index

This area explains where code belongs, which reusable contracts it implements,
and how complete product workflows behave. Contributor procedures live under
[`../developing/`](../developing/).

## Read Order

| Category | Question it answers | Start here |
| --- | --- | --- |
| Structures | Where does this code belong, and which dependencies are allowed? | [`structures/README.md`](structures/README.md) |
| Primitives | Which reusable product or runtime capability owns this shared contract? | [`primitives/README.md`](primitives/README.md) |
| Features | Which complete user workflow or product surface owns this behavior? | [`features/README.md`](features/README.md) |

Most product changes require one structure document and either a primitive or
feature document. Read them in that order.

## Boundaries

- A structure document owns source layout, dependency direction, generated
  boundaries, and placement rules.
- A primitive document owns a durable capability reused across multiple
  workflows or source areas.
- A feature document owns a complete user-facing workflow, product semantics,
  and end-to-end acceptance behavior.
- A development document owns the steps for running, testing, debugging,
  deploying, or operating the system.

Do not create a new category merely because one change crosses several owners.
Link to the existing owners and add a focused document only when a durable
boundary exists.

## Status

Documents here describe current `main` unless they explicitly say
`Status: target`. A target document must identify its current gap and must not
be treated as proof that the target has landed. Draft proposals remain under
[`../tbd/`](../tbd/) until approved and assigned an owner.
