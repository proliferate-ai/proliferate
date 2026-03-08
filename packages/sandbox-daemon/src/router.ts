/**
 * HTTP router — platform transport APIs.
 *
 * /_proliferate/* -> platform transport APIs (PTY, FS, ports, health, events)
 * /*              -> dynamic reverse proxy to preview app
 *
 * Agent session routes are handled by Sandbox Agent on port 2468,
 * proxied via Caddy at /v1/*.
 *
 * Routes:
 *   GET  /_proliferate/health          -> health check
 *   GET  /_proliferate/events          -> SSE event stream
 *   GET  /_proliferate/pty/list        -> list PTY processes
 *   GET  /_proliferate/pty/replay      -> replay PTY output
 *   POST /_proliferate/pty/write       -> write to PTY
 *   GET  /_proliferate/fs/tree         -> file tree
 *   GET  /_proliferate/fs/read         -> read file
 *   POST /_proliferate/fs/write        -> write file
 *   GET  /_proliferate/ports           -> list active preview ports
 *   POST /_proliferate/token/refresh   -> token refresh
 */

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "@proliferate/logger";
import {
	authenticateRequest,
	parseSignatureHeader,
	setSessionToken,
	validateSignature,
} from "./auth.js";
import type { EventBus } from "./event-bus.js";
import { FsSecurityError, type FsTransport } from "./fs.js";
import type { PortWatcher } from "./ports.js";
import type { PreviewProxy } from "./preview-proxy.js";
import type { PtyTransport } from "./pty.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(json),
	});
	res.end(json);
}

function parseQuery(url: string): URLSearchParams {
	const qIdx = url.indexOf("?");
	return new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");
}

function getPathname(url: string): string {
	const qIdx = url.indexOf("?");
	return qIdx >= 0 ? url.slice(0, qIdx) : url;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface RouterOptions {
	eventBus: EventBus;
	ptyTransport: PtyTransport;
	fsTransport: FsTransport;
	portWatcher: PortWatcher;
	previewProxy: PreviewProxy;
	logger: Logger;
}

export class Router {
	private readonly eventBus: EventBus;
	private readonly pty: PtyTransport;
	private readonly fs: FsTransport;
	private readonly portWatcher: PortWatcher;
	private readonly preview: PreviewProxy;
	private readonly logger: Logger;

	constructor(options: RouterOptions) {
		this.eventBus = options.eventBus;
		this.pty = options.ptyTransport;
		this.fs = options.fsTransport;
		this.portWatcher = options.portWatcher;
		this.preview = options.previewProxy;
		this.logger = options.logger.child({ module: "router" });
	}

	/**
	 * Handle an HTTP request. Returns true if handled.
	 */
	handleRequest(req: IncomingMessage, res: ServerResponse): void {
		const url = req.url ?? "/";
		const pathname = getPathname(url);

		if (pathname.startsWith("/_proliferate/")) {
			this.handlePlatformRoute(req, res, pathname, url);
		} else {
			this.handlePreviewRoute(req, res);
		}
	}

	// -----------------------------------------------------------------------
	// Platform routes (/_proliferate/*)
	// -----------------------------------------------------------------------

	private async handlePlatformRoute(
		req: IncomingMessage,
		res: ServerResponse,
		pathname: string,
		url: string,
	): Promise<void> {
		// Health endpoint does NOT require auth
		if (pathname === "/_proliferate/health" && req.method === "GET") {
			this.handleHealth(res);
			return;
		}

		// Token refresh does NOT require auth — only accessible from inside the
		// sandbox (localhost) and needed to rotate the token after snapshot resume.
		if (pathname === "/_proliferate/token/refresh" && req.method === "POST") {
			this.handleTokenRefresh(req, res);
			return;
		}

		// All other platform routes require auth
		if (!authenticateRequest(req, res)) {
			return;
		}

		// Validate signature if present (gateway-signed requests)
		const sigHeader = req.headers["x-proliferate-sandbox-signature"] as string | undefined;
		if (sigHeader) {
			const components = parseSignatureHeader(sigHeader);
			if (components) {
				const hasBody = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
				if (hasBody) {
					const body = await readBody(req);
					const bodyHash = createHash("sha256").update(body).digest("hex");
					if (!validateSignature(req.method ?? "GET", pathname, bodyHash, components)) {
						sendJson(res, 403, { error: "Invalid signature" });
						return;
					}
					(req as IncomingMessage & { _body?: string })._body = body;
				} else {
					const bodyHash = createHash("sha256").update("").digest("hex");
					if (!validateSignature(req.method ?? "GET", pathname, bodyHash, components)) {
						sendJson(res, 403, { error: "Invalid signature" });
						return;
					}
				}
			}
		}

		const query = parseQuery(url);

		switch (pathname) {
			case "/_proliferate/events":
				if (req.method === "GET") {
					this.handleEventsStream(req, res, query);
					return;
				}
				break;
			case "/_proliferate/pty/list":
				if (req.method === "GET") {
					this.handlePtyList(res);
					return;
				}
				break;
			case "/_proliferate/pty/replay":
				if (req.method === "GET") {
					this.handlePtyReplay(res, query);
					return;
				}
				break;
			case "/_proliferate/pty/write":
				if (req.method === "POST") {
					this.handlePtyWrite(req, res);
					return;
				}
				break;
			case "/_proliferate/fs/tree":
				if (req.method === "GET") {
					this.handleFsTree(res, query);
					return;
				}
				break;
			case "/_proliferate/fs/read":
				if (req.method === "GET") {
					this.handleFsRead(res, query);
					return;
				}
				break;
			case "/_proliferate/fs/write":
				if (req.method === "POST") {
					this.handleFsWrite(req, res);
					return;
				}
				break;
			case "/_proliferate/ports":
				if (req.method === "GET") {
					this.handlePorts(res);
					return;
				}
				break;
			// token/refresh handled before auth check above
		}

		this.logger.debug({ pathname, method: req.method }, "Unmatched platform route");
		sendJson(res, 404, { error: "Not found" });
	}

	// -----------------------------------------------------------------------
	// Health
	// -----------------------------------------------------------------------

	private handleHealth(res: ServerResponse): void {
		sendJson(res, 200, {
			status: "ok",
			ports: this.portWatcher.getActivePorts(),
			seq: this.eventBus.getSeq(),
		});
	}

	// -----------------------------------------------------------------------
	// Events SSE
	// -----------------------------------------------------------------------

	private handleEventsStream(
		req: IncomingMessage,
		res: ServerResponse,
		query: URLSearchParams,
	): void {
		const lastSeqStr = query.get("last_seq");
		const lastSeq = lastSeqStr ? Number.parseInt(lastSeqStr, 10) : 0;

		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});

		// Send current state as initial payload
		const initialPayload = {
			type: "init",
			seq: this.eventBus.getSeq(),
			ports: this.portWatcher.getActivePorts(),
		};
		res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);

		// Subscribe to future events
		const unsubscribe = this.eventBus.subscribe((event) => {
			if (lastSeq > 0 && event.seq <= lastSeq) return;
			res.write(`data: ${JSON.stringify(event)}\n\n`);
		});

		// Keep-alive heartbeat every 15s
		const heartbeat = setInterval(() => {
			res.write(":heartbeat\n\n");
		}, 15_000);

		const cleanup = () => {
			unsubscribe();
			clearInterval(heartbeat);
		};

		req.on("close", cleanup);
		req.on("error", cleanup);
	}

	// -----------------------------------------------------------------------
	// PTY
	// -----------------------------------------------------------------------

	private handlePtyList(res: ServerResponse): void {
		sendJson(res, 200, { processes: this.pty.listProcesses() });
	}

	private handlePtyReplay(res: ServerResponse, query: URLSearchParams): void {
		const processId = query.get("process_id");
		if (!processId) {
			sendJson(res, 400, { error: "process_id is required" });
			return;
		}

		const lastSeqStr = query.get("last_seq");
		const lastSeq = lastSeqStr ? Number.parseInt(lastSeqStr, 10) : 0;

		const lines = this.pty.replay(processId, lastSeq);
		sendJson(res, 200, {
			processId,
			latestSeq: this.pty.getLatestSeq(processId),
			lines,
		});
	}

	private handlePtyWrite(req: IncomingMessage, res: ServerResponse): void {
		const preRead = (req as IncomingMessage & { _body?: string })._body;
		(preRead !== undefined ? Promise.resolve(preRead) : readBody(req))
			.then((body) => {
				const parsed = JSON.parse(body) as { processId: string; data: string };
				if (!parsed.processId || typeof parsed.data !== "string") {
					sendJson(res, 400, { error: "processId and data are required" });
					return;
				}
				this.pty.writeOutput(parsed.processId, parsed.data);
				sendJson(res, 200, { ok: true });
			})
			.catch((err) => {
				sendJson(res, 400, { error: err instanceof Error ? err.message : "Invalid request" });
			});
	}

	// -----------------------------------------------------------------------
	// FS
	// -----------------------------------------------------------------------

	private handleFsTree(res: ServerResponse, query: URLSearchParams): void {
		const path = query.get("path") ?? ".";
		const depth = Number.parseInt(query.get("depth") ?? "1", 10);

		try {
			const entries = this.fs.tree(path, depth);
			sendJson(res, 200, { entries });
		} catch (err) {
			if (err instanceof FsSecurityError) {
				sendJson(res, 403, { error: err.message });
			} else {
				sendJson(res, 500, { error: err instanceof Error ? err.message : "Unknown error" });
			}
		}
	}

	private handleFsRead(res: ServerResponse, query: URLSearchParams): void {
		const path = query.get("path");
		const format = query.get("format");
		if (!path) {
			sendJson(res, 400, { error: "path is required" });
			return;
		}

		try {
			const result = format === "base64" ? this.fs.readBinary(path) : this.fs.read(path);
			sendJson(res, 200, result);
		} catch (err) {
			if (err instanceof FsSecurityError) {
				sendJson(res, 403, { error: err.message });
			} else {
				const status = err instanceof Error && err.message.includes("not found") ? 404 : 500;
				sendJson(res, status, { error: err instanceof Error ? err.message : "Unknown error" });
			}
		}
	}

	private handleFsWrite(req: IncomingMessage, res: ServerResponse): void {
		const preRead = (req as IncomingMessage & { _body?: string })._body;
		(preRead !== undefined ? Promise.resolve(preRead) : readBody(req))
			.then(async (body) => {
				const parsed = JSON.parse(body) as { path: string; content: string };
				if (!parsed.path || typeof parsed.content !== "string") {
					sendJson(res, 400, { error: "path and content are required" });
					return;
				}
				const result = await this.fs.write(parsed.path, parsed.content);
				sendJson(res, 200, result);
			})
			.catch((err) => {
				if (err instanceof FsSecurityError) {
					sendJson(res, 403, { error: err.message });
				} else {
					sendJson(res, 400, { error: err instanceof Error ? err.message : "Invalid request" });
				}
			});
	}

	// -----------------------------------------------------------------------
	// Ports
	// -----------------------------------------------------------------------

	private handlePorts(res: ServerResponse): void {
		sendJson(res, 200, { ports: this.portWatcher.getActivePorts() });
	}

	// -----------------------------------------------------------------------
	// Token refresh
	// -----------------------------------------------------------------------

	private handleTokenRefresh(req: IncomingMessage, res: ServerResponse): void {
		const preRead = (req as IncomingMessage & { _body?: string })._body;
		(preRead !== undefined ? Promise.resolve(preRead) : readBody(req))
			.then((body) => {
				const parsed = JSON.parse(body) as { token?: string; ttlMinutes?: number };
				if (!parsed.token || typeof parsed.token !== "string") {
					sendJson(res, 400, { error: "token is required" });
					return;
				}
				const ttl = typeof parsed.ttlMinutes === "number" ? parsed.ttlMinutes : 60;
				setSessionToken(parsed.token, ttl);
				this.logger.info({ ttlMinutes: ttl }, "Session token rotated via refresh");
				sendJson(res, 200, { ok: true });
			})
			.catch((err) => {
				sendJson(res, 400, { error: err instanceof Error ? err.message : "Invalid request" });
			});
	}

	// -----------------------------------------------------------------------
	// Preview route (default)
	// -----------------------------------------------------------------------

	private handlePreviewRoute(req: IncomingMessage, res: ServerResponse): void {
		if (!this.preview.handleRequest(req, res)) {
			sendJson(res, 503, {
				error: "No preview port available",
				hint: "Start a dev server on a port between 3000-9999",
			});
		}
	}
}
