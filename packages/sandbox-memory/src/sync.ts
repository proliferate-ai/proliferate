import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { chunkMarkdown } from "./chunker.js";
import { EMBEDDING_MODEL } from "./embeddings.js";
import type { Store } from "./store.js";
import type { Chunk } from "./types.js";

interface SyncParams {
	memoryDir: string;
	store: Store;
	embedFn: (texts: string[]) => Promise<number[][]>;
}

interface SyncResult {
	synced: number;
	deleted: number;
	unchanged: number;
}

/**
 * Synchronize markdown files in memoryDir with the database.
 * Uses hash-based change detection to skip unchanged files.
 */
export async function syncFiles(params: SyncParams): Promise<SyncResult> {
	const { memoryDir, store, embedFn } = params;
	const mdFiles = await findMarkdownFiles(memoryDir);
	const existingRecords = store.getAllFileRecords();
	const existingPaths = new Set(existingRecords.map((r) => r.path));
	const currentPaths = new Set(mdFiles.map((f) => f.relativePath));

	let synced = 0;
	let deleted = 0;
	let unchanged = 0;

	// Delete removed files
	for (const record of existingRecords) {
		if (!currentPaths.has(record.path)) {
			store.deleteVectorEntriesByPath(record.path);
			store.deleteFtsEntriesByPath(record.path);
			store.deleteChunksByPath(record.path);
			store.deleteFileRecord(record.path);
			deleted++;
		}
	}

	// Process current files
	for (const file of mdFiles) {
		const content = await readFile(file.absolutePath, "utf-8");
		const hash = hashContent(content);
		const fileStat = await stat(file.absolutePath);
		const existing = existingPaths.has(file.relativePath)
			? store.getFileRecord(file.relativePath)
			: undefined;

		if (existing && existing.hash === hash) {
			unchanged++;
			continue;
		}

		// File is new or changed — re-chunk and re-embed
		const rawChunks = chunkMarkdown(file.relativePath, content);

		// Check embedding cache and collect texts that need embedding
		const textsToEmbed: Array<{ index: number; text: string }> = [];
		const chunkEmbeddings: Array<number[] | undefined> = new Array(rawChunks.length);

		for (let i = 0; i < rawChunks.length; i++) {
			const cached = store.getCachedEmbedding(EMBEDDING_MODEL, rawChunks[i].hash);
			if (cached) {
				chunkEmbeddings[i] = cached;
			} else {
				textsToEmbed.push({ index: i, text: rawChunks[i].text });
			}
		}

		// Embed uncached texts
		if (textsToEmbed.length > 0) {
			try {
				const embeddings = await embedFn(textsToEmbed.map((t) => t.text));
				for (let j = 0; j < textsToEmbed.length; j++) {
					const { index } = textsToEmbed[j];
					chunkEmbeddings[index] = embeddings[j];
					// Cache the new embedding
					store.cacheEmbedding(EMBEDDING_MODEL, rawChunks[index].hash, embeddings[j]);
				}
			} catch (err) {
				// If embedding fails, use empty vectors (FTS-only search will still work)
				console.error(`Failed to embed chunks for ${file.relativePath}:`, err);
				for (const { index } of textsToEmbed) {
					chunkEmbeddings[index] = [];
				}
			}
		}

		// Remove old chunks for this file
		store.deleteVectorEntriesByPath(file.relativePath);
		store.deleteFtsEntriesByPath(file.relativePath);
		store.deleteChunksByPath(file.relativePath);

		// Insert new chunks
		for (let i = 0; i < rawChunks.length; i++) {
			const raw = rawChunks[i];
			const embedding = chunkEmbeddings[i] ?? [];
			const chunkId = `${file.relativePath}:${raw.startLine}-${raw.endLine}`;

			const chunk: Chunk = {
				id: chunkId,
				path: raw.path,
				startLine: raw.startLine,
				endLine: raw.endLine,
				hash: raw.hash,
				text: raw.text,
				embedding,
			};

			store.upsertChunk(chunk);
			store.upsertFtsEntry(chunk);
			if (embedding.length > 0) {
				store.upsertVectorEntry(chunkId, embedding);
			}
		}

		// Update file record
		store.upsertFileRecord({
			path: file.relativePath,
			hash,
			mtime: fileStat.mtimeMs,
			size: fileStat.size,
		});

		synced++;
	}

	return { synced, deleted, unchanged };
}

interface MarkdownFile {
	absolutePath: string;
	relativePath: string;
}

async function findMarkdownFiles(dir: string): Promise<MarkdownFile[]> {
	const results: MarkdownFile[] = [];
	try {
		await walkDir(dir, dir, results);
	} catch {
		// Directory might not exist yet
	}
	return results;
}

async function walkDir(
	baseDir: string,
	currentDir: string,
	results: MarkdownFile[],
): Promise<void> {
	const entries = await readdir(currentDir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(currentDir, entry.name);
		if (entry.isDirectory()) {
			// Skip hidden directories and node_modules
			if (entry.name.startsWith(".") || entry.name === "node_modules") {
				continue;
			}
			await walkDir(baseDir, fullPath, results);
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			results.push({
				absolutePath: fullPath,
				relativePath: relative(baseDir, fullPath),
			});
		}
	}
}

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}
