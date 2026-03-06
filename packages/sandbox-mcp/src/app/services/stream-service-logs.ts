import { createReadStream, existsSync, statSync } from "node:fs";
import type { Request, Response } from "express";

const POLL_INTERVAL_MS = 500;
const INITIAL_WINDOW_BYTES = 10_000;

export function streamServiceLogs(req: Request, res: Response, logFile: string): void {
	if (!existsSync(logFile)) {
		res.status(404).json({ error: "No logs found" });
		return;
	}

	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no");

	const fileSize = statSync(logFile).size;
	const startPosition = Math.max(0, fileSize - INITIAL_WINDOW_BYTES);
	const initialStream = createReadStream(logFile, { start: startPosition });
	let buffer = "";

	initialStream.on("data", (chunk) => {
		buffer += chunk.toString();
	});

	initialStream.on("end", () => {
		if (buffer) {
			res.write(`data: ${JSON.stringify({ type: "initial", content: buffer })}\n\n`);
		}

		let lastSize = fileSize;
		const interval = setInterval(() => {
			try {
				if (!existsSync(logFile)) return;
				const currentSize = statSync(logFile).size;
				if (currentSize <= lastSize) return;

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
			} catch {
				// Ignore transient file errors.
			}
		}, POLL_INTERVAL_MS);

		req.on("close", () => {
			clearInterval(interval);
		});
	});

	initialStream.on("error", (error) => {
		res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
		res.end();
	});
}
