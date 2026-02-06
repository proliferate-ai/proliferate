import express, { type Express, type Request } from "express";
import { providersRouter } from "./api/providers.js";
import { webhookRouter } from "./api/webhooks.js";

export function createServer(): Express {
	const app = express();

	app.use(
		express.json({
			verify: (req, _res, buf) => {
				(req as Request & { rawBody?: string }).rawBody = buf.toString("utf8");
			},
		}),
	);

	// Health check
	app.get("/health", (_req, res) => {
		res.json({ status: "ok" });
	});

	// Provider metadata (for UI generation)
	app.use("/providers", providersRouter);

	// Webhook ingestion
	app.use("/webhooks", webhookRouter);

	return app;
}
