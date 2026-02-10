import { execFile } from "node:child_process";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { createLogger } from "@proliferate/logger";
import express, { type Request, type Response } from "express";

const execFileAsync = promisify(execFile);

const logger = createLogger({ service: "sandbox-mcp" }).child({ module: "api-server" });
import {
	exposePort,
	getExposedPort,
	getLogFilePath,
	getServices,
	startService,
	stopService,
} from "./service-manager.js";

import { validateBearerToken } from "./auth.js";

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

function checkAuth(req: Request, res: Response, next: () => void): void {
	if (!validateBearerToken(req.headers.authorization)) {
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

// ============================================
// Git endpoints
// ============================================

const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? "/home/user/workspace";
const MAX_DIFF_BYTES = 64 * 1024;

/** Validate that a resolved path is inside the workspace directory (dereferences symlinks). */
function validateInsideWorkspace(resolved: string): boolean {
	try {
		const real = realpathSync(resolved);
		const realWorkspace = realpathSync(WORKSPACE_DIR);
		return real === realWorkspace || real.startsWith(`${realWorkspace}/`);
	} catch {
		// Path doesn't exist yet — fall back to string prefix check
		return resolved === WORKSPACE_DIR || resolved.startsWith(`${WORKSPACE_DIR}/`);
	}
}

/** Decode a base64-encoded repo ID back to a path, validate it's in workspace. */
function decodeRepoId(repoId: string): string | null {
	try {
		const decoded = Buffer.from(repoId, "base64").toString("utf-8");
		const resolved = path.resolve(decoded);
		if (!validateInsideWorkspace(resolved)) return null;
		return resolved;
	} catch {
		return null;
	}
}

// Discover git repos under workspace
app.get("/api/git/repos", checkAuth, async (_req: Request, res: Response) => {
	try {
		const { stdout } = await execFileAsync(
			"find",
			[WORKSPACE_DIR, "-maxdepth", "3", "-name", ".git", "-type", "d"],
			{ timeout: 5000 },
		);
		const repos = stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((gitDir) => {
				const repoPath = path.dirname(gitDir);
				if (!validateInsideWorkspace(repoPath)) return null;
				return {
					id: Buffer.from(repoPath).toString("base64"),
					path: repoPath,
				};
			})
			.filter(Boolean);
		res.json({ repos });
	} catch (error) {
		res.status(500).json({ error: (error as Error).message });
	}
});

// Git status for a repo
app.get("/api/git/status", checkAuth, async (req: Request, res: Response) => {
	const repoId = req.query.repo as string;
	if (!repoId) {
		res.status(400).json({ error: "repo query parameter is required" });
		return;
	}

	const repoPath = decodeRepoId(repoId);
	if (!repoPath) {
		res.status(400).json({ error: "Invalid repo ID" });
		return;
	}

	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", repoPath, "status", "--porcelain=v2", "--branch"],
			{ timeout: 10000 },
		);

		const lines = stdout.split("\n");
		let branch = "";
		let ahead = 0;
		let behind = 0;
		const files: Array<{ status: string; path: string }> = [];

		for (const line of lines) {
			if (line.startsWith("# branch.head ")) {
				branch = line.slice("# branch.head ".length);
			} else if (line.startsWith("# branch.ab ")) {
				const match = line.match(/\+(\d+) -(\d+)/);
				if (match) {
					ahead = Number.parseInt(match[1], 10);
					behind = Number.parseInt(match[2], 10);
				}
			} else if (line.startsWith("1 ")) {
				// Changed entry: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
				const fields = line.split(" ");
				const xy = fields[1] || "M.";
				const filePath = fields.slice(8).join(" ");
				files.push({ status: xy, path: filePath });
			} else if (line.startsWith("2 ")) {
				// Renamed/copied: 2 <XY> ... <path>\t<origPath>
				const tabParts = line.split("\t");
				const fields = tabParts[0].split(" ");
				const xy = fields[1] || "R.";
				const filePath = tabParts[1] || fields.slice(9).join(" ");
				files.push({ status: xy, path: filePath });
			} else if (line.startsWith("? ")) {
				// Untracked
				const filePath = line.slice(2);
				files.push({ status: "?", path: filePath });
			}
		}

		res.json({ branch, ahead, behind, files });
	} catch (error) {
		res.status(500).json({ error: (error as Error).message });
	}
});

// Git diff for a file or whole repo
app.get("/api/git/diff", checkAuth, async (req: Request, res: Response) => {
	const repoId = req.query.repo as string;
	const filePath = req.query.path as string | undefined;

	if (!repoId) {
		res.status(400).json({ error: "repo query parameter is required" });
		return;
	}

	const repoPath = decodeRepoId(repoId);
	if (!repoPath) {
		res.status(400).json({ error: "Invalid repo ID" });
		return;
	}

	// Validate file path if provided (no directory traversal or symlink escape)
	if (filePath) {
		const resolved = path.resolve(repoPath, filePath);
		try {
			const realResolved = realpathSync(resolved);
			const realRepo = realpathSync(repoPath);
			if (!realResolved.startsWith(`${realRepo}/`)) {
				res.status(400).json({ error: "Invalid file path" });
				return;
			}
		} catch {
			// File may not exist yet; fall back to string prefix check
			if (!resolved.startsWith(`${repoPath}/`)) {
				res.status(400).json({ error: "Invalid file path" });
				return;
			}
		}
	}

	try {
		// Try diff against HEAD first; fall back to plain diff for repos with no commits
		let stdout: string;
		try {
			const args = ["-C", repoPath, "diff", "HEAD"];
			if (filePath) args.push("--", filePath);
			({ stdout } = await execFileAsync("git", args, {
				timeout: 10000,
				maxBuffer: MAX_DIFF_BYTES * 2,
			}));
		} catch {
			const args = ["-C", repoPath, "diff"];
			if (filePath) args.push("--", filePath);
			({ stdout } = await execFileAsync("git", args, {
				timeout: 10000,
				maxBuffer: MAX_DIFF_BYTES * 2,
			}));
		}

		// Cap output
		const diff =
			stdout.length > MAX_DIFF_BYTES
				? `${stdout.slice(0, MAX_DIFF_BYTES)}\n...[truncated]`
				: stdout;

		res.json({ diff });
	} catch (error) {
		res.status(500).json({ error: (error as Error).message });
	}
});

export function startApiServer(port = 4000): import("http").Server {
	const server = app.listen(port, "0.0.0.0", () => {
		logger.info({ port }, "API server listening");
	});
	return server;
}
