import { Router } from "express";
import {
	exposePort,
	getExposedPort,
	getLogFilePath,
	getServices,
	startService,
	stopService,
} from "../../app/services/manage-services.js";
import { streamServiceLogs } from "../../app/services/stream-service-logs.js";
import { requireAuth } from "../middleware/auth.js";

export function createServicesRoutes(): Router {
	const router = Router();

	router.get("/services", requireAuth, (_req, res) => {
		try {
			res.json({ services: getServices(), exposedPort: getExposedPort() });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: message });
		}
	});

	router.post("/services", requireAuth, async (req, res) => {
		try {
			const { name, command, cwd } = req.body as {
				name?: string;
				command?: string;
				cwd?: string;
			};
			if (!name || !command) {
				res.status(400).json({ error: "name and command are required" });
				return;
			}
			res.json({ service: await startService({ name, command, cwd }) });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: message });
		}
	});

	router.delete("/services/:name", requireAuth, async (req, res) => {
		try {
			await stopService({ name: req.params.name });
			res.json({ success: true });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: message });
		}
	});

	router.post("/expose", requireAuth, async (req, res) => {
		try {
			const { port } = req.body as { port?: number };
			if (typeof port !== "number") {
				res.status(400).json({ error: "port must be a number" });
				return;
			}
			await exposePort(port);
			res.json({ success: true, exposedPort: port });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			res.status(500).json({ error: message });
		}
	});

	router.get("/logs/:name", requireAuth, (req, res) => {
		const logFile = getLogFilePath(req.params.name);
		if (!logFile) {
			res.status(404).json({ error: `No logs found for service "${req.params.name}"` });
			return;
		}
		streamServiceLogs(req, res, logFile);
	});

	return router;
}
