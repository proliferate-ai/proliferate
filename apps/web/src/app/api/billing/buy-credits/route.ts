/**
 * POST /api/billing/buy-credits
 *
 * DEPRECATED — thin adapter mirroring oRPC `billing.buyCredits` logic.
 * Use the oRPC procedure instead: POST /api/rpc/billing.buyCredits
 * Will be removed after deprecation window (see billing-metering.md §10.6 D3).
 */

import { requireAuth } from "@/lib/auth-helpers";
import { isBillingEnabled } from "@/lib/billing";
import { logger } from "@/lib/logger";
import { getUserOrgRole } from "@/lib/permissions";
import { env } from "@proliferate/environment/server";
import { billing, orgs } from "@proliferate/services";
import { TOP_UP_PRODUCT, autumnAttach } from "@proliferate/shared/billing";
import { NextResponse } from "next/server";

const log = logger.child({ route: "billing/buy-credits" });

const DEPRECATION_HEADERS = {
	Deprecation: "true",
	Link: '</api/rpc/billing.buyCredits>; rel="successor-version"',
} as const;

export async function POST(request: Request) {
	const authResult = await requireAuth();
	if ("error" in authResult) {
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	const userId = authResult.session.user.id;
	const userEmail = authResult.session.user.email;

	if (!orgId) {
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	const role = await getUserOrgRole(userId, orgId);
	if (!role || role === "member") {
		return NextResponse.json({ error: "Only admins can purchase credits" }, { status: 403 });
	}

	if (!isBillingEnabled()) {
		return NextResponse.json({ error: "Billing is not enabled" }, { status: 400 });
	}

	const org = await orgs.getBillingInfo(orgId);
	if (!org) {
		return NextResponse.json({ error: "Organization not found" }, { status: 404 });
	}

	try {
		// Parse quantity from body (must match oRPC: int, min 1, max 10)
		let body: Record<string, unknown> | undefined;
		try {
			body = await request.json();
		} catch {
			// No body or invalid JSON — will use default
		}
		let quantity = 1;
		if (body && "quantity" in body) {
			const raw = body.quantity;
			if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 10) {
				return NextResponse.json(
					{ error: "quantity must be an integer between 1 and 10" },
					{ status: 400, headers: DEPRECATION_HEADERS },
				);
			}
			quantity = raw;
		}

		const baseUrl = env.NEXT_PUBLIC_APP_URL;
		const totalCredits = TOP_UP_PRODUCT.credits * quantity;

		// First attach — may return checkout URL
		const firstResult = await autumnAttach({
			customer_id: orgId,
			product_id: TOP_UP_PRODUCT.productId,
			success_url: `${baseUrl}/settings/billing?success=credits`,
			cancel_url: `${baseUrl}/settings/billing?canceled=credits`,
			customer_data: {
				email: userEmail,
				name: org.name,
			},
		});

		const checkoutUrl = firstResult.checkout_url ?? firstResult.url;
		if (checkoutUrl) {
			// Customer needs to complete checkout — can only buy 1 pack at a time
			return NextResponse.json(
				{
					success: true,
					checkoutUrl,
					credits: TOP_UP_PRODUCT.credits,
					priceCents: TOP_UP_PRODUCT.priceCents,
				},
				{ headers: DEPRECATION_HEADERS },
			);
		}

		// Payment method on file — attach remaining packs
		for (let i = 1; i < quantity; i++) {
			await autumnAttach({
				customer_id: orgId,
				product_id: TOP_UP_PRODUCT.productId,
				customer_data: {
					email: userEmail,
					name: org.name,
				},
			});
		}

		// Update shadow balance for all packs (mirrors oRPC addShadowBalance call)
		try {
			await billing.addShadowBalance(
				orgId,
				totalCredits,
				`Credit top-up (${quantity}x pack, payment method on file)`,
				userId,
			);
		} catch (err) {
			log.error({ err }, "Failed to update shadow balance");
		}

		return NextResponse.json(
			{
				success: true,
				message: `${totalCredits} credits added to your account`,
				credits: totalCredits,
			},
			{ headers: DEPRECATION_HEADERS },
		);
	} catch (err) {
		log.error({ err }, "Failed to process purchase");
		return NextResponse.json({ error: "Failed to process purchase" }, { status: 500 });
	}
}
