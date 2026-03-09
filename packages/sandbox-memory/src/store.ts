import { execSync } from "node:child_process";
import Database from "better-sqlite3";
import { ensureSchema } from "./schema.js";
import type { Chunk, FileRecord } from "./types.js";

interface VectorRow {
	id: string;
	distance: number;
}

interface FtsRow {
	id: string;
	path: string;
	start_line: number;
	end_line: number;
	text: string;
	rank: number;
}

interface ChunkRow {
	id: string;
	path: string;
	start_line: number;
	end_line: number;
	hash: string;
	text: string;
	embedding: string;
	updated_at: number;
}

interface CacheRow {
	embedding: string;
}

export class Store {
	readonly db: Database.Database;
	readonly ftsAvailable: boolean;
	vectorAvailable: boolean;

	constructor(dbPath: string) {
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("busy_timeout = 5000");

		// Try to load sqlite-vec extension
		this.vectorAvailable = false;
		try {
			this.db.loadExtension("vec0");
			this.vectorAvailable = true;
		} catch {
			// Bare name failed — try resolving from pip-installed sqlite-vec
			try {
				const vecPath = resolveVecExtensionPath();
				if (vecPath) {
					this.db.loadExtension(vecPath);
					this.vectorAvailable = true;
				}
			} catch {
				// sqlite-vec not available, vector search disabled
			}
		}

		const { ftsAvailable } = ensureSchema(this.db);
		this.ftsAvailable = ftsAvailable;
	}

	// --- File records ---

	getFileRecord(path: string): FileRecord | undefined {
		const row = this.db
			.prepare("SELECT path, hash, mtime, size FROM files WHERE path = ?")
			.get(path) as FileRecord | undefined;
		return row;
	}

	upsertFileRecord(record: FileRecord): void {
		this.db
			.prepare(
				`INSERT INTO files (path, hash, mtime, size) VALUES (?, ?, ?, ?)
				 ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, mtime = excluded.mtime, size = excluded.size`,
			)
			.run(record.path, record.hash, record.mtime, record.size);
	}

	getAllFileRecords(): FileRecord[] {
		return this.db.prepare("SELECT path, hash, mtime, size FROM files").all() as FileRecord[];
	}

	deleteFileRecord(path: string): void {
		this.db.prepare("DELETE FROM files WHERE path = ?").run(path);
	}

	// --- Chunks ---

	getChunksByPath(path: string): Chunk[] {
		const rows = this.db.prepare("SELECT * FROM chunks WHERE path = ?").all(path) as ChunkRow[];
		return rows.map(rowToChunk);
	}

	upsertChunk(chunk: Chunk): void {
		const now = Date.now();
		this.db
			.prepare(
				`INSERT INTO chunks (id, path, start_line, end_line, hash, text, embedding, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET
					path = excluded.path,
					start_line = excluded.start_line,
					end_line = excluded.end_line,
					hash = excluded.hash,
					text = excluded.text,
					embedding = excluded.embedding,
					updated_at = excluded.updated_at`,
			)
			.run(
				chunk.id,
				chunk.path,
				chunk.startLine,
				chunk.endLine,
				chunk.hash,
				chunk.text,
				JSON.stringify(chunk.embedding),
				now,
			);
	}

	deleteChunksByPath(path: string): void {
		this.db.prepare("DELETE FROM chunks WHERE path = ?").run(path);
	}

	// --- Embedding cache ---

	getCachedEmbedding(model: string, hash: string): number[] | undefined {
		const row = this.db
			.prepare("SELECT embedding FROM embedding_cache WHERE model = ? AND hash = ?")
			.get(model, hash) as CacheRow | undefined;
		if (!row) return undefined;
		return JSON.parse(row.embedding) as number[];
	}

	cacheEmbedding(model: string, hash: string, embedding: number[]): void {
		const now = Date.now();
		this.db
			.prepare(
				`INSERT INTO embedding_cache (model, hash, embedding, updated_at)
				 VALUES (?, ?, ?, ?)
				 ON CONFLICT(model, hash) DO UPDATE SET
					embedding = excluded.embedding,
					updated_at = excluded.updated_at`,
			)
			.run(model, hash, JSON.stringify(embedding), now);
	}

	// --- Vector search ---

	vectorSearch(queryEmbedding: number[], limit: number): Array<{ id: string; score: number }> {
		if (!this.vectorAvailable) return [];
		try {
			const rows = this.db
				.prepare(
					`SELECT id, distance FROM chunks_vec
					 WHERE embedding MATCH ?
					 ORDER BY distance
					 LIMIT ?`,
				)
				.all(JSON.stringify(queryEmbedding), limit) as VectorRow[];
			return rows.map((r) => ({
				id: r.id,
				// Convert distance to similarity score (cosine distance → similarity)
				score: 1 / (1 + r.distance),
			}));
		} catch {
			return [];
		}
	}

	// --- FTS search ---

	ftsSearch(
		query: string,
		limit: number,
	): Array<{
		id: string;
		path: string;
		startLine: number;
		endLine: number;
		text: string;
		score: number;
	}> {
		if (!this.ftsAvailable) return [];
		const ftsQuery = buildFtsQuery(query);
		if (!ftsQuery) return [];
		try {
			const rows = this.db
				.prepare(
					`SELECT id, path, start_line, end_line, text, rank
					 FROM chunks_fts
					 WHERE chunks_fts MATCH ?
					 ORDER BY rank
					 LIMIT ?`,
				)
				.all(ftsQuery, limit) as FtsRow[];
			return rows.map((r) => ({
				id: r.id,
				path: r.path,
				startLine: r.start_line,
				endLine: r.end_line,
				text: r.text,
				score: bm25RankToScore(r.rank),
			}));
		} catch {
			return [];
		}
	}

	// --- FTS entries ---

	upsertFtsEntry(chunk: Chunk): void {
		if (!this.ftsAvailable) return;
		try {
			// Delete existing entry first (FTS5 doesn't support UPSERT)
			this.db.prepare("DELETE FROM chunks_fts WHERE id = ?").run(chunk.id);
			this.db
				.prepare(
					"INSERT INTO chunks_fts (text, id, path, start_line, end_line) VALUES (?, ?, ?, ?, ?)",
				)
				.run(chunk.text, chunk.id, chunk.path, chunk.startLine, chunk.endLine);
		} catch {
			// FTS insert failed, non-fatal
		}
	}

	deleteFtsEntriesByPath(path: string): void {
		if (!this.ftsAvailable) return;
		try {
			this.db.prepare("DELETE FROM chunks_fts WHERE path = ?").run(path);
		} catch {
			// FTS delete failed, non-fatal
		}
	}

	// --- Vector entries ---

	upsertVectorEntry(id: string, embedding: number[]): void {
		if (!this.vectorAvailable) return;
		try {
			// Delete existing entry first (vec0 may not support UPSERT)
			this.db.prepare("DELETE FROM chunks_vec WHERE id = ?").run(id);
			this.db
				.prepare("INSERT INTO chunks_vec (id, embedding) VALUES (?, ?)")
				.run(id, JSON.stringify(embedding));
		} catch {
			// Vector insert failed, non-fatal
		}
	}

	deleteVectorEntriesByPath(path: string): void {
		if (!this.vectorAvailable) return;
		try {
			// Get chunk IDs for this path, then delete from vec table
			const rows = this.db.prepare("SELECT id FROM chunks WHERE path = ?").all(path) as Array<{
				id: string;
			}>;
			const deleteStmt = this.db.prepare("DELETE FROM chunks_vec WHERE id = ?");
			for (const row of rows) {
				deleteStmt.run(row.id);
			}
		} catch {
			// Vector delete failed, non-fatal
		}
	}

	close(): void {
		this.db.close();
	}
}

function rowToChunk(row: ChunkRow): Chunk {
	return {
		id: row.id,
		path: row.path,
		startLine: row.start_line,
		endLine: row.end_line,
		hash: row.hash,
		text: row.text,
		embedding: JSON.parse(row.embedding) as number[],
	};
}

/**
 * Resolve the sqlite-vec extension path from pip-installed package.
 * Returns the path without platform suffix (SQLite adds it automatically).
 */
function resolveVecExtensionPath(): string | null {
	try {
		const result = execSync('python3 -c "import sqlite_vec; print(sqlite_vec.loadable_path())"', {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!result) return null;
		// Strip platform extension suffix — SQLite adds it automatically
		return result.replace(/\.(so|dylib|dll)$/, "");
	} catch {
		return null;
	}
}

/** Tokenize input, quote each token, join with AND for FTS5 */
export function buildFtsQuery(raw: string): string {
	const tokens = raw
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((t) => t.length > 0);
	if (tokens.length === 0) return "";
	return tokens.map((t) => `"${t}"`).join(" AND ");
}

/** Convert BM25 rank (negative, lower = better) to a 0-1 score */
export function bm25RankToScore(rank: number): number {
	return 1 / (1 + Math.max(0, -rank));
}
