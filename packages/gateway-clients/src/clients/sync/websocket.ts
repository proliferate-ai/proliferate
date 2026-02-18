/**
 * SyncClient WebSocket Connection
 *
 * WebSocket with automatic reconnection for real-time communication.
 */

import type { ServerMessage } from "@proliferate/shared";
import WS from "ws";
import type { TokenGetter } from "../../auth";
import type { ConnectionOptions, ReconnectOptions } from "../../types";

// Use native WebSocket in browser, 'ws' in Node
const WebSocketImpl = typeof WebSocket !== "undefined" ? WebSocket : WS;

/**
 * WebSocket interface for SyncClient
 */
export interface SyncWebSocket {
	/** Send a prompt message */
	sendPrompt(content: string, images?: string[]): void;
	/** Send a cancel message */
	sendCancel(): void;
	/** Send a ping */
	sendPing(): void;
	/** Send a save snapshot request */
	sendSaveSnapshot(message?: string): void;
	/** Send a run auto-start test request */
	sendRunAutoStart(
		runId: string,
		mode?: "test" | "start",
		commands?: import("@proliferate/shared").ConfigurationServiceCommand[],
	): void;
	/** Request current git status */
	sendGetGitStatus(workspacePath?: string): void;
	/** Create and checkout a new branch */
	sendGitCreateBranch(branchName: string, workspacePath?: string): void;
	/** Stage and commit changes */
	sendGitCommit(
		message: string,
		opts?: { includeUntracked?: boolean; files?: string[]; workspacePath?: string },
	): void;
	/** Push to remote */
	sendGitPush(workspacePath?: string): void;
	/** Push and create a pull request */
	sendGitCreatePr(title: string, body?: string, baseBranch?: string, workspacePath?: string): void;
	/** Close the connection (no reconnect) */
	close(): void;
	/** Force reconnect now */
	reconnect(): void;
	/** Whether currently connected */
	readonly isConnected: boolean;
}

const DEFAULT_RECONNECT: Required<ReconnectOptions> = {
	maxAttempts: 10,
	baseDelay: 1000,
	maxDelay: 30000,
	backoffMultiplier: 2,
};

/**
 * Extended connection options for WebSocket
 */
export interface WebSocketOptions extends ConnectionOptions {
	/** Reconnection options (default: enabled) */
	reconnect?: boolean | ReconnectOptions;
}

/**
 * WebSocket implementation with reconnection logic
 */
export class SyncWebSocketImpl implements SyncWebSocket {
	private ws: InstanceType<typeof WebSocketImpl> | null = null;
	private baseUrl: string;
	private proliferateSessionId: string;
	private getToken: TokenGetter;
	private options: WebSocketOptions;
	private reconnectConfig: Required<ReconnectOptions>;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingInterval: ReturnType<typeof setInterval> | null = null;
	private intentionallyClosed = false;

	constructor(
		baseUrl: string,
		proliferateSessionId: string,
		getToken: TokenGetter,
		options: WebSocketOptions,
	) {
		this.baseUrl = baseUrl;
		this.proliferateSessionId = proliferateSessionId;
		this.getToken = getToken;
		this.options = options;

		// Parse reconnect options
		if (options.reconnect === false) {
			this.reconnectConfig = { ...DEFAULT_RECONNECT, maxAttempts: 0 };
		} else if (typeof options.reconnect === "object") {
			this.reconnectConfig = { ...DEFAULT_RECONNECT, ...options.reconnect };
		} else {
			this.reconnectConfig = DEFAULT_RECONNECT;
		}

		// Start connection
		this.connect();
	}

	get isConnected(): boolean {
		return this.ws?.readyState === WebSocketImpl.OPEN;
	}

	sendPrompt(content: string, images?: string[]): void {
		console.log("[SyncClient] sendPrompt:", {
			contentLen: content.length,
			imageCount: images?.length,
		});
		this.send({ type: "prompt", content, images });
	}

	sendCancel(): void {
		this.send({ type: "cancel" });
	}

	sendPing(): void {
		this.send({ type: "ping" });
	}

	sendSaveSnapshot(message?: string): void {
		this.send({ type: "save_snapshot", message });
	}

	sendRunAutoStart(
		runId: string,
		mode?: "test" | "start",
		commands?: import("@proliferate/shared").ConfigurationServiceCommand[],
	): void {
		this.send({ type: "run_auto_start", runId, mode, commands });
	}

	sendGetGitStatus(workspacePath?: string): void {
		this.send({ type: "get_git_status", ...(workspacePath && { workspacePath }) });
	}

	sendGitCreateBranch(branchName: string, workspacePath?: string): void {
		this.send({ type: "git_create_branch", branchName, ...(workspacePath && { workspacePath }) });
	}

	sendGitCommit(
		message: string,
		opts?: { includeUntracked?: boolean; files?: string[]; workspacePath?: string },
	): void {
		this.send({
			type: "git_commit",
			message,
			...(opts?.includeUntracked && { includeUntracked: true }),
			...(opts?.files && { files: opts.files }),
			...(opts?.workspacePath && { workspacePath: opts.workspacePath }),
		});
	}

	sendGitPush(workspacePath?: string): void {
		this.send({ type: "git_push", ...(workspacePath && { workspacePath }) });
	}

	sendGitCreatePr(title: string, body?: string, baseBranch?: string, workspacePath?: string): void {
		this.send({
			type: "git_create_pr",
			title,
			...(body && { body }),
			...(baseBranch && { baseBranch }),
			...(workspacePath && { workspacePath }),
		});
	}

	close(): void {
		this.intentionallyClosed = true;
		this.clearTimers();
		this.ws?.close();
	}

	reconnect(): void {
		this.reconnectAttempt = 0;
		this.ws?.close();
		this.connect();
	}

	private async connect(): Promise<void> {
		try {
			const token = await this.getToken();
			const wsUrl = this.buildWebSocketUrl(token);

			this.ws = new WebSocketImpl(wsUrl);

			this.ws.onopen = () => {
				this.reconnectAttempt = 0;
				this.startPingInterval();
				this.options.onOpen?.();
			};

			this.ws.onmessage = (event: { data: unknown }) => {
				this.handleMessage(String(event.data));
			};

			this.ws.onclose = (event: { code: number; reason?: string | Buffer }) => {
				this.clearTimers();
				const code = event.code;
				const reason = event.reason ? String(event.reason) : undefined;

				this.options.onClose?.(code, reason);

				if (!this.intentionallyClosed) {
					this.scheduleReconnect();
				}
			};

			this.ws.onerror = () => {
				// Error will be followed by close event
			};
		} catch (err) {
			console.error("[SyncClient] Connection error:", err);
			this.scheduleReconnect();
		}
	}

	private buildWebSocketUrl(token: string): string {
		const wsBase = this.baseUrl.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
		// Updated to use /proliferate route
		return `${wsBase}/proliferate/${this.proliferateSessionId}?token=${encodeURIComponent(token)}`;
	}

	private handleMessage(data: string): void {
		try {
			const event = JSON.parse(data) as ServerMessage;
			this.options.onEvent?.(event);
		} catch (err) {
			console.error("[SyncClient] Failed to parse message:", err);
		}
	}

	private send(message: Record<string, unknown>): void {
		if (!this.isConnected) {
			console.warn("[SyncClient] Cannot send - not connected");
			return;
		}
		this.ws?.send(JSON.stringify(message));
	}

	private scheduleReconnect(): void {
		if (this.reconnectConfig.maxAttempts === 0) return;
		if (this.reconnectAttempt >= this.reconnectConfig.maxAttempts) {
			this.options.onReconnectFailed?.();
			return;
		}

		const delay = Math.min(
			this.reconnectConfig.baseDelay *
				this.reconnectConfig.backoffMultiplier ** this.reconnectAttempt,
			this.reconnectConfig.maxDelay,
		);

		this.reconnectTimer = setTimeout(() => {
			this.reconnectAttempt++;
			this.options.onReconnect?.(this.reconnectAttempt);
			this.connect();
		}, delay);
	}

	private startPingInterval(): void {
		this.pingInterval = setInterval(() => {
			if (this.isConnected) {
				this.sendPing();
			}
		}, 30000);
	}

	private clearTimers(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}
}
