/**
 * POST /api/billing/buy-credits
 *
 * Purchase additional credits: $20 for 2,000 credits.
 * Returns a Stripe checkout URL for payment.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { isBillingEnabled } from "@/lib/billing";
import { getUserOrgRole } from "@/lib/permissions";
import { env } from "@proliferate/environment/server";
import { orgs } from "@proliferate/services";
import { TOP_UP_PRODUCT, autumnAttach } from "@proliferate/shared/billing";
import { NextResponse } from "next/server";

export async function POST() {
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

	// Only admins/owners can purchase credits
	const role = await getUserOrgRole(userId, orgId);
	if (!role || role === "member") {
		return NextResponse.json({ error: "Only admins can purchase credits" }, { status: 403 });
	}

	if (!isBillingEnabled()) {
		return NextResponse.json({ error: "Billing is not enabled" }, { status: 400 });
	}

	// Verify org exists
	const org = await orgs.getBillingInfo(orgId);
	if (!org) {
		return NextResponse.json({ error: "Organization not found" }, { status: 404 });
	}

	try {
		const baseUrl = env.NEXT_PUBLIC_APP_URL;

		// Generate idempotency key based on org, user, and 1-minute time window
		// This allows retries within the window but prevents accidental duplicates
		const timeWindow = Math.floor(Date.now() / 60000); // 1-minute buckets
		const idempotencyKey = `buy-credits:${orgId}:${userId}:${timeWindow}`;

		// Attach the top_up product (fixed $20 for 2000 credits)
		const result = await autumnAttach({
			customer_id: orgId,
			product_id: TOP_UP_PRODUCT.productId,
			success_url: `${baseUrl}/settings/billing?success=credits`,
			cancel_url: `${baseUrl}/settings/billing?canceled=credits`,
			idempotency_key: idempotencyKey,
			customer_data: {
				email: userEmail,
				name: org.name,
			},
		});

		const checkoutUrl = result.checkout_url ?? result.url;
		if (checkoutUrl) {
			return NextResponse.json({
				success: true,
				checkoutUrl,
				credits: TOP_UP_PRODUCT.credits,
				priceCents: TOP_UP_PRODUCT.priceCents,
			});
		}

		// If no checkout URL, credits were added directly (customer has payment method on file)
		return NextResponse.json({
			success: true,
			message: `${TOP_UP_PRODUCT.credits} credits added to your account`,
			credits: TOP_UP_PRODUCT.credits,
		});
	} catch (err) {
		console.error("[BuyCredits] Failed:", err);
		return NextResponse.json({ error: "Failed to process purchase" }, { status: 500 });
	}
}
