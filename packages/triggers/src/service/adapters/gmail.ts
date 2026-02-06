import { z } from "zod";
import type { GmailParsedContext, GmailTriggerConfig } from "../../types";
import { type OAuthConnection, type PollResult, PollingTrigger, type TriggerEvent } from "../base";

const gmailConfigSchema = z
	.object({
		labelIds: z.array(z.string()).optional(),
		includeSpamTrash: z.boolean().optional(),
		maxResults: z.number().int().positive().max(500).optional(),
		metadataHeaders: z.array(z.string()).optional(),
	})
	.passthrough();

const DEFAULT_GMAIL_HEADERS = ["Subject", "From", "To", "Date"];
const GMAIL_API_BASE = "https://gmail.googleapis.com";

interface GmailMessageHeader {
	name: string;
	value: string;
}

interface GmailMessage {
	id: string;
	threadId?: string;
	labelIds?: string[];
	snippet?: string;
	internalDate?: string;
	payload?: {
		headers?: GmailMessageHeader[];
	};
}

interface GmailProfileResponse {
	historyId?: string;
}

interface GmailHistoryResponse {
	historyId?: string;
	history?: Array<{
		messagesAdded?: Array<{ message?: GmailMessage }>;
	}>;
}

interface ComposioConnectedAccount {
	id?: string;
	status?: string;
	state?: {
		authScheme?: string;
		auth_scheme?: string;
		val?: Record<string, unknown> | string;
	};
}

interface TokenRef {
	value: string;
}

export interface GmailPollingTriggerOptions {
	apiKey: string;
	baseUrl?: string;
}

export class GmailPollingTrigger extends PollingTrigger<
	"gmail_message_received",
	GmailTriggerConfig
> {
	readonly id = "gmail_message_received" as const;
	readonly provider = "gmail" as const;
	readonly metadata = {
		name: "Gmail Message Received",
		description: "New Gmail message detected via polling",
		icon: "gmail",
	};
	readonly configSchema = gmailConfigSchema;

	private readonly apiKey: string;
	private readonly composioBaseUrl: string;
	private readonly gmailBaseUrl: string;

	constructor(options: GmailPollingTriggerOptions) {
		super();
		this.apiKey = options.apiKey;
		this.composioBaseUrl = options.baseUrl ?? "https://backend.composio.dev";
		this.gmailBaseUrl = GMAIL_API_BASE;
	}

	async poll(
		connection: OAuthConnection,
		config: GmailTriggerConfig,
		cursor: string | null,
	): Promise<PollResult> {
		const connectedAccountId = connection.connectionId ?? connection.accessToken;
		if (!connectedAccountId) {
			throw new Error("Missing Composio connected account ID for Gmail polling");
		}

		const tokenRef: TokenRef = { value: await this.getAccessToken(connectedAccountId) };

		if (!cursor) {
			const profile = await this.fetchProfile(connectedAccountId, tokenRef);
			return { events: [], cursor: profile.historyId ?? null };
		}

		let history: GmailHistoryResponse | null = null;
		try {
			history = await this.fetchHistory(connectedAccountId, tokenRef, cursor, config);
		} catch {
			// Reset cursor if history is too old or invalid
			const profile = await this.fetchProfile(connectedAccountId, tokenRef);
			return { events: [], cursor: profile.historyId ?? null };
		}

		const messageIds = new Set<string>();
		for (const entry of history?.history ?? []) {
			for (const added of entry.messagesAdded ?? []) {
				const id = added.message?.id;
				if (id) messageIds.add(id);
			}
		}

		if (messageIds.size === 0) {
			return { events: [], cursor: history?.historyId ?? cursor };
		}

		const messages = await this.fetchMessages(
			connectedAccountId,
			tokenRef,
			Array.from(messageIds),
			config,
		);

		const events = messages.map((message) => this.toEvent(message));
		return { events, cursor: history?.historyId ?? cursor };
	}

	filter(event: TriggerEvent, config: GmailTriggerConfig): boolean {
		const message = event.payload as GmailMessage;
		if (config.labelIds?.length) {
			const messageLabels = message.labelIds ?? [];
			if (!config.labelIds.some((label) => messageLabels.includes(label))) {
				return false;
			}
		}
		return true;
	}

	idempotencyKey(event: TriggerEvent): string {
		return `gmail:${event.externalId}`;
	}

	context(event: TriggerEvent): Record<string, unknown> {
		const message = event.payload as GmailMessage;
		return this.parseContext(message) as unknown as Record<string, unknown>;
	}

	private async fetchProfile(accountId: string, tokenRef: TokenRef): Promise<GmailProfileResponse> {
		return this.gmailRequest<GmailProfileResponse>(accountId, tokenRef, {
			endpoint: "/gmail/v1/users/me/profile",
			method: "GET",
		});
	}

	private async fetchHistory(
		accountId: string,
		tokenRef: TokenRef,
		startHistoryId: string,
		config: GmailTriggerConfig,
	): Promise<GmailHistoryResponse> {
		const parameters: Record<string, string | string[]> = {
			startHistoryId,
			historyTypes: "messageAdded",
		};
		if (config.labelIds?.length) {
			parameters.labelId = config.labelIds;
		}
		if (config.maxResults) {
			parameters.maxResults = String(config.maxResults);
		}
		return this.gmailRequest<GmailHistoryResponse>(accountId, tokenRef, {
			endpoint: "/gmail/v1/users/me/history",
			method: "GET",
			parameters,
		});
	}

	private async fetchMessages(
		accountId: string,
		tokenRef: TokenRef,
		messageIds: string[],
		config: GmailTriggerConfig,
	): Promise<GmailMessage[]> {
		const headers = config.metadataHeaders ?? DEFAULT_GMAIL_HEADERS;
		const results: GmailMessage[] = [];
		for (const messageId of messageIds) {
			try {
				const message = await this.gmailRequest<GmailMessage>(accountId, tokenRef, {
					endpoint: `/gmail/v1/users/me/messages/${messageId}`,
					method: "GET",
					parameters: {
						format: "metadata",
						metadataHeaders: headers,
					},
				});
				results.push(message);
			} catch {
				// Ignore individual message failures
			}
		}
		return results;
	}

	private async getAccessToken(connectedAccountId: string): Promise<string> {
		const account = await this.fetchConnectedAccount(connectedAccountId);
		const credentials = account.state?.val;

		if (!credentials || typeof credentials === "string") {
			throw new Error(
				"Composio credentials unavailable. Ensure connected account secrets are not masked.",
			);
		}

		const accessToken = findTokenValue(credentials);
		if (!accessToken || accessToken === "REDACTED") {
			throw new Error(
				"Composio credentials are masked. Disable 'Mask Connected Account Secrets' to use Gmail polling.",
			);
		}

		return accessToken;
	}

	private async fetchConnectedAccount(
		connectedAccountId: string,
	): Promise<ComposioConnectedAccount> {
		const response = await fetch(
			`${this.composioBaseUrl}/api/v3/connected_accounts/${connectedAccountId}`,
			{
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.apiKey,
				},
			},
		);

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Composio account error (${response.status}): ${text}`);
		}

		const json = (await response.json()) as { data?: ComposioConnectedAccount };
		return (json.data ?? json) as ComposioConnectedAccount;
	}

	private async gmailRequest<T>(
		accountId: string,
		tokenRef: TokenRef,
		options: {
			endpoint: string;
			method: string;
			parameters?: Record<string, unknown>;
			body?: Record<string, unknown>;
		},
		retried = false,
	): Promise<T> {
		const url = new URL(`${this.gmailBaseUrl}${options.endpoint}`);
		if (options.parameters) {
			for (const [key, value] of Object.entries(options.parameters)) {
				if (value === undefined || value === null) continue;
				if (Array.isArray(value)) {
					for (const item of value) {
						if (item !== undefined && item !== null) {
							url.searchParams.append(key, String(item));
						}
					}
				} else {
					url.searchParams.append(key, String(value));
				}
			}
		}

		const response = await fetch(url.toString(), {
			method: options.method,
			headers: {
				Authorization: `Bearer ${tokenRef.value}`,
				"Content-Type": "application/json",
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
		});

		if (response.status === 401 && !retried) {
			tokenRef.value = await this.getAccessToken(accountId);
			return this.gmailRequest(accountId, tokenRef, options, true);
		}

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Gmail API error (${response.status}): ${text}`);
		}

		return (await response.json()) as T;
	}

	private toEvent(message: GmailMessage): TriggerEvent {
		return {
			type: this.id,
			externalId: message.id,
			timestamp: message.internalDate ? new Date(Number(message.internalDate)) : new Date(),
			payload: message,
		};
	}

	private parseContext(message: GmailMessage): GmailParsedContext {
		const headers = message.payload?.headers ?? [];
		const getHeader = (name: string) =>
			headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

		return {
			messageId: message.id,
			threadId: message.threadId,
			subject: getHeader("Subject"),
			from: getHeader("From"),
			to: getHeader("To"),
			date: getHeader("Date"),
			snippet: message.snippet,
			labels: message.labelIds,
		};
	}
}

const TOKEN_KEYS = new Set(["access_token", "accessToken", "token", "oauth_token"]);

function findTokenValue(value: unknown, depth = 0): string | null {
	if (!value || depth > 4) return null;
	if (typeof value !== "object") return null;

	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (TOKEN_KEYS.has(key) && typeof entry === "string") {
			return entry;
		}
		if (entry && typeof entry === "object") {
			const nested = findTokenValue(entry, depth + 1);
			if (nested) return nested;
		}
	}

	return null;
}
