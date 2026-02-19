/**
 * Prompt snippet sanitization.
 *
 * Transforms raw initialPrompt text into a clean, short snippet for display
 * in session list rows and command palette.
 *
 * See docs/session-display-redesign-spec.md — Prompt snippet sanitization.
 */

const MAX_PRE_SLICE = 2000;
const MAX_SNIPPET_LENGTH = 150;
const MIN_SNIPPET_LENGTH = 10;

const JSON_USEFUL_KEYS = new Set(["message", "content", "body", "description", "prompt", "text"]);

/**
 * Sanitize and truncate a raw prompt into a readable snippet.
 * Returns null if the result is empty or too short to be useful.
 */
export function sanitizePromptSnippet(rawPrompt: string | null | undefined): string | null {
	if (!rawPrompt) return null;

	// Step 0: Hard pre-slice to prevent ReDoS on huge inputs
	let text = rawPrompt.substring(0, MAX_PRE_SLICE);

	// Step 3 (early): JSON heuristic — try to extract useful content
	const trimmedStart = text.trimStart();
	if (trimmedStart.startsWith("{") || trimmedStart.startsWith("[")) {
		const extracted = tryExtractJsonContent(text);
		if (extracted) {
			text = extracted;
		} else {
			// Strip leading JSON noise: braces, brackets, quotes, key prefixes
			text = text.replace(/^[\s{["\]]+/, "").replace(/^"?\w+"?\s*:\s*"?/, "");
		}
	}

	// Step 1: Strip XML/HTML tags
	text = text.replace(/<[^>]*>/g, " ");

	// Step 2: Strip markdown formatting
	text = text
		.replace(/#{1,6}\s+/g, "") // headings
		.replace(/```[\s\S]*?```/g, " ") // fenced code blocks
		.replace(/`[^`]*`/g, " ") // inline code
		.replace(/\*{1,2}([^*]*)\*{1,2}/g, "$1") // bold/italic
		.replace(/_{1,2}([^_]*)_{1,2}/g, "$1") // underscored bold/italic
		.replace(/^\s*[-*+]\s+/gm, "") // list markers
		.replace(/^\s*\d+\.\s+/gm, "") // numbered list markers
		.replace(/^\s*>\s+/gm, "") // blockquotes
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"); // links/images

	// Step 4: Collapse whitespace
	text = text
		.replace(/[\n\r\t]+/g, " ")
		.replace(/\s{2,}/g, " ")
		.trim();

	if (!text || text.length < MIN_SNIPPET_LENGTH) return null;

	// Step 5 + 6: Truncate at nearest word boundary under limit
	if (text.length > MAX_SNIPPET_LENGTH) {
		const truncated = text.substring(0, MAX_SNIPPET_LENGTH);
		const lastSpace = truncated.lastIndexOf(" ");

		if (lastSpace > 0) {
			// Step 5: Word boundary truncation
			text = `${truncated.substring(0, lastSpace)}\u2026`;
		} else {
			// Step 7: Hard fallback — no space found (minified code, base64)
			text = `${truncated.substring(0, MAX_SNIPPET_LENGTH - 1)}\u2026`;
		}
	}

	return text.length < MIN_SNIPPET_LENGTH ? null : text;
}

/**
 * Try to parse JSON and extract the first useful string value.
 */
function tryExtractJsonContent(text: string): string | null {
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed !== "object" || parsed === null) return null;

		for (const key of JSON_USEFUL_KEYS) {
			const value = parsed[key];
			if (typeof value === "string" && value.trim().length > 0) {
				return value.trim();
			}
		}
	} catch {
		// Parse failed — caller handles fallback
	}
	return null;
}
