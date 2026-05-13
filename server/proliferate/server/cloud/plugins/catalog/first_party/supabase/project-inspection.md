# Supabase project inspection

Use this skill for safe inspection of the configured Supabase project.

1. Use the configured project reference for the mounted server. Do not switch projects unless the user asks and the tool supports it.
2. Treat read-only mode as the default. Inspect schema, tables, policies, functions, logs, and configuration before suggesting changes.
3. When discussing database changes, separate observation, risk, and proposed SQL.
4. Do not run write queries, migrations, deletes, or policy changes unless the user explicitly asks and the connection is not read-only.
5. Redact secrets and avoid copying credentials into messages.
