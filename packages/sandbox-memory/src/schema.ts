import type Database from "better-sqlite3";

export function ensureSchema(db: Database.Database): { ftsAvailable: boolean } {
	db.exec(`
		CREATE TABLE IF NOT EXISTS files (
			path TEXT PRIMARY KEY,
			hash TEXT NOT NULL,
			mtime INTEGER NOT NULL,
			size INTEGER NOT NULL
		);
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS chunks (
			id TEXT PRIMARY KEY,
			path TEXT NOT NULL,
			start_line INTEGER NOT NULL,
			end_line INTEGER NOT NULL,
			hash TEXT NOT NULL,
			text TEXT NOT NULL,
			embedding TEXT NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS embedding_cache (
			model TEXT NOT NULL,
			hash TEXT NOT NULL,
			embedding TEXT NOT NULL,
			updated_at INTEGER NOT NULL,
			PRIMARY KEY (model, hash)
		);
	`);

	// Try to create FTS5 table — may fail if fts5 extension not available
	let ftsAvailable = false;
	try {
		db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
				text, id UNINDEXED, path UNINDEXED,
				start_line UNINDEXED, end_line UNINDEXED
			);
		`);
		ftsAvailable = true;
	} catch {
		ftsAvailable = false;
	}

	// Try to create vec0 virtual table for vector search
	// This is optional — if sqlite-vec is not available, we fall back to FTS-only
	try {
		db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
				id TEXT PRIMARY KEY,
				embedding FLOAT[1536]
			);
		`);
	} catch {
		// sqlite-vec not available, vector search disabled
	}

	return { ftsAvailable };
}
