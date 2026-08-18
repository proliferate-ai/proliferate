# Pull Requests

Status: current procedure

Use this procedure to prepare, open, and mark a pull request ready for review.
It owns the contributor choices for PR scope, title, labels, body, and safe
support linkage. CI enforcement and release execution remain with
[`../deploying/README.md`](../deploying/README.md).

## Prepare

Keep one PR focused on one reviewable outcome. Record unrelated defects
separately instead of expanding the PR.

Choose a title in this form:

```text
<type>(<scope>): <plain-English change>
```

The allowed types are exactly:

```text
feat, fix, perf, docs, refactor, chore, ci, test, build, release
```

The scope must start with a lowercase letter or digit. Its remaining
characters may contain only lowercase letters, digits, `/`, or `-`. The change
text must be nonempty and remain on one line.

## Open

A draft PR may have a provisional title and no labels while work is in
progress. Every title and label rule in this procedure applies before
readiness. Draft bodies may remain incomplete while evidence is being gathered.
Before readiness, update the body with the structured receipt below and keep
it current with the PR head.

Use the proof depth required by [`../../specs/TESTING.md`](../../specs/TESTING.md).

If the PR has a support relationship, link it through the tracker. Confirm in
the PR body that the relationship was linked; do not include tracker, report,
user, or support identifiers, report bodies, emails, private messages,
telemetry identities, or other private source data. Consent-safe projection
from the tracker remains behavior owned by the
[Issue Lifecycle system](../../specs/codebase/systems/engineering/issue-lifecycle/support-loop.md).

## Ready For Review

Use exactly one `release:*` label and at least one `area:*` label, applying
every affected `area:*` label. If feature size or affected areas are ambiguous,
stop and ask a human to choose rather than guessing.

The body must contain one non-placeholder instance of every heading in the PR
template and report:

- a plain summary;
- testing/verification with an evidence state of `run`, `pending`,
  `not-applicable`, or `unavailable`; exact commands and results when run; and
  an unrun reason, residual risk, and next owner when not run;
- observability and security/privacy impact, using `none` plus a reason when
  there is no impact;
- documentation impact with exact repository paths, or `none` plus a reason;
- every affected consumer and its proof/follow-up state;
- exact specification revision and applicable rulings, or `not applicable`
  plus a reason;
- exact base and current head revisions;
- review head, verdict, and stable findings when review has occurred, otherwise
  its explicit pending/not-applicable/unavailable state;
- product-proof and human-acceptance state without treating CI as either; and
- current limitations, stopping point, and next consumer.

The compact schema and state meanings are owned by
[`delivery-contract.md`](delivery-contract.md). Metadata validation checks
objective shape only. It does not decide whether evidence is adequate or
whether a review, acceptance, qualification, or live observation is genuine.

### Release label

Choose exactly one of:

```text
release:large-feature
release:minor-feature
release:performance
release:fix
release:docs
release:maintenance
release:skip
```

Use the label whose meaning matches the change:

| Label | Use |
| --- | --- |
| `release:large-feature` | A launch-level product surface. This requires human confirmation and must not be inferred by an agent. |
| `release:minor-feature` | An ordinary user-visible feature. |
| `release:performance` | Measured performance-only work. |
| `release:fix` | A defect or correctness fix. |
| `release:docs` | Documentation, installation, changelog, or troubleshooting work. |
| `release:maintenance` | Non-user-facing refactors, tests, CI, release infrastructure, dependencies, code generation, logging, developer tooling, or cleanup. |
| `release:skip` | Exclusion from generated release notes only. |

### Area labels

Choose every affected label from this list:

```text
area:desktop
area:anyharness
area:sdk
area:server
area:cloud
area:docs
area:website
area:release
area:product
```

Select areas from the ownership actually changed, not from a component name
alone:

| Label | Ownership |
| --- | --- |
| `area:desktop` | Desktop application or native code. |
| `area:anyharness` | AnyHarness runtime. |
| `area:sdk` | SDKs. |
| `area:server` | Server and control plane. |
| `area:cloud` | Cloud runtime. |
| `area:docs` | Repository documentation. |
| `area:website` | Public Website. |
| `area:release` | Release infrastructure. |
| `area:product` | Cross-cutting Product behavior. |

Current mechanical classification has three important edge cases:

- `apps/web/**` maps to `area:website`.
- Mobile-only paths are neutral because there is no `area:mobile`; a human
  must select an appropriate existing area before readiness.
- Paths such as `cloud/sdk/**` match more than one area and block readiness
  until a human explicitly selects the correct affected label or labels.

## After Review

When review changes the outcome or ownership, update the summary, proof,
title, and labels before merge. Recheck the readiness rules after the last
change. Independent review is tied to the exact recorded head; any head move
invalidates that verdict until the reviewer examines the new delta and records
a new head and verdict. Generated release-note and finalizer behavior remains owned by
[`../deploying/README.md`](../deploying/README.md) and the Issue Lifecycle
system; public polished changelog pages are a separate product surface.
