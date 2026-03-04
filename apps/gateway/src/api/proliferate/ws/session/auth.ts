import type { IncomingMessage } from "node:http";
import type { URL } from "node:url";
import type { GatewayEnv } from "../../../../lib/env";
import { verifyToken } from "../../../../middleware/auth";

export async function authenticateSessionUpgrade(req: IncomingMessage, url: URL, env: GatewayEnv) {
	const queryToken = url.searchParams.get("token");
	const authHeader = req.headers.authorization;
	const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
	const token = queryToken || bearerToken;
	if (!token) return null;
	return verifyToken(token, env);
}
