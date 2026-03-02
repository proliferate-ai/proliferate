/**
 * sandbox-daemon — PID 1 transport boundary inside sandboxes.
 *
 * Replaces direct OpenCode SSE connections with a unified, authenticated
 * daemon that routes platform transport and preview proxy traffic.
 *
 * Usage:
 *   sandbox-daemon --mode=worker   # Full: PTY + FS + preview + agent stream
 *   sandbox-daemon --mode=manager  # Lean: minimal transport, no FS/preview watchers
 *
 * The daemon should be launched via tini/dumb-init as PID 1 wrapper
 * for proper signal handling and child process reaping.
 */

import { createLogger } from "@proliferate/logger";
import { setSessionToken, setSignatureSecret } from "./auth.js";
import { TOKEN_TTL_MINUTES, loadConfig } from "./config.js";
import { EventBus } from "./event-bus.js";
import { FsTransport } from "./fs.js";
import { OpenCodeBridge } from "./opencode-bridge.js";
import { PortWatcher } from "./ports.js";
import { PreviewProxy } from "./preview-proxy.js";
import { PtyTransport } from "./pty.js";
import { Router } from "./router.js";
import { createDaemonServer } from "./server.js";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const config = loadConfig(process.argv);
const logger = createLogger({ service: "sandbox-daemon" });

logger.info(
	{ mode: config.mode, port: config.port, workspace: config.workspaceRoot },
	"Starting sandbox daemon",
);

// ---------------------------------------------------------------------------
// Auth setup (B7)
// ---------------------------------------------------------------------------

if (config.sessionToken) {
	setSessionToken(config.sessionToken, TOKEN_TTL_MINUTES);
	logger.info("Session token configured");
}

if (config.signatureSecret) {
	setSignatureSecret(config.signatureSecret);
	logger.info("Signature secret configured");
}

// ---------------------------------------------------------------------------
// Core subsystems
// ---------------------------------------------------------------------------

const eventBus = new EventBus();

const ptyTransport = new PtyTransport({ eventBus, logger });
const fsTransport = new FsTransport({
	workspaceRoot: config.workspaceRoot,
	eventBus,
	logger,
});
const portWatcher = new PortWatcher({ eventBus, logger });
const previewProxy = new PreviewProxy({ portWatcher, logger });

// ---------------------------------------------------------------------------
// OpenCode bridge (B2 — worker mode only)
// ---------------------------------------------------------------------------

let opencodeBridge: OpenCodeBridge | null = null;

if (config.mode === "worker") {
	opencodeBridge = new OpenCodeBridge({ eventBus, logger });
}

// ---------------------------------------------------------------------------
// Router (B1)
// ---------------------------------------------------------------------------

const router = new Router({
	eventBus,
	ptyTransport,
	fsTransport,
	portWatcher,
	previewProxy,
	logger,
	opencodeBridgeConnected: () => opencodeBridge?.isConnected() ?? false,
});

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createDaemonServer({
	config,
	router,
	previewProxy,
	logger,
});

// ---------------------------------------------------------------------------
// Start subsystems
// ---------------------------------------------------------------------------

async function startSubsystems(): Promise<void> {
	// Start port watcher (worker mode only, per spec)
	if (config.mode === "worker") {
		portWatcher.start();
		logger.info("Port watcher started");
	}

	// Start OpenCode bridge (worker mode only)
	if (opencodeBridge) {
		try {
			await opencodeBridge.start();
			logger.info("OpenCode bridge connected");
		} catch (err) {
			logger.error({ err }, "OpenCode bridge initial connection failed (will retry)");
			// Non-fatal: bridge will reconnect automatically
		}
	}

	eventBus.emitSystemEvent({ type: "daemon_ready", mode: config.mode });
	logger.info({ mode: config.mode }, "Daemon ready");
}

startSubsystems().catch((err) => {
	logger.error({ err }, "Failed to start subsystems");
});

// ---------------------------------------------------------------------------
// Signal handling (B1)
// ---------------------------------------------------------------------------

function shutdown(signal: string): void {
	logger.info({ signal }, "Shutting down daemon");

	opencodeBridge?.stop();
	portWatcher.stop();
	ptyTransport.clearAll();

	server.close(() => {
		logger.info("Daemon server closed");
		process.exit(0);
	});

	// Force exit after 5s if graceful shutdown stalls
	setTimeout(() => {
		logger.warn("Graceful shutdown timeout, forcing exit");
		process.exit(1);
	}, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Child process reaping — when running as PID 1, orphaned child processes
// send SIGCHLD. Reaping prevents zombie accumulation. In production, use
// tini/dumb-init as the actual PID 1 wrapper for robust reaping. This
// handler serves as a fallback for development.
process.on("SIGCHLD", () => {
	// Node.js automatically reaps direct children. This handler exists
	// as documentation and to prevent unhandled signal warnings.
});

// Prevent unhandled rejections from crashing the daemon
process.on("unhandledRejection", (reason) => {
	logger.error({ err: reason }, "Unhandled rejection in daemon");
});

// ---------------------------------------------------------------------------
// Exports for programmatic use (testing, gateway integration)
// ---------------------------------------------------------------------------

export { EventBus } from "./event-bus.js";
export { FsTransport, FsSecurityError } from "./fs.js";
export { OpenCodeBridge } from "./opencode-bridge.js";
export { PortWatcher } from "./ports.js";
export { PreviewProxy } from "./preview-proxy.js";
export { PtyTransport } from "./pty.js";
export { Router } from "./router.js";
export { createDaemonServer } from "./server.js";
export { loadConfig } from "./config.js";
export type { DaemonConfig, DaemonMode } from "./config.js";
export type { DaemonStreamEvent, EventSubscriber } from "./event-bus.js";
