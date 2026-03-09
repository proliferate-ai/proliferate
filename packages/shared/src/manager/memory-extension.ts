/**
 * Pi Memory Extension — string template written to sandbox filesystem.
 *
 * Registers memory tools so Pi can search and read from the durable memory system.
 * Auto-discovered by pi-acp from ~/.pi/agent/extensions/.
 *
 * The memory system runs entirely inside the sandbox:
 * - SQLite + sqlite-vec for storage
 * - Hybrid vector + FTS5 search
 * - Temporal decay (30-day half-life on daily logs)
 * - MMR re-ranking for diversity
 *
 * Environment variables consumed at runtime inside the sandbox:
 *   MANAGER_MEMORY_DIR    — Memory directory (default: /home/user/memory)
 *   OPENAI_API_KEY        — For embedding generation (optional, falls back to FTS-only)
 */

export const PI_MEMORY_EXTENSION = [
	'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";',
	"",
	"// ---------------------------------------------------------------------------",
	"// Memory system — lazy-initialized MemoryManager",
	"// ---------------------------------------------------------------------------",
	"",
	"const MEMORY_DIR = process.env.MANAGER_MEMORY_DIR || '/home/user/memory';",
	"const DB_PATH = MEMORY_DIR + '/.memory.db';",
	"const OPENAI_KEY = process.env.OPENAI_API_KEY || '';",
	"",
	"let managerPromise: Promise<any> | null = null;",
	"",
	"async function getManager() {",
	"	if (!managerPromise) {",
	"		managerPromise = (async () => {",
	"			const { MemoryManager } = require('/home/user/.proliferate/sandbox-memory.cjs');",
	"			const mgr = new MemoryManager({",
	"				memoryDir: MEMORY_DIR,",
	"				dbPath: DB_PATH,",
	"				openaiApiKey: OPENAI_KEY,",
	"			});",
	"			await mgr.init();",
	"			mgr.startWatching();",
	"			return mgr;",
	"		})();",
	"	}",
	"	return managerPromise;",
	"}",
	"",
	"// ---------------------------------------------------------------------------",
	"// JSON Schema helpers",
	"// ---------------------------------------------------------------------------",
	"",
	'const Str = (d: string) => ({ type: "string" as const, description: d });',
	'const OptNum = (d: string) => ({ type: "number" as const, description: d, nullable: true } as const);',
	"",
	"function Obj(props: Record<string, unknown>, required?: string[]) {",
	"	return {",
	'		type: "object" as const,',
	"		properties: props,",
	"		...(required ? { required } : {}),",
	"	};",
	"}",
	"",
	"// ---------------------------------------------------------------------------",
	"// Extension entry point",
	"// ---------------------------------------------------------------------------",
	"",
	"export default function (pi: ExtensionAPI) {",
	"	// memory_search",
	"	pi.registerTool({",
	'		name: "memory_search",',
	'		label: "Search Memory",',
	'		description: "Search across all memory files using semantic + keyword hybrid search. Returns ranked snippets with file paths and line numbers. Use this before answering questions about prior work, decisions, or context.",',
	"		parameters: Obj({",
	'			query: Str("Semantic query or keyword question"),',
	'			maxResults: OptNum("Max results to return (default 6)"),',
	'		}, ["query"]),',
	"		async execute(_toolCallId: string, params: { query: string; maxResults?: number }) {",
	"			try {",
	"				const mgr = await getManager();",
	"				const results = await mgr.search(params.query, params.maxResults ?? 6);",
	"				const text = JSON.stringify({ results, count: results.length }, null, 2);",
	'				return { content: [{ type: "text" as const, text }] };',
	"			} catch (err) {",
	"				const message = err instanceof Error ? err.message : String(err);",
	'				return { content: [{ type: "text" as const, text: `Memory search failed: ${message}` }] };',
	"			}",
	"		},",
	"	});",
	"",
	"	// memory_get",
	"	pi.registerTool({",
	'		name: "memory_get",',
	'		label: "Read Memory File",',
	'		description: "Read a memory file (MEMORY.md or memory/*.md). Optionally specify a line range to read a specific section.",',
	"		parameters: Obj({",
	'			path: Str("File path relative to memory dir (e.g. MEMORY.md, debugging.md, 2026-03-09.md)"),',
	'			from: OptNum("Start line (1-indexed)"),',
	'			lines: OptNum("Number of lines to read"),',
	'		}, ["path"]),',
	"		async execute(_toolCallId: string, params: { path: string; from?: number; lines?: number }) {",
	"			try {",
	"				const mgr = await getManager();",
	"				const result = await mgr.get(params.path, params.from, params.lines);",
	'				return { content: [{ type: "text" as const, text: result.text || "(empty file)" }] };',
	"			} catch (err) {",
	"				const message = err instanceof Error ? err.message : String(err);",
	'				return { content: [{ type: "text" as const, text: `Memory read failed: ${message}` }] };',
	"			}",
	"		},",
	"	});",
	"}",
].join("\n");

/**
 * Memory system prompt section — appended to the coworker's system prompt.
 *
 * This gives the agent instructions on:
 * 1. How to recall from memory (search before answering)
 * 2. How and when to write to memory files
 */
export const MEMORY_SYSTEM_PROMPT_SECTION = `
## Memory Recall

You wake up fresh each session. Your continuity lives in ~/memory/.

Before answering anything about prior work, decisions, preferences, or context:
1. Run memory_search with a relevant query
2. Use memory_get to read the specific files/lines returned
3. If low confidence after search, say you checked but didn't find a match

Citations: include Source: <path#line> when referencing memory snippets.

## Memory Writing

If you want to remember something, WRITE IT TO A FILE. Mental notes don't survive session restarts.

- **MEMORY.md** — Your evergreen index. Keep it concise (<200 lines), organized by topic. Contains durable facts: decisions, preferences, patterns, architecture notes.
- **~/memory/<topic>.md** — Detailed notes on specific topics (e.g., memory/project-setup.md, memory/debugging.md). Evergreen, no decay.
- **~/memory/YYYY-MM-DD.md** — Daily logs of what happened. Raw context, running notes. These decay over 30 days in search ranking.

When to write:
- When someone says "remember this" — write it immediately
- When you learn a pattern or preference — update MEMORY.md
- When you complete significant work — log to today's daily file
- When you make a mistake or discover something — document it
- When a daily file gets long, distill the important bits into MEMORY.md or a topic file

When NOT to write:
- Transient conversation details that won't matter tomorrow
- Information already captured in the codebase itself
- Secrets, credentials, or sensitive data (never write these to memory)

Text > Brain. Always.
`.trim();

/**
 * Initial MEMORY.md template — seeded on first boot only.
 */
export const INITIAL_MEMORY_TEMPLATE = `# Memory

This is your long-term memory. Keep it concise (<200 lines), organized by topic.

## How to use this file
- Add entries under topic headings as you learn important information
- Link to detailed topic files: \`See memory/topic-name.md\`
- Review and prune regularly — remove outdated entries
- This file is loaded at the start of every session

## User Preferences


## Project Context


## Patterns & Decisions

`;
