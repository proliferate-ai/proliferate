# GitHub triage

Use the mounted GitHub MCP server to orient before making claims about repository, issue, pull request, or check state.

1. Identify the target repository and issue, pull request, branch, commit, or check suite before calling tools.
2. Fetch the narrowest object that answers the question. Prefer direct pull request, issue, review, check, or workflow queries over broad repository scans.
3. Preserve GitHub identifiers returned by tools, including repository owner/name, pull request number, issue number, comment ids, check run ids, workflow run ids, and commit shas.
4. When summarizing, separate observed GitHub state from recommendations.
5. Do not publish commits, push branches, merge pull requests, close issues, or otherwise mutate GitHub unless the user explicitly asks for that action and the available MCP tools support it.

