/**
 * Backend server entry point.
 *
 * Node.js HTTP server that serves oRPC endpoints.
 * Uses @orpc/server/node adapter for native Node request handling.
 */

import { createServer } from "node:http";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { createLogger } from "@proliferate/logger";
import { setServicesLogger } from "@proliferate/services/logger";
import { appRouter } from "./orpc/router";

const log = createLogger({ service: "backend" });
setServicesLogger(log);

const port = Number(process.env.PORT ?? 3001);

// ============================================
// oRPC handler
// ============================================

const handler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			log.error({ err: error }, "oRPC error");
		}),
	],
});

// ============================================
// CORS
// ============================================

function corsHeaders(origin: string | null): Record<string, string> {
	const allowedOrigins = ["http://localhost:3000", process.env.NEXT_PUBLIC_APP_URL].filter(
		Boolean,
	) as string[];

	const isAllowed = origin ? allowedOrigins.includes(origin) : false;

	return {
		"Access-Control-Allow-Origin": isAllowed ? origin! : "",
		"Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Org-Id",
		"Access-Control-Allow-Credentials": "true",
		"Access-Control-Max-Age": "86400",
	};
}

// ============================================
// HTTP server
// ============================================

/**
 * Convert a Node IncomingMessage into a web Request.
 *
 * The oRPC node adapter handles req/res conversion for RPC transport,
 * but our BaseContext needs a web Request so that auth middleware can
 * read headers with the standard Headers API.
 */
function toWebRequest(req: import("node:http").IncomingMessage): Request {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value) {
			headers.set(key, Array.isArray(value) ? value.join(", ") : value);
		}
	}
	const url = new URL(req.url ?? "/", `http://localhost:${port}`);
	return new Request(url.toString(), {
		method: req.method,
		headers,
	});
}

const server = createServer(async (req, res) => {
	const origin = req.headers.origin ?? null;
	const cors = corsHeaders(origin);

	// CORS preflight
	if (req.method === "OPTIONS") {
		for (const [key, value] of Object.entries(cors)) {
			res.setHeader(key, value);
		}
		res.writeHead(204);
		res.end();
		return;
	}

	// Health check
	if (req.url === "/health") {
		res.writeHead(200);
		res.end("ok");
		return;
	}

	// oRPC routes
	if (req.url?.startsWith("/api/rpc")) {
		for (const [key, value] of Object.entries(cors)) {
			res.setHeader(key, value);
		}

		const { matched } = await handler.handle(req, res, {
			prefix: "/api/rpc",
			context: { request: toWebRequest(req) },
		});

		if (!matched) {
			res.writeHead(404);
			res.end("Not found");
		}
		return;
	}

	res.writeHead(404);
	res.end("Not found");
});

server.listen(port, () => {
	log.info({ port }, "Backend server started");
});
