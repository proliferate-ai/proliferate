import express, { type Express } from "express";
import { allowCors } from "./middleware/cors.js";
import { createGitRoutes } from "./routes/git-routes.js";
import { createHealthRoutes } from "./routes/health-routes.js";
import { createServicesRoutes } from "./routes/services-routes.js";

export function createApiApp(): Express {
	const app = express();
	app.use(allowCors);
	app.use(express.json());
	app.use("/api", createHealthRoutes());
	app.use("/api", createServicesRoutes());
	app.use("/api", createGitRoutes());
	return app;
}
