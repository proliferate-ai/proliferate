# Neon read-only inspection

Use this skill to inspect Neon Postgres context using read-only hosted MCP access.

1. Resolve the project, branch, database, schema, or query target from the request.
2. Inspect metadata before recommending changes.
3. Treat the connection as read-only. Do not attempt DDL, DML, deletes, branch changes, or secret changes.
4. For database advice, provide proposed SQL separately from observed state and mark it as not executed.
5. Preserve project ids, branch names, database names, and timestamps returned by tools.

