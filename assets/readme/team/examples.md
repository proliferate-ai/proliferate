# Example assignments

[Back to the team](../../../README.md#whos-on-your-team)

Give these assignments to a coding agent in a session. The roles describe jobs you can ask it to do; they are not preconfigured employees or automations. The outputs below are requested deliverables, not recorded outcomes.

Replace the placeholders and provide the relevant repository. Connect an integration when the assignment needs it, or paste the context yourself. Available tools depend on your connections and permissions. Review the result before using it.

## On-call engineer

```text
Investigate [Sentry issue or pasted error] in this repository. Trace the
failure to the relevant code and separate confirmed evidence from
hypotheses. Suggest a reproduction and the smallest plausible fix.
Do not change code or production state yet.
```

Context and tools: The error, affected version, and repository. Connect Sentry for issue context, or paste a redacted stack trace. Include reproduction details when available.

Inspectable output: A diagnosis with file references, supporting evidence, a reproduction command or procedure, and explicit unknowns.

## Product engineer

```text
Add CSV export to the activity page using [Linear issue or pasted
acceptance criteria]. Reuse the existing permissions and filtering.
Keep the change scoped, add appropriate tests, and run the relevant checks.
Summarize the diff and any decisions I need to review. Do not deploy.
```

Context and tools: A writable repository, acceptance criteria, and working development dependencies. Connect Linear to read the issue, or paste its contents. Include design constraints that are not captured in the code.

Inspectable output: A reviewable patch, test commands with their results, and any unmet acceptance criteria.

## Code reviewer

```text
Review [local diff or branch comparison] for correctness and regressions.
Read enough surrounding code to verify each concern. Prioritize actionable
findings with file and line references, the failure condition, and a
suggested test. Do not edit files. Say when you found no actionable issues.
```

Context and tools: The repository and an available diff or base reference. Include the intended behavior and any review focus, such as authorization or backwards compatibility.

Inspectable output: Evidence-backed findings you can check against the diff, plus coverage limits and checks actually performed.

## QA engineer

```text
Test the invite flow, including expired links and existing accounts,
against [acceptance criteria]. Read the test setup and run relevant tests. Add a
focused regression test where useful. Report failures with reproduction
steps and distinguish failed checks from checks you could not run.
```

Context and tools: The repository, runnable test dependencies, and safe test data. Provide expected behavior and any environment setup instructions. Keep production credentials out of the assignment.

Inspectable output: Test changes where applicable, command results, reproducible failures, and a list of untested behavior.

## Support engineer

```text
Investigate this redacted customer report: [report]. Compare the described
behavior with the repository and supplied documentation. Try to reproduce
it in a safe test environment. Draft a reply with a supported explanation
or safe next troubleshooting step. Flag
missing information and possible bugs. Do not send the reply.
```

Context and tools: A pasted support conversation, affected version, and relevant code. Supply product documentation directly or connect Notion for authorized pages. Remove customer secrets and unrelated personal information first.

Inspectable output: Reproduction steps or missing evidence, an editable customer reply, and follow-up questions or a proposed bug report.

## Release engineer

```text
Compare [release base] with [candidate ref]. Draft release notes from the
actual changes and inspect the documented release checklist. Run only
local, non-publishing checks. Flag migrations, compatibility concerns,
and missing verification. Do not tag, merge, publish, or deploy anything.
```

Context and tools: The repository with both references available, release instructions, and local check dependencies. State the intended release scope and any known blockers.

Inspectable output: Draft release notes, check results, and a readiness checklist that identifies what still needs a human decision.
