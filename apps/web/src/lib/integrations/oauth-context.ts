import "server-only";

import { requireAuth } from "@/lib/auth/server/session";
import { orgs } from "@proliferate/services";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function getBaseUrl(request: Request | NextRequest): string {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
	if (forwardedHost) {
		return `${forwardedProto}://${forwardedHost}`;
	}

	if ("nextUrl" in request) {
		return request.nextUrl.origin;
	}

	return new URL(request.url).origin;
}

interface RequireIntegrationAdminContextOptions {
	allowTargetOrgId?: boolean;
	unauthenticatedResponse?: "redirect" | "json";
}

export interface IntegrationAdminContext {
	baseUrl: string;
	userId: string;
	orgId: string;
}

export async function requireIntegrationAdminContext(
	request: Request | NextRequest,
	options: RequireIntegrationAdminContextOptions = {},
): Promise<{ context: IntegrationAdminContext } | { response: NextResponse }> {
	const { allowTargetOrgId = false, unauthenticatedResponse = "redirect" } = options;
	const baseUrl = getBaseUrl(request);

	const authResult = await requireAuth();
	if ("error" in authResult) {
		if (unauthenticatedResponse === "json") {
			return {
				response: NextResponse.json({ error: authResult.error }, { status: authResult.status }),
			};
		}

		const requestUrl = "nextUrl" in request ? request.nextUrl : new URL(request.url);
		const returnUrl = `${requestUrl.pathname}${requestUrl.search}`;
		return {
			response: NextResponse.redirect(
				new URL(`/sign-in?redirect=${encodeURIComponent(returnUrl)}`, baseUrl),
			),
		};
	}

	const userId = authResult.session.user.id;
	const requestUrl = "nextUrl" in request ? request.nextUrl : new URL(request.url);
	const targetOrgId = allowTargetOrgId
		? (requestUrl.searchParams.get("targetOrgId") ?? undefined)
		: undefined;
	const orgId = targetOrgId || authResult.session.session.activeOrganizationId;
	if (!orgId) {
		return {
			response: NextResponse.json({ error: "No active organization" }, { status: 400 }),
		};
	}

	const role = await orgs.getUserRole(userId, orgId);
	if (role !== "owner" && role !== "admin") {
		return {
			response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
		};
	}

	return {
		context: {
			baseUrl,
			userId,
			orgId,
		},
	};
}
