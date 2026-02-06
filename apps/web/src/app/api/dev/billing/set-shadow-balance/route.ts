/**
 * DEV ONLY: Set shadow balance for the active org.
 *
 * POST /api/dev/billing/set-shadow-balance
 * Body: { balance: number }
 */

import { requireAuth } from "@/lib/auth-helpers";
import { getUserOrgRole } from "@/lib/permissions";
import { billing } from "@proliferate/services";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
	if (process.env.NODE_ENV === "production") {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	const userId = authResult.session.user.id;

	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	const role = await getUserOrgRole(userId, orgId);
	if (!role || role === "member") {
		return NextResponse.json({ error: "Only admins can update balances" }, { status: 403 });
	}

	let body: { balance?: number } = {};
	try {
		body = await request.json();
	} catch {
		// no-op
	}

	const balance = Number(body.balance);
	if (!Number.isFinite(balance)) {
		return NextResponse.json({ error: "Invalid balance" }, { status: 400 });
	}

	await billing.reconcileShadowBalance(
		orgId,
		balance,
		"manual_adjustment",
		"Dev helper: set shadow balance",
		userId,
	);

	return NextResponse.json({ success: true, balance });
}
