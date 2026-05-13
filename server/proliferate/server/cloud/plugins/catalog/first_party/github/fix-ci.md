# Fix GitHub CI

Use this skill when a GitHub pull request or branch has failing GitHub Actions checks.

1. Resolve the repository, pull request or branch, commit sha, and failing check names.
2. Fetch failing workflow or check details before changing code. Prefer logs for the failing step over broad workflow summaries.
3. Identify whether the failure is a code regression, test fixture issue, environment issue, dependency issue, or flaky infrastructure.
4. Make the smallest code or config change that explains the failure.
5. Report the failing check name, the observed error, the fix, and the local verification that was run.

