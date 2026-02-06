import { isAuthError, requireAuth } from "@/lib/auth-helpers";
import { isSuperAdmin } from "@/lib/super-admin";
import { getEnvStatus } from "@proliferate/environment";
import { nodeEnv } from "@proliferate/environment/runtime";

export async function GET() {
	const authResult = await requireAuth();
	if (isAuthError(authResult)) {
		return Response.json({ error: authResult.error }, { status: authResult.status });
	}

	if (nodeEnv === "production" && !isSuperAdmin(authResult.session.user.email)) {
		return Response.json({ error: "Forbidden" }, { status: 403 });
	}

	const status = getEnvStatus();
	return Response.json(status, { status: 200 });
}
