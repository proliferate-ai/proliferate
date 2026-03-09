import { mmrRerank } from "./mmr.js";
import type { Store } from "./store.js";
import { applyTemporalDecay } from "./temporal-decay.js";
import type { SearchResult } from "./types.js";

/**
 * Hybrid search combining vector similarity and FTS.
 * Falls back to FTS-only if vector search is unavailable.
 */
export async function hybridSearch(params: {
	query: string;
	store: Store;
	embedQueryFn: ((text: string) => Promise<number[]>) | null;
	maxResults?: number;
	memoryDir?: string;
}): Promise<SearchResult[]> {
	const maxResults = params.maxResults ?? 6;
	const candidates = maxResults * 4;

	// 1. Get vector results (if embedding is available)
	let vectorResults: Array<{ id: string; score: number }> = [];
	if (params.embedQueryFn && params.store.vectorAvailable) {
		try {
			const queryVec = await params.embedQueryFn(params.query);
			vectorResults = params.store.vectorSearch(queryVec, candidates);
		} catch {
			// Embedding failed, continue with FTS-only
		}
	}

	// 2. Get FTS results
	const ftsResults = params.store.ftsSearch(params.query, candidates);

	// 3. If no results from either source, return empty
	if (vectorResults.length === 0 && ftsResults.length === 0) {
		return [];
	}

	// 4. Merge by chunk ID (weighted: 0.7 vector + 0.3 FTS)
	const merged = mergeResults(vectorResults, ftsResults, 0.7, 0.3);

	// 5. Resolve chunk details from DB
	const searchResults = resolveChunkDetails(merged, params.store);

	// 6. Temporal decay
	const decayed = await applyTemporalDecay(searchResults, {
		halfLifeDays: 30,
		memoryDir: params.memoryDir,
	});

	// 7. MMR re-ranking
	const reranked = mmrRerank(decayed, { lambda: 0.7, maxResults });

	return reranked;
}

interface MergedResult {
	id: string;
	score: number;
	source: string;
}

function mergeResults(
	vectorResults: Array<{ id: string; score: number }>,
	ftsResults: Array<{
		id: string;
		path: string;
		startLine: number;
		endLine: number;
		text: string;
		score: number;
	}>,
	vectorWeight: number,
	ftsWeight: number,
): MergedResult[] {
	const scoreMap = new Map<string, { vectorScore: number; ftsScore: number }>();

	// Normalize vector scores
	const maxVec = vectorResults.length > 0 ? Math.max(...vectorResults.map((r) => r.score)) : 1;
	for (const r of vectorResults) {
		const normalized = maxVec > 0 ? r.score / maxVec : 0;
		scoreMap.set(r.id, { vectorScore: normalized, ftsScore: 0 });
	}

	// Normalize FTS scores
	const maxFts = ftsResults.length > 0 ? Math.max(...ftsResults.map((r) => r.score)) : 1;
	for (const r of ftsResults) {
		const normalized = maxFts > 0 ? r.score / maxFts : 0;
		const existing = scoreMap.get(r.id);
		if (existing) {
			existing.ftsScore = normalized;
		} else {
			scoreMap.set(r.id, { vectorScore: 0, ftsScore: normalized });
		}
	}

	// Combine scores
	const merged: MergedResult[] = [];
	for (const [id, scores] of scoreMap) {
		const combined = vectorWeight * scores.vectorScore + ftsWeight * scores.ftsScore;
		let source = "hybrid";
		if (scores.vectorScore > 0 && scores.ftsScore === 0) source = "vector";
		if (scores.vectorScore === 0 && scores.ftsScore > 0) source = "fts";
		merged.push({ id, score: combined, source });
	}

	// Sort by combined score descending
	merged.sort((a, b) => b.score - a.score);
	return merged;
}

function resolveChunkDetails(merged: MergedResult[], store: Store): SearchResult[] {
	const results: SearchResult[] = [];

	for (const item of merged) {
		// Look up chunk by ID
		const row = store.db
			.prepare("SELECT path, start_line, end_line, text FROM chunks WHERE id = ?")
			.get(item.id) as
			| { path: string; start_line: number; end_line: number; text: string }
			| undefined;

		if (!row) continue;

		results.push({
			path: row.path,
			startLine: row.start_line,
			endLine: row.end_line,
			score: item.score,
			snippet: row.text,
			source: item.source,
		});
	}

	return results;
}
