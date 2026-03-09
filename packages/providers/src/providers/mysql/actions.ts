/**
 * MySQL action definitions — vNext provider format.
 *
 * Stateless module: receives a MySQL connection URL via ActionExecutionContext.token,
 * never imports DB helpers or reads credentials directly.
 *
 * Security: read actions enforce SET SESSION TRANSACTION READ ONLY,
 * statement prefix blocklists, MAX_EXECUTION_TIME optimizer hints,
 * and row limits. Per-call connections with AbortSignal.timeout.
 */

import mysql from "mysql2/promise";
import { z } from "zod";
import type { ActionDefinition, ActionExecutionContext, ActionResult } from "../../types";

// ============================================
// Constants
// ============================================

const MAX_EXECUTION_TIME_MS = 25_000;
const CONNECTION_TIMEOUT_MS = 28_000;
const DEFAULT_ROW_LIMIT = 100;
const MAX_ROW_LIMIT = 1000;
const DEFAULT_SAMPLE_ROWS = 3;

/** Statements that must never appear at the start of a read-mode query. */
const BLOCKED_STATEMENT_PREFIXES = [
	"INSERT",
	"UPDATE",
	"DELETE",
	"DROP",
	"ALTER",
	"CREATE",
	"TRUNCATE",
	"GRANT",
	"REVOKE",
	"RENAME",
	"REPLACE",
	"LOAD",
	"CALL",
	"SET",
	"LOCK",
	"UNLOCK",
];

// ============================================
// Action Definitions (Zod schemas)
// ============================================

export const actions: ActionDefinition[] = [
	{
		id: "list_tables",
		description: "List all tables in the connected MySQL database",
		riskLevel: "read",
		params: z.object({}),
	},
	{
		id: "describe_table",
		description: "Show columns, indexes, and optionally sample rows for a table",
		riskLevel: "read",
		params: z.object({
			table: z.string().describe("Table name"),
			sample_rows: z
				.number()
				.int()
				.min(0)
				.max(10)
				.optional()
				.describe("Number of sample rows to include (default 3, max 10)"),
		}),
	},
	{
		id: "query",
		description: "Execute a read-only SELECT query with row limit and timeout",
		riskLevel: "read",
		params: z.object({
			sql: z.string().describe("SQL SELECT statement"),
			limit: z
				.number()
				.int()
				.min(1)
				.max(MAX_ROW_LIMIT)
				.optional()
				.describe(`Maximum rows to return (default ${DEFAULT_ROW_LIMIT}, max ${MAX_ROW_LIMIT})`),
		}),
	},
	{
		id: "explain_query",
		description: "Run EXPLAIN on a query to show the execution plan without executing it",
		riskLevel: "read",
		params: z.object({
			sql: z.string().describe("SQL statement to explain"),
		}),
	},
	{
		id: "execute",
		description: "Execute a mutation (INSERT, UPDATE, DELETE, DDL) — requires approval",
		riskLevel: "write",
		params: z.object({
			sql: z.string().describe("SQL statement to execute"),
		}),
	},
];

// ============================================
// Connection Helper
// ============================================

async function withConnection<T>(
	connectionUrl: string,
	fn: (conn: mysql.Connection) => Promise<T>,
): Promise<T> {
	const conn = await mysql.createConnection(connectionUrl);
	try {
		return await fn(conn);
	} finally {
		await conn.end();
	}
}

// ============================================
// Security Helpers
// ============================================

function assertReadOnlyStatement(sql: string): void {
	const trimmed = sql.trimStart().toUpperCase();
	for (const prefix of BLOCKED_STATEMENT_PREFIXES) {
		if (trimmed.startsWith(prefix)) {
			throw new Error(`Blocked statement: ${prefix} is not allowed in read-only mode`);
		}
	}
}

function clampLimit(limit: number | undefined): number {
	if (limit === undefined) return DEFAULT_ROW_LIMIT;
	return Math.min(Math.max(1, limit), MAX_ROW_LIMIT);
}

function escapeIdentifier(name: string): string {
	// mysql2 escapeId wraps in backticks and escapes internal backticks
	return mysql.escapeId(name);
}

// ============================================
// Execute
// ============================================

export async function execute(
	actionId: string,
	params: Record<string, unknown>,
	ctx: ActionExecutionContext,
): Promise<ActionResult> {
	const connectionUrl = ctx.token;
	const startMs = Date.now();

	try {
		let data: unknown;

		switch (actionId) {
			case "list_tables": {
				data = await withConnection(connectionUrl, async (conn) => {
					await conn.query("SET SESSION TRANSACTION READ ONLY");
					const [rows] = await conn.query({
						sql: `SELECT TABLE_NAME AS table_name,
						       TABLE_TYPE AS table_type,
						       TABLE_ROWS AS estimated_rows,
						       TABLE_COMMENT AS comment
						  FROM information_schema.TABLES
						 WHERE TABLE_SCHEMA = DATABASE()
						 ORDER BY TABLE_NAME`,
						timeout: CONNECTION_TIMEOUT_MS,
					});
					return { tables: rows };
				});
				break;
			}

			case "describe_table": {
				const table = params.table as string;
				const sampleCount = Math.min(
					typeof params.sample_rows === "number" ? params.sample_rows : DEFAULT_SAMPLE_ROWS,
					10,
				);

				data = await withConnection(connectionUrl, async (conn) => {
					await conn.query("SET SESSION TRANSACTION READ ONLY");
					const escapedTable = escapeIdentifier(table);

					const [columns] = await conn.query({
						sql: `SHOW FULL COLUMNS FROM ${escapedTable}`,
						timeout: CONNECTION_TIMEOUT_MS,
					});
					const [indexes] = await conn.query({
						sql: `SHOW INDEX FROM ${escapedTable}`,
						timeout: CONNECTION_TIMEOUT_MS,
					});

					let sampleRows: unknown[] = [];
					if (sampleCount > 0) {
						const [rows] = await conn.query({
							sql: `/*+ MAX_EXECUTION_TIME(${MAX_EXECUTION_TIME_MS}) */ SELECT * FROM ${escapedTable} LIMIT ${sampleCount}`,
							timeout: CONNECTION_TIMEOUT_MS,
						});
						sampleRows = rows as unknown[];
					}

					return { columns, indexes, sample_rows: sampleRows };
				});
				break;
			}

			case "query": {
				const sqlStr = params.sql as string;
				const limit = clampLimit(params.limit as number | undefined);

				assertReadOnlyStatement(sqlStr);

				data = await withConnection(connectionUrl, async (conn) => {
					await conn.query("SET SESSION TRANSACTION READ ONLY");

					const wrappedSql = `/*+ MAX_EXECUTION_TIME(${MAX_EXECUTION_TIME_MS}) */ ${sqlStr}`;
					const [rows, fields] = await conn.query({
						sql: wrappedSql,
						timeout: CONNECTION_TIMEOUT_MS,
					});

					const rowArray = rows as Record<string, unknown>[];
					const truncated = rowArray.length > limit;
					const limitedRows = truncated ? rowArray.slice(0, limit) : rowArray;
					const columns = fields ? (fields as Array<{ name: string }>).map((f) => f.name) : [];

					return {
						columns,
						rows: limitedRows,
						row_count: limitedRows.length,
						truncated,
						execution_time_ms: Date.now() - startMs,
					};
				});
				break;
			}

			case "explain_query": {
				const sqlStr = params.sql as string;

				data = await withConnection(connectionUrl, async (conn) => {
					await conn.query("SET SESSION TRANSACTION READ ONLY");

					const [rows] = await conn.query({
						sql: `EXPLAIN ${sqlStr}`,
						timeout: CONNECTION_TIMEOUT_MS,
					});

					return { plan: rows };
				});
				break;
			}

			case "execute": {
				const sqlStr = params.sql as string;

				data = await withConnection(connectionUrl, async (conn) => {
					const [result] = await conn.query({
						sql: `/*+ MAX_EXECUTION_TIME(${MAX_EXECUTION_TIME_MS}) */ ${sqlStr}`,
						timeout: CONNECTION_TIMEOUT_MS,
					});

					const info = result as {
						affectedRows?: number;
						changedRows?: number;
						insertId?: number;
					};

					return {
						affected_rows: info.affectedRows ?? 0,
						changed_rows: info.changedRows ?? 0,
						insert_id: info.insertId ?? null,
						execution_time_ms: Date.now() - startMs,
					};
				});
				break;
			}

			default:
				return { success: false, error: `Unknown MySQL action: ${actionId}` };
		}

		return { success: true, data, durationMs: Date.now() - startMs };
	} catch (err) {
		return {
			success: false,
			error: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - startMs,
		};
	}
}

// ============================================
// Guide
// ============================================

export const guide = `# MySQL Integration Guide

## Overview
Query and manage MySQL databases directly from the sandbox.
The connection URL is handled server-side — no credentials needed in your queries.

## Available Actions

### list_tables (read)
List all tables in the connected database with type, estimated row count, and comments.

### describe_table (read)
Show columns, indexes, and sample rows for a specific table.
- \`table\` (required): table name
- \`sample_rows\` (optional): number of sample rows (0-10, default 3)

### query (read)
Execute a read-only SELECT query with automatic row limit and timeout.
- \`sql\` (required): SQL SELECT statement
- \`limit\` (optional): max rows to return (1-1000, default 100)

### explain_query (read)
Run EXPLAIN on a query to inspect the execution plan without executing it.
- \`sql\` (required): SQL statement to explain

### execute (write — requires approval)
Execute mutations (INSERT, UPDATE, DELETE, DDL statements).
- \`sql\` (required): SQL statement to execute

## Security
- Read actions enforce read-only transaction mode
- All queries have a 25-second execution timeout
- SELECT results are limited to 1000 rows maximum
- DML/DDL statements are blocked in read actions

## Tips
- Start with \`list_tables\` to discover available tables
- Use \`describe_table\` to understand schema before writing queries
- Use \`explain_query\` to check query performance before running expensive queries
- Read actions execute immediately; write actions require approval
`;
