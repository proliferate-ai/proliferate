import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { embedBatch, embedQuery } from "./embeddings.js";
import { hybridSearch } from "./search.js";
import { Store } from "./store.js";
import { syncFiles } from "./sync.js";
import type { MemoryManagerOptions, SearchResult } from "./types.js";
import { createMemoryWatcher } from "./watcher.js";

export type {
	SearchResult,
	Chunk,
	FileRecord,
	SearchOptions,
	MemoryManagerOptions,
} from "./types.js";

export class MemoryManager {
	private readonly memoryDir: string;
	private readonly dbPath: string;
	private readonly openaiApiKey: string | undefined;
	private store: Store | null = null;
	private watcher: { close: () => Promise<void> } | null = null;
	private dirty = true;

	constructor(opts: MemoryManagerOptions) {
		this.memoryDir = opts.memoryDir;
		this.dbPath = opts.dbPath;
		this.openaiApiKey = opts.openaiApiKey;
	}

	/** Initialize schema + sync files */
	async init(): Promise<void> {
		this.store = new Store(this.dbPath);
		await this.sync();
	}

	/** Search memory (hybrid vector + FTS, with temporal decay + MMR) */
	async search(query: string, maxResults?: number): Promise<SearchResult[]> {
		if (!this.store) throw new Error("MemoryManager not initialized");

		// Re-sync if dirty
		if (this.dirty) {
			await this.sync();
		}

		const embedQueryFn = this.openaiApiKey
			? (text: string) => embedQuery(text, this.openaiApiKey!)
			: null;

		return hybridSearch({
			query,
			store: this.store,
			embedQueryFn,
			maxResults,
			memoryDir: this.memoryDir,
		});
	}

	/** Read a memory file */
	async get(path: string, from?: number, lines?: number): Promise<{ path: string; text: string }> {
		const fullPath = join(this.memoryDir, path);
		const content = await readFile(fullPath, "utf-8");

		if (from !== undefined || lines !== undefined) {
			const allLines = content.split("\n");
			const start = from ?? 0;
			const count = lines ?? allLines.length - start;
			const sliced = allLines.slice(start, start + count).join("\n");
			return { path, text: sliced };
		}

		return { path, text: content };
	}

	/** Start file watcher */
	startWatching(): void {
		if (this.watcher) return;
		this.watcher = createMemoryWatcher({
			memoryDir: this.memoryDir,
			onChange: () => {
				this.dirty = true;
			},
		});
	}

	/** Stop watcher + close DB */
	async close(): Promise<void> {
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
		if (this.store) {
			this.store.close();
			this.store = null;
		}
	}

	private async sync(): Promise<void> {
		if (!this.store) return;

		const apiKey = this.openaiApiKey;
		const embedFn = apiKey
			? (texts: string[]) => embedBatch(texts, apiKey)
			: async (_texts: string[]) => _texts.map(() => [] as number[]);

		await syncFiles({
			memoryDir: this.memoryDir,
			store: this.store,
			embedFn,
		});

		this.dirty = false;
	}
}
