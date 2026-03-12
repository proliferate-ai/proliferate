/**
 * Gmail result normalizer.
 *
 * Converts opaque `proliferate actions run` result JSON into small
 * UI-facing models. Raw Composio response shapes are an implementation detail;
 * only the normalized types here are the UI contract.
 */

export interface GmailEmailRow {
	id: string;
	from: string | null;
	subject: string | null;
	date: string | null;
	snippet: string | null;
}

export interface GmailMessageDetail {
	id: string;
	from: string | null;
	to: string | null;
	subject: string | null;
	date: string | null;
	snippet: string | null;
}

export interface GmailMutationSummary {
	id: string;
}

export interface GmailMessageHandlesSummary {
	count: number;
	ids: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHeader(headers: unknown, name: string): string | null {
	if (!Array.isArray(headers)) return null;
	const lower = name.toLowerCase();
	const found = headers.find(
		(h) =>
			typeof h === "object" &&
			h !== null &&
			typeof (h as Record<string, unknown>).name === "string" &&
			((h as Record<string, string>).name as string).toLowerCase() === lower,
	);
	if (!found) return null;
	const val = (found as Record<string, unknown>).value;
	return typeof val === "string" ? val : null;
}

function safeParse(raw: unknown): unknown {
	if (typeof raw !== "string") return raw;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function unwrapData(parsed: unknown): unknown {
	if (!parsed || typeof parsed !== "object") return parsed;
	const obj = parsed as Record<string, unknown>;
	// Composio wraps results in { data: { ... } }
	if (obj.data && typeof obj.data === "object") return obj.data;
	return obj;
}

function extractMessageRecord(raw: unknown): Record<string, unknown> | null {
	if (!raw || typeof raw !== "object") return null;
	const parsed = unwrapData(raw);
	if (!parsed || typeof parsed !== "object") return null;
	return parsed as Record<string, unknown>;
}

function extractPayloadRecord(message: Record<string, unknown>): Record<string, unknown> | null {
	const directPayload =
		message.payload && typeof message.payload === "object"
			? (message.payload as Record<string, unknown>)
			: null;
	if (directPayload) return directPayload;

	const nestedMessage =
		message.message && typeof message.message === "object"
			? (message.message as Record<string, unknown>)
			: null;
	const nestedPayload =
		nestedMessage?.payload && typeof nestedMessage.payload === "object"
			? (nestedMessage.payload as Record<string, unknown>)
			: null;
	return nestedPayload;
}

function extractMessageArray(data: unknown): unknown[] | null {
	if (!data || typeof data !== "object") return null;
	const obj = data as Record<string, unknown>;
	if (Array.isArray(obj.messages)) return obj.messages;
	if (Array.isArray(obj.threads)) return obj.threads;
	if (Array.isArray(obj.drafts)) return obj.drafts;
	return null;
}

function extractIdentifier(message: Record<string, unknown>): string | null {
	if (typeof message.id === "string") return message.id;
	if (typeof message.messageId === "string") return message.messageId;
	if (typeof message.draftId === "string") return message.draftId;
	if (typeof message.threadId === "string") return message.threadId;
	return null;
}

function extractPreviewRecord(message: Record<string, unknown>): Record<string, unknown> | null {
	return message.preview && typeof message.preview === "object"
		? (message.preview as Record<string, unknown>)
		: null;
}

function parseRow(msg: unknown): GmailEmailRow | null {
	if (!msg || typeof msg !== "object") return null;
	const m = msg as Record<string, unknown>;
	const id = extractIdentifier(m);
	if (!id) return null;

	const payload = m.payload as Record<string, unknown> | undefined;
	const headers = payload?.headers;

	// For draft objects, message is nested
	const msgObj =
		m.message && typeof m.message === "object" ? (m.message as Record<string, unknown>) : null;
	const draftPayload = msgObj?.payload as Record<string, unknown> | undefined;
	const draftHeaders = draftPayload?.headers;

	const h = headers ?? draftHeaders;
	const preview = extractPreviewRecord(m);
	const snippet =
		typeof m.snippet === "string"
			? m.snippet
			: typeof preview?.body === "string"
				? preview.body
				: null;
	const from = h ? extractHeader(h, "From") : typeof m.sender === "string" ? m.sender : null;
	const subject = h
		? extractHeader(h, "Subject")
		: typeof m.subject === "string"
			? m.subject
			: typeof preview?.subject === "string"
				? preview.subject
				: null;
	const date = h
		? extractHeader(h, "Date")
		: typeof m.messageTimestamp === "string"
			? m.messageTimestamp
			: null;

	// Some Gmail actions only return ids/threadIds. Fall back to generic JSON
	// instead of rendering dozens of "Unknown sender" rows with no metadata.
	if (!from && !subject && !date && !snippet) return null;

	return {
		id,
		from,
		subject,
		date,
		snippet,
	};
}

// ---------------------------------------------------------------------------
// Public normalizers
// ---------------------------------------------------------------------------

/**
 * Normalize a raw `actions run` result for list-style Gmail actions
 * (GMAIL_FETCH_EMAILS, GMAIL_LIST_MESSAGES, GMAIL_LIST_THREADS, GMAIL_LIST_DRAFTS).
 * Returns null if the result cannot be parsed into rows.
 */
export function normalizeGmailMessageList(raw: unknown): GmailEmailRow[] | null {
	const parsed = unwrapData(safeParse(raw));
	const messages = extractMessageArray(parsed);
	if (!messages || messages.length === 0) return null;

	const rows = messages.map(parseRow).filter((r): r is GmailEmailRow => r !== null);
	return rows.length > 0 ? rows : null;
}

/**
 * Normalize a raw `actions run` result for single-message Gmail actions
 * (GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID, GMAIL_FETCH_MESSAGE_BY_THREAD_ID, GMAIL_GET_DRAFT).
 * Returns null if the result cannot be parsed.
 */
export function normalizeGmailMessageDetail(raw: unknown): GmailMessageDetail | null {
	const m = extractMessageRecord(safeParse(raw));
	if (!m) return null;

	const id = extractIdentifier(m);
	if (!id) return null;

	const payload = extractPayloadRecord(m);
	const headers = payload?.headers;
	const nestedMessage =
		m.message && typeof m.message === "object" ? (m.message as Record<string, unknown>) : null;
	const preview = extractPreviewRecord(m);
	const snippet =
		typeof m.snippet === "string"
			? m.snippet
			: typeof nestedMessage?.snippet === "string"
				? nestedMessage.snippet
				: typeof m.messageText === "string"
					? m.messageText
					: typeof preview?.body === "string"
						? preview.body
						: null;

	return {
		id,
		from: headers ? extractHeader(headers, "From") : typeof m.sender === "string" ? m.sender : null,
		to: headers ? extractHeader(headers, "To") : typeof m.to === "string" ? m.to : null,
		subject: headers
			? extractHeader(headers, "Subject")
			: typeof m.subject === "string"
				? m.subject
				: typeof preview?.subject === "string"
					? preview.subject
					: null,
		date: headers
			? extractHeader(headers, "Date")
			: typeof m.messageTimestamp === "string"
				? m.messageTimestamp
				: null,
		snippet,
	};
}

/**
 * Normalize compact mutation output for Gmail write actions.
 * Returns null when the result doesn't contain a stable summary shape.
 */
export function normalizeGmailMutationSummary(raw: unknown): GmailMutationSummary | null {
	const parsed = extractMessageRecord(safeParse(raw));
	if (!parsed) return null;

	const id = extractIdentifier(parsed);
	if (!id) return null;

	return { id };
}

/**
 * Normalize sparse Gmail list results that only provide ids/threadIds.
 * Useful for actions like GMAIL_LIST_MESSAGES where the provider returns
 * handles but not enough metadata for a full message preview list.
 */
export function normalizeGmailMessageHandles(raw: unknown): GmailMessageHandlesSummary | null {
	const parsed = unwrapData(safeParse(raw));
	const messages = extractMessageArray(parsed);
	if (!messages || messages.length === 0) return null;

	const ids = messages
		.map((msg) => {
			if (!msg || typeof msg !== "object") return null;
			return extractIdentifier(msg as Record<string, unknown>);
		})
		.filter((id): id is string => typeof id === "string" && id.length > 0);

	if (ids.length === 0) return null;

	return {
		count: ids.length,
		ids: ids.slice(0, 5),
	};
}
