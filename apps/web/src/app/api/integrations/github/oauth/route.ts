import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth-helpers";
import { createSignedOAuthState } from "@/lib/oauth-state";
import { env } from "@proliferate/environment/server";
import { orgs } from "@proliferate/services";
import { type NextRequest, NextResponse } from "next/server";

function getBaseUrl(request: NextRequest): string {
	const forwardedHost = request.headers.get("x-forwarded-host");
	const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
	if (forwardedHost) {
		return `${forwardedProto}://${forwardedHost}`;
	}
	return request.nextUrl.origin;
}

function sanitizeReturnUrl(returnUrl: string | undefined): string | undefined {
	if (!returnUrl) return undefined;

	const trimmed = returnUrl.trim();
	if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return undefined;

	const path = trimmed.split("?")[0] || "";
	const allowedPrefixes = [
		"/onboarding",
		"/device-github",
		"/dashboard",
		"/settings",
		"/preview",
		"/workspace",
		"/repos",
		"/invite",
	];
	const isAllowed = allowedPrefixes.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);

	return isAllowed ? trimmed : undefined;
}

export async function GET(request: NextRequest) {
	const baseUrl = getBaseUrl(request);
	const authResult = await requireAuth();
	if ("error" in authResult) {
		const returnUrl = `${request.nextUrl.pathname}${request.nextUrl.search}`;
		return NextResponse.redirect(
			new URL(`/sign-in?redirect=${encodeURIComponent(returnUrl)}`, baseUrl),
		);
	}

	const userId = authResult.session.user.id;
	const rawReturnUrl = request.nextUrl.searchParams.get("returnUrl") ?? undefined;
	const targetOrgId = request.nextUrl.searchParams.get("targetOrgId") ?? undefined;
	const returnUrl = sanitizeReturnUrl(rawReturnUrl);
	const orgId = targetOrgId || authResult.session.session.activeOrganizationId;

	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	const role = await orgs.getUserRole(userId, orgId);
	if (role !== "owner" && role !== "admin") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const state = createSignedOAuthState({
		orgId,
		userId,
		nonce: randomUUID(),
		timestamp: Date.now(),
		returnUrl,
	});

	const installUrl = new URL(
		`https://github.com/apps/${env.NEXT_PUBLIC_GITHUB_APP_SLUG}/installations/new`,
	);
	installUrl.searchParams.set("state", state);
	return NextResponse.redirect(installUrl.toString());
}
