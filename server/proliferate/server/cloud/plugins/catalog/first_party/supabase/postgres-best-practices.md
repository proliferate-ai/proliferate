# Supabase Postgres best practices

Use this skill when reviewing Supabase Postgres schema, query, policy, or migration work.

1. Inspect the current schema and relevant policies before recommending changes.
2. Prefer explicit migration plans with rollback notes for destructive operations.
3. Check row level security, indexes, constraints, triggers, and function volatility where relevant.
4. For performance issues, identify the query pattern and likely index or schema cause before proposing SQL.
5. Keep generated SQL scoped to the user's request and note whether it has been executed.
