/**
 * Terminal WebSocket endpoint for sandbox-mcp.
 *
 * Provides an interactive PTY (bash) over WebSocket at /api/terminal.
 * Auth: requires Authorization: Bearer <token> at WS upgrade time.
 * No query-param auth — direct preview URL access from browser is blocked.
 *
 * Protocol:
 * - Client sends raw keystrokes as text frames
 * - Client can send JSON { type: "resize", cols: number, rows: number }
 * - Server sends PTY output as text frames
 */

import type { Server } from "node:http";
import { URL } from "node:url";
import { createLogger } from "@proliferate/logger";
import { type IPty, spawn as ptySpawn } from "node-pty";
import { type WebSocket, WebSocketServer } from "ws";
import { validateBearerToken } from "./auth.js";

const logger = createLogger({ service: "sandbox-mcp" }).child({ module: "terminal" });
const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "/home/user/workspace";

export function setupTerminalWebSocket(server: Server): void {
	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (req, socket, head) => {
		if (!req.url) return;

		const url = new URL(req.url, `http://${req.headers.host}`);
		if (url.pathname !== "/api/terminal") return;

		// Auth: Bearer token in Authorization header only (no query-param)
		if (!validateBearerToken(req.headers.authorization)) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			handleTerminalConnection(ws);
		});
	});

	logger.info("Terminal WebSocket endpoint registered at /api/terminal");
}

function handleTerminalConnection(ws: WebSocket): void {
	let pty: IPty;
	try {
		pty = ptySpawn("bash", [], {
			name: "xterm-256color",
			cols: 80,
			rows: 24,
			cwd: WORKSPACE_DIR,
			env: process.env as Record<string, string>,
		});
	} catch (err) {
		logger.error({ err }, "Failed to spawn PTY");
		ws.close(1011, "Failed to spawn terminal");
		return;
	}

	logger.info({ pid: pty.pid }, "Terminal PTY spawned");

	pty.onData((data) => {
		if (ws.readyState === ws.OPEN) {
			ws.send(data);
		}
	});

	pty.onExit(({ exitCode }) => {
		logger.info({ exitCode }, "Terminal PTY exited");
		if (ws.readyState === ws.OPEN) {
			ws.close(1000, "PTY exited");
		}
	});

	ws.on("message", (data) => {
		const str = data.toString();
		try {
			const parsed = JSON.parse(str);
			if (
				parsed.type === "resize" &&
				typeof parsed.cols === "number" &&
				typeof parsed.rows === "number"
			) {
				pty.resize(Math.max(1, parsed.cols), Math.max(1, parsed.rows));
				return;
			}
		} catch {
			// Not JSON — treat as keystroke
		}
		pty.write(str);
	});

	ws.on("close", () => {
		try {
			pty.kill();
		} catch {
			// Already dead
		}
	});
}
