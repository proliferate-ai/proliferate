/**
 * sandbox-daemon — platform transport boundary inside sandboxes.
 *
 * Provides PTY, FS, ports, preview proxy, and platform SSE.
 * Agent lifecycle is managed by sandbox-agent (ACP protocol).
 *
 * Usage:
 *   sandbox-daemon
 *
 * The daemon should be launched via tini/dumb-init as PID 1 wrapper
 * for proper signal handling and child process reaping.
 */

import { createLogger } from "@proliferate/logger";
import { setSessionToken, setSignatureSecret } from "./auth.js";
import { TOKEN_TTL_MINUTES, loadConfig } from "./config.js";
import { EventBus } from "./event-bus.js";
import { FsTransport } from "./fs.js";
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

logger.info({ port: config.port, workspace: config.workspaceRoot }, "Starting sandbox daemon");

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
// Router (B1)
// ---------------------------------------------------------------------------

const router = new Router({
	eventBus,
	ptyTransport,
	fsTransport,
	portWatcher,
	previewProxy,
	logger,
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
	portWatcher.start();
	logger.info("Port watcher started");

	eventBus.emitSystemEvent({ type: "daemon_ready" });
	logger.info("Daemon ready");
}

startSubsystems().catch((err) => {
	logger.error({ err }, "Failed to start subsystems");
});

// ---------------------------------------------------------------------------
// Signal handling (B1)
// ---------------------------------------------------------------------------

function shutdown(signal: string): void {
	logger.info({ signal }, "Shutting down daemon");

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
export { PortWatcher } from "./ports.js";
export { PreviewProxy } from "./preview-proxy.js";
export { PtyTransport } from "./pty.js";
export { Router } from "./router.js";
export { createDaemonServer } from "./server.js";
export { loadConfig } from "./config.js";
export type { DaemonConfig } from "./config.js";
export type { DaemonStreamEvent, EventSubscriber } from "./event-bus.js";
