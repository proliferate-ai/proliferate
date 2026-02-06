/**
 * SyncClient HTTP Methods
 *
 * HTTP methods for the /proliferate routes.
 */

import type { ClientSource } from "@proliferate/shared";
import type { TokenGetter } from "../../auth";
import type {
	CreateSessionRequest,
	CreateSessionResponse,
	HttpClient,
	PostMessageOptions,
	SandboxInfo,
	SessionStatusResponse,
} from "../../types";

/**
 * Create an HTTP client for the gateway
 */
export function createHttpClient(baseUrl: string, getToken: TokenGetter): HttpClient {
	const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

	async function request<T>(
		path: string,
		options?: {
			method?: string;
			body?: unknown;
			isStream?: boolean;
			headers?: Record<string, string>;
		},
	): Promise<T> {
		const token = await getToken();
		const url = `${normalizedBaseUrl}${path}`;

		const response = await fetch(url, {
			method: options?.method || "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				...(options?.headers ?? {}),
			},
			body: options?.body ? JSON.stringify(options.body) : undefined,
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Gateway error: ${response.status} - ${errorText}`);
		}

		// Handle stream responses (for verification file downloads)
		if (options?.isStream || path.includes("stream=true")) {
			const contentType = response.headers.get("content-type") || "application/octet-stream";
			const data = await response.arrayBuffer();
			return { data, contentType } as T;
		}

		return response.json() as Promise<T>;
	}

	return {
		get<T>(path: string): Promise<T> {
			return request<T>(path);
		},
		post<T>(
			path: string,
			body?: unknown,
			options?: { headers?: Record<string, string> },
		): Promise<T> {
			return request<T>(path, { method: "POST", body, headers: options?.headers });
		},
	};
}

/**
 * Post a message to a session
 */
export async function postMessage(
	http: HttpClient,
	proliferateSessionId: string,
	options: PostMessageOptions,
	source?: ClientSource,
): Promise<void> {
	const headers = options.idempotencyKey
		? { "Idempotency-Key": options.idempotencyKey }
		: undefined;
	await http.post(
		`/proliferate/${proliferateSessionId}/message`,
		{
			type: "prompt",
			content: options.content,
			userId: options.userId,
			images: options.images,
			source: options.source ?? source,
		},
		{ headers },
	);
}

/**
 * Cancel the current operation
 */
export async function postCancel(
	http: HttpClient,
	proliferateSessionId: string,
	userId?: string,
): Promise<void> {
	await http.post(`/proliferate/${proliferateSessionId}/cancel`, { userId });
}

/**
 * Get session/sandbox info
 */
export async function getInfo(
	http: HttpClient,
	proliferateSessionId: string,
): Promise<SandboxInfo> {
	return http.get(`/proliferate/${proliferateSessionId}`);
}

/**
 * Health check
 */
export async function checkHealth(http: HttpClient): Promise<{ ok: boolean; latencyMs?: number }> {
	const start = Date.now();
	try {
		await http.get<{ status: string }>("/health");
		return { ok: true, latencyMs: Date.now() - start };
	} catch {
		return { ok: false };
	}
}

/**
 * Create a new session
 */
export async function createSession(
	http: HttpClient,
	request: CreateSessionRequest,
	options?: { idempotencyKey?: string },
): Promise<CreateSessionResponse> {
	const headers = options?.idempotencyKey
		? { "Idempotency-Key": options.idempotencyKey }
		: undefined;
	return http.post<CreateSessionResponse>("/proliferate/sessions", request, { headers });
}

/**
 * Get session status for finalizer checks
 */
export async function getSessionStatus(
	http: HttpClient,
	proliferateSessionId: string,
): Promise<SessionStatusResponse> {
	return http.get(`/proliferate/sessions/${proliferateSessionId}/status`);
}
