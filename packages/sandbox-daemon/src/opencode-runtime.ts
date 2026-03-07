import { OPENCODE_HOST, OPENCODE_PORT } from "./config.js";

interface OpenCodeSessionInfo {
	id: string;
	title: string;
	time: {
		created: number;
		updated: number;
	};
}

interface OpenCodeMessage {
	info: {
		id: string;
		role: "user" | "assistant";
		time?: {
			created?: number;
			completed?: number;
		};
		error?: unknown;
	};
	parts: Array<Record<string, unknown>>;
}

function opencodeUrl(path: string): string {
	return `http://${OPENCODE_HOST}:${OPENCODE_PORT}${path}`;
}

async function parseErrorText(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return "";
	}
}

export async function createSession(title?: string): Promise<string> {
	const response = await fetch(opencodeUrl("/session"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(title ? { title } : {}),
	});
	if (!response.ok) {
		const text = await parseErrorText(response);
		throw new Error(`OpenCode create session failed (${response.status}): ${text}`);
	}
	const payload = (await response.json()) as { id: string };
	return payload.id;
}

export async function listSessions(): Promise<OpenCodeSessionInfo[]> {
	const response = await fetch(opencodeUrl("/session"));
	if (!response.ok) {
		const text = await parseErrorText(response);
		throw new Error(`OpenCode list sessions failed (${response.status}): ${text}`);
	}
	return (await response.json()) as OpenCodeSessionInfo[];
}

export async function hasSession(sessionId: string): Promise<boolean> {
	const response = await fetch(opencodeUrl(`/session/${encodeURIComponent(sessionId)}`));
	if (response.status === 404) {
		return false;
	}
	if (!response.ok) {
		const text = await parseErrorText(response);
		throw new Error(`OpenCode get session failed (${response.status}): ${text}`);
	}
	return true;
}

export async function listMessages(sessionId: string): Promise<OpenCodeMessage[]> {
	const response = await fetch(opencodeUrl(`/session/${encodeURIComponent(sessionId)}/message`));
	if (!response.ok) {
		const text = await parseErrorText(response);
		throw new Error(`OpenCode list messages failed (${response.status}): ${text}`);
	}
	return (await response.json()) as OpenCodeMessage[];
}

export async function sendPrompt(
	sessionId: string,
	content: string,
	images?: Array<{ data: string; mediaType: string }>,
): Promise<void> {
	const parts: Array<{
		type: string;
		text?: string;
		mime?: string;
		url?: string;
		filename?: string;
	}> = [{ type: "text", text: content }];

	for (const image of images || []) {
		parts.push({
			type: "file",
			mime: image.mediaType,
			url: `data:${image.mediaType};base64,${image.data}`,
			filename: "image.png",
		});
	}

	const response = await fetch(
		opencodeUrl(`/session/${encodeURIComponent(sessionId)}/prompt_async`),
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ parts }),
		},
	);
	if (!response.ok && response.status !== 204) {
		const text = await parseErrorText(response);
		throw new Error(`OpenCode prompt failed (${response.status}): ${text}`);
	}
}

export async function interrupt(sessionId: string): Promise<void> {
	const response = await fetch(opencodeUrl(`/session/${encodeURIComponent(sessionId)}/abort`), {
		method: "POST",
	});
	if (!response.ok) {
		const text = await parseErrorText(response);
		throw new Error(`OpenCode interrupt failed (${response.status}): ${text}`);
	}
}
