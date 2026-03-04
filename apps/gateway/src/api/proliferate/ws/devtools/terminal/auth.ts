import type { GatewayEnv } from "../../../../../lib/env";
import { verifyToken } from "../../../../../middleware/auth";

export async function authenticatePathToken(token: string, env: GatewayEnv): Promise<boolean> {
	try {
		const auth = await verifyToken(token, env);
		return Boolean(auth);
	} catch {
		return false;
	}
}
