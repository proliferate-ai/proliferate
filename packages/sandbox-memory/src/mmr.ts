import type { SearchResult } from "./types.js";

interface MmrConfig {
	lambda: number;
	maxResults: number;
}

/**
 * Maximal Marginal Relevance re-ranking.
 * Balances relevance with diversity to reduce redundant results.
 *
 * MMR_score = lambda * normalizedRelevance - (1-lambda) * maxSimilarityToSelected
 */
export function mmrRerank(items: SearchResult[], config: MmrConfig): SearchResult[] {
	if (items.length === 0) return [];
	if (items.length <= config.maxResults) return items;

	const { lambda, maxResults } = config;

	// Normalize scores to [0, 1]
	const maxScore = Math.max(...items.map((i) => i.score));
	const minScore = Math.min(...items.map((i) => i.score));
	const scoreRange = maxScore - minScore || 1;

	const normalizedScores = items.map((item) => (item.score - minScore) / scoreRange);

	// Pre-tokenize all items for Jaccard similarity
	const tokenSets = items.map((item) => tokenize(item.snippet));

	const selected: number[] = [];
	const remaining = new Set(items.map((_, i) => i));

	for (let step = 0; step < maxResults && remaining.size > 0; step++) {
		let bestIdx = -1;
		let bestMmr = Number.NEGATIVE_INFINITY;

		for (const idx of remaining) {
			const relevance = normalizedScores[idx];

			// Max similarity to any already-selected item
			let maxSim = 0;
			for (const selIdx of selected) {
				const sim = jaccardSimilarity(tokenSets[idx], tokenSets[selIdx]);
				if (sim > maxSim) maxSim = sim;
			}

			const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
			if (mmrScore > bestMmr) {
				bestMmr = mmrScore;
				bestIdx = idx;
			}
		}

		if (bestIdx === -1) break;
		selected.push(bestIdx);
		remaining.delete(bestIdx);
	}

	return selected.map((idx) => items[idx]);
}

/** Tokenize text into a set of lowercase alphanumeric tokens */
export function tokenize(text: string): Set<string> {
	const tokens = text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1);
	return new Set(tokens);
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B| */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
	if (setA.size === 0 && setB.size === 0) return 0;

	let intersection = 0;
	const smaller = setA.size <= setB.size ? setA : setB;
	const larger = setA.size <= setB.size ? setB : setA;

	for (const token of smaller) {
		if (larger.has(token)) intersection++;
	}

	const union = setA.size + setB.size - intersection;
	if (union === 0) return 0;
	return intersection / union;
}
