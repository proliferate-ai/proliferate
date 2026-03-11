interface ProliferateCommandSegment {
	type: "command";
	command: string;
	actionLabel: string;
	url: string | null;
}

interface MarkdownSegment {
	type: "markdown";
	text: string;
}

export type AssistantContentSegment = ProliferateCommandSegment | MarkdownSegment;

export function getProliferateCommandFromLine(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) return null;

	const unwrapped = trimmed
		.replace(/^[-*]\s+/, "")
		.replace(/^\d+\.\s+/, "")
		.replace(/^`+|`+$/g, "");
	const match = unwrapped.match(/(?:^|\()((?:@?proliferate)\s+[^\n)`]+)/i);
	if (!match) return null;
	return match[1].replace(/^@/i, "").trim();
}

export function getProliferateActionLabel(command: string): string {
	const normalized = command.toLowerCase();
	if (normalized.includes("actions list")) return "List actions";
	if (normalized.includes("sentry action")) return "Run Sentry action";
	if (normalized.includes("create pr") || normalized.includes("pr create"))
		return "Create pull request";
	if (normalized.includes("env set")) return "Set environment values";
	if (normalized.includes("save_snapshot")) return "Save snapshot";
	return "Proliferate command";
}

export function parseAssistantContentSegments(text: string): AssistantContentSegment[] {
	const lines = text.split("\n");
	const segments: AssistantContentSegment[] = [];
	let markdownBuffer: string[] = [];

	const flushMarkdown = () => {
		const chunk = markdownBuffer.join("\n").trim();
		if (chunk) segments.push({ type: "markdown", text: chunk });
		markdownBuffer = [];
	};

	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		const command = getProliferateCommandFromLine(line);
		if (!command) {
			markdownBuffer.push(line);
			index += 1;
			continue;
		}

		flushMarkdown();
		let nextUrl: string | null = null;
		for (let lookAhead = index + 1; lookAhead < Math.min(lines.length, index + 4); lookAhead += 1) {
			const urlMatch = lines[lookAhead].match(/https?:\/\/\S+/i);
			if (urlMatch) {
				nextUrl = urlMatch[0];
				index = lookAhead;
				break;
			}
			if (!lines[lookAhead].trim()) break;
		}

		segments.push({
			type: "command",
			command,
			actionLabel: getProliferateActionLabel(command),
			url: nextUrl,
		});
		index += 1;
	}

	flushMarkdown();
	return segments;
}
