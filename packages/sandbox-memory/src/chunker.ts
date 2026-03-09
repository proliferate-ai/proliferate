import { createHash } from "node:crypto";

const TARGET_TOKENS = 400;
const OVERLAP_TOKENS = 80;

interface RawChunk {
	path: string;
	startLine: number;
	endLine: number;
	text: string;
	hash: string;
}

/**
 * Split markdown content into chunks suitable for embedding.
 * Splits by headings first, then by paragraph/token count.
 */
export function chunkMarkdown(filePath: string, content: string): RawChunk[] {
	const lines = content.split("\n");
	const sections = splitByHeadings(lines);
	const chunks: RawChunk[] = [];

	for (const section of sections) {
		const sectionChunks = splitSection(section.lines, section.startLine);
		for (const sc of sectionChunks) {
			const text = sc.lines.join("\n").trim();
			if (text.length === 0) continue;
			chunks.push({
				path: filePath,
				startLine: sc.startLine,
				endLine: sc.startLine + sc.lines.length - 1,
				text,
				hash: hashText(text),
			});
		}
	}

	return chunks;
}

interface Section {
	lines: string[];
	startLine: number;
}

/** Split lines into sections by ## and ### headings */
function splitByHeadings(lines: string[]): Section[] {
	const sections: Section[] = [];
	let currentLines: string[] = [];
	let currentStart = 1; // 1-based line numbers

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^#{2,3}\s/.test(line) && currentLines.length > 0) {
			sections.push({ lines: currentLines, startLine: currentStart });
			currentLines = [line];
			currentStart = i + 1;
		} else {
			currentLines.push(line);
		}
	}

	if (currentLines.length > 0) {
		sections.push({ lines: currentLines, startLine: currentStart });
	}

	return sections;
}

interface SubChunk {
	lines: string[];
	startLine: number;
}

/** Split a section into chunks of ~TARGET_TOKENS with OVERLAP_TOKENS overlap */
function splitSection(lines: string[], startLine: number): SubChunk[] {
	const totalTokens = countTokens(lines.join("\n"));
	if (totalTokens <= TARGET_TOKENS) {
		return [{ lines, startLine }];
	}

	const chunks: SubChunk[] = [];
	let i = 0;

	while (i < lines.length) {
		const chunkLines: string[] = [];
		let tokens = 0;
		const chunkStartLine = startLine + i;
		const chunkStartIdx = i;

		while (i < lines.length && tokens < TARGET_TOKENS) {
			const lineTokens = countTokens(lines[i]);
			chunkLines.push(lines[i]);
			tokens += lineTokens;
			i++;
		}

		chunks.push({ lines: chunkLines, startLine: chunkStartLine });

		// Step back for overlap, but guarantee forward progress
		if (i < lines.length) {
			let overlapTokens = 0;
			let overlapLines = 0;
			for (let j = chunkLines.length - 1; j >= 0 && overlapTokens < OVERLAP_TOKENS; j--) {
				overlapTokens += countTokens(chunkLines[j]);
				overlapLines++;
			}
			const newI = i - overlapLines;
			// Never step back to or before the chunk start — guarantees forward progress
			i = Math.max(newI, chunkStartIdx + 1);
		}
	}

	return chunks;
}

/** Approximate token count using word splitting */
function countTokens(text: string): number {
	return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}
