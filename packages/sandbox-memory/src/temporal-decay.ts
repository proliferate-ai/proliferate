import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SearchResult } from "./types.js";

const LN2 = Math.LN2;

interface DecayConfig {
	halfLifeDays: number;
	memoryDir?: string;
}

/**
 * Calculate exponential decay multiplier.
 * decayedScore = originalScore * exp(-lambda * ageInDays)
 * where lambda = ln(2) / halfLifeDays
 */
export function calculateTemporalDecayMultiplier(params: {
	ageInDays: number;
	halfLifeDays: number;
}): number {
	if (params.ageInDays <= 0) return 1;
	const lambda = LN2 / params.halfLifeDays;
	return Math.exp(-lambda * params.ageInDays);
}

/**
 * Apply temporal decay to search results.
 * Evergreen files get no decay. Dated files decay based on filename date.
 * Other files decay based on filesystem mtime.
 */
export async function applyTemporalDecay(
	results: SearchResult[],
	config: DecayConfig,
): Promise<SearchResult[]> {
	const now = Date.now();
	const decayed: SearchResult[] = [];

	for (const result of results) {
		if (isEvergreenMemoryPath(result.path)) {
			decayed.push(result);
			continue;
		}

		const dateFromPath = parseMemoryDateFromPath(result.path);
		let ageInDays: number;

		if (dateFromPath) {
			ageInDays = (now - dateFromPath.getTime()) / (1000 * 60 * 60 * 24);
		} else if (config.memoryDir) {
			try {
				const fullPath = join(config.memoryDir, result.path);
				const fileStat = await stat(fullPath);
				ageInDays = (now - fileStat.mtimeMs) / (1000 * 60 * 60 * 24);
			} catch {
				// File not accessible, no decay
				decayed.push(result);
				continue;
			}
		} else {
			// No way to determine age, no decay
			decayed.push(result);
			continue;
		}

		const multiplier = calculateTemporalDecayMultiplier({
			ageInDays,
			halfLifeDays: config.halfLifeDays,
		});

		decayed.push({
			...result,
			score: result.score * multiplier,
		});
	}

	return decayed;
}

/**
 * Check if a path is an "evergreen" memory file that should not decay.
 * Evergreen: MEMORY.md, and non-dated files in the memory/ directory.
 */
export function isEvergreenMemoryPath(path: string): boolean {
	const name = basename(path);

	// MEMORY.md at any level is evergreen
	if (name === "MEMORY.md") return true;

	// Non-dated .md files in memory dir root are evergreen
	// (e.g., "topics.md", "architecture.md" but NOT "2024-01-15.md")
	if (!parseMemoryDateFromPath(path)) {
		return true;
	}

	return false;
}

/**
 * Extract a date from a YYYY-MM-DD.md filename pattern.
 * Returns null if the filename doesn't match.
 */
export function parseMemoryDateFromPath(path: string): Date | null {
	const name = basename(path, ".md");
	const match = name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return null;
	const date = new Date(
		Number.parseInt(match[1], 10),
		Number.parseInt(match[2], 10) - 1,
		Number.parseInt(match[3], 10),
	);
	// Validate the parsed date is real
	if (Number.isNaN(date.getTime())) return null;
	return date;
}
