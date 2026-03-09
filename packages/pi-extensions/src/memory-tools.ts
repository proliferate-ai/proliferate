/**
 * Pi Memory Extension
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

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Obj, OptNum, Str } from "./lib/schema.js";

// ---------------------------------------------------------------------------
// Memory system — lazy-initialized MemoryManager
// ---------------------------------------------------------------------------

// biome-ignore lint/nursery/noProcessEnv: runs inside sandbox, not in app
const MEMORY_DIR = process.env.MANAGER_MEMORY_DIR || "/home/user/memory";
const DB_PATH = `${MEMORY_DIR}/.memory.db`;
// biome-ignore lint/nursery/noProcessEnv: runs inside sandbox, not in app
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

interface MemoryManagerLike {
	search(query: string, maxResults: number): Promise<unknown[]>;
	get(path: string, from?: number, lines?: number): Promise<{ text: string }>;
}

let managerPromise: Promise<MemoryManagerLike> | null = null;

async function getManager() {
	if (!managerPromise) {
		managerPromise = (async () => {
			const mod = require("/home/user/.proliferate/sandbox-memory.cjs") as {
				MemoryManager: new (opts: {
					memoryDir: string;
					dbPath: string;
					openaiApiKey: string;
				}) => MemoryManagerLike & { init(): Promise<void>; startWatching(): void };
			};
			const mgr = new mod.MemoryManager({
				memoryDir: MEMORY_DIR,
				dbPath: DB_PATH,
				openaiApiKey: OPENAI_KEY,
			});
			await mgr.init();
			mgr.startWatching();
			return mgr;
		})();
	}
	return managerPromise;
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "memory_search",
		label: "Search Memory",
		description:
			"Search across all memory files using semantic + keyword hybrid search. Returns ranked snippets with file paths and line numbers. Use this before answering questions about prior work, decisions, or context.",
		parameters: Obj(
			{
				query: Str("Semantic query or keyword question"),
				maxResults: OptNum("Max results to return (default 6)"),
			},
			["query"],
		),
		async execute(_toolCallId: string, params: { query: string; maxResults?: number }) {
			try {
				const mgr = await getManager();
				const results = await mgr.search(params.query, params.maxResults ?? 6);
				const text = JSON.stringify({ results, count: results.length }, null, 2);
				return { content: [{ type: "text" as const, text }] };
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Memory search failed: ${message}` }],
				};
			}
		},
	});

	pi.registerTool({
		name: "memory_get",
		label: "Read Memory File",
		description:
			"Read a memory file (MEMORY.md or memory/*.md). Optionally specify a line range to read a specific section.",
		parameters: Obj(
			{
				path: Str("File path relative to memory dir (e.g. MEMORY.md, debugging.md, 2026-03-09.md)"),
				from: OptNum("Start line (1-indexed)"),
				lines: OptNum("Number of lines to read"),
			},
			["path"],
		),
		async execute(_toolCallId: string, params: { path: string; from?: number; lines?: number }) {
			try {
				const mgr = await getManager();
				const result = await mgr.get(params.path, params.from, params.lines);
				return {
					content: [{ type: "text" as const, text: result.text || "(empty file)" }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text" as const, text: `Memory read failed: ${message}` }],
				};
			}
		},
	});
}
