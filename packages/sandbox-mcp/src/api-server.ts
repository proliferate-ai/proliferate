import { createReadStream, existsSync, statSync } from "node:fs";
import { env } from "@proliferate/environment/server";
import express, { type Request, type Response } from "express";
import {
	exposePort,
	getExposedPort,
	getLogFilePath,
	getServices,
	startService,
	stopService,
} from "./service-manager.js";

const app = express();

// CORS - allow requests from any origin (for sandbox UI)
app.use((_req, res, next) => {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
	res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
	if (_req.method === "OPTIONS") {
		res.sendStatus(200);
		return;
	}
	next();
});

app.use(express.json());

const AUTH_TOKEN = env.SERVICE_TO_SERVICE_AUTH_TOKEN;

function checkAuth(req: Request, res: Response, next: () => void): void {
	// Allow unauthenticated access if no token configured
	if (!AUTH_TOKEN) {
		next();
		return;
	}

	const authHeader = req.headers.authorization;
	if (!authHeader?.startsWith("Bearer ")) {
		res.status(401).json({ error: "Unauthorized" });
		return;
	}

	const token = authHeader.slice(7);
	if (token !== AUTH_TOKEN) {
		res.status(401).json({ error: "Unauthorized" });
		return;
	}

	next();
}

// Health check endpoint (no auth required)
app.get("/api/health", (_req: Request, res: Response) => {
	res.json({ status: "ok" });
});

// List all services
app.get("/api/services", checkAuth, (_req: Request, res: Response) => {
	try {
		const services = getServices();
		res.json({ services, exposedPort: getExposedPort() });
	} catch (error) {
		res.status(500).json({ error: (error as Error).message });
	}
});

// Start a service
app.post("/api/services", checkAuth, async (req: Request, res: Response) => {
	try {
		const { name, command, cwd } = req.body;
		if (!name || !command) {
			res.status(400).json({ error: "name and command are required" });
			return;
		}
		const service = await startService({ name, command, cwd });
		res.json({ service });
	} catch (error) {
		res.status(500).json({ error: (error as Error).message });
	}
});

// Stop a service
app.delete("/api/services/:name", checkAuth, async (req: Request, res: Response) => {
	try {
		await stopService({ name: req.params.name });
		res.json({ success: true });
	} catch (error) {
		res.status(500).json({ error: (error as Error).message });
	}
});

// Expose a port
app.post("/api/expose", checkAuth, async (req: Request, res: Response) => {
	try {
		const { port } = req.body;
		if (typeof port !== "number") {
			res.status(400).json({ error: "port must be a number" });
			return;
		}
		await exposePort(port);
		res.json({ success: true, exposedPort: port });
	} catch (error) {
		res.status(500).json({ error: (error as Error).message });
	}
});

// Stream logs via SSE
app.get("/api/logs/:name", checkAuth, (req: Request, res: Response) => {
	const { name } = req.params;
	const logFile = getLogFilePath(name);

	if (!logFile || !existsSync(logFile)) {
		res.status(404).json({ error: `No logs found for service "${name}"` });
		return;
	}

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no");

	// Send initial file content (last 10KB)
	const fileSize = statSync(logFile).size;
	const startPosition = Math.max(0, fileSize - 10000);

	const initialStream = createReadStream(logFile, { start: startPosition });
	let buffer = "";

	initialStream.on("data", (chunk) => {
		buffer += chunk.toString();
	});

	initialStream.on("end", () => {
		if (buffer) {
			res.write(`data: ${JSON.stringify({ type: "initial", content: buffer })}\n\n`);
		}

		// Tail the file for new content
		let lastSize = fileSize;

		const checkForUpdates = (): void => {
			try {
				if (!existsSync(logFile)) return;

				const currentSize = statSync(logFile).size;
				if (currentSize > lastSize) {
					const tailStream = createReadStream(logFile, { start: lastSize });
					let newContent = "";

					tailStream.on("data", (chunk) => {
						newContent += chunk.toString();
					});

					tailStream.on("end", () => {
						if (newContent) {
							res.write(`data: ${JSON.stringify({ type: "append", content: newContent })}\n\n`);
						}
						lastSize = currentSize;
					});
				}
			} catch {
				// File might be deleted
			}
		};

		const interval = setInterval(checkForUpdates, 500);

		req.on("close", () => {
			clearInterval(interval);
		});
	});

	initialStream.on("error", (error) => {
		res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
		res.end();
	});
});

export function startApiServer(port = 4000): void {
	app.listen(port, "0.0.0.0", () => {
		console.log(`sandbox-mcp API server listening on port ${port}`);
	});
}
