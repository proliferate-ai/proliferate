# Codebase Documentation

Status: current index

This area explains where code belongs, which reusable contracts it implements,
and how complete product and engineering domains behave. Contributor
procedures live under [`../developing/`](../developing/).

## Read Order

| Category | Question it answers | Start here |
| --- | --- | --- |
| Structures | Where does this code belong, and which dependencies are allowed? | [`structures/README.md`](structures/README.md) |
| Platforms | Which reusable product, engineering, or internal capability owns this shared contract? | [`platforms/README.md`](platforms/README.md) |
| Systems | Which complete product or engineering domain owns this behavior? | [`systems/README.md`](systems/README.md) |

Most product changes require one structure document and either a platform or
system document. Read them in that order.

## Boundaries

- A structure document owns source layout, dependency direction, generated
  boundaries, and placement rules.
- A platform document owns a durable capability reused across multiple systems
  or source areas.
- A system document owns a complete product or engineering domain, its
  semantics, and end-to-end acceptance behavior.
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
