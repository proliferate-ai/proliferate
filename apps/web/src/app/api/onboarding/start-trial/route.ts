/**
 * POST /api/onboarding/start-dev
 *
 * Start a credit-based trial for a new organization.
 * Stores selected plan and grants trial credits.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { isBillingEnabled } from "@/lib/billing";
import { env } from "@proliferate/environment/server";
import { orgs } from "@proliferate/services";
import { TRIAL_CREDITS, autumnAttach, autumnCreateCustomer } from "@proliferate/shared/billing";
import { NextResponse } from "next/server";

interface StartdevRequest {
	plan?: "dev" | "pro";
}

export async function POST(request: Request) {
	console.log("[Onboarding] /api/onboarding/start-dev POST called");

	const authResult = await requireAuth();
	if ("error" in authResult) {
		console.log("[Onboarding] Auth error:", authResult.error);
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	const userEmail = authResult.session.user.email;

	console.log("[Onboarding] Active org:", orgId);
	console.log("[Onboarding] User email:", userEmail);

	if (!orgId) {
		console.warn("[Onboarding] No active organization found for user:", userEmail);
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	// Parse request body for plan selection
	let body: StartdevRequest = {};
	try {
		body = await request.json();
		console.log("[Onboarding] Request body:", body);
	} catch (err) {
		console.log("[Onboarding] Could not parse request body, defaulting to dev plan");
		// Default to dev if no body
	}
	const selectedPlan = body.plan || "dev";
	console.log("[Onboarding] Selected plan:", selectedPlan);

	// If billing not configured, just mark onboarding complete
	if (!isBillingEnabled()) {
		console.log("[Onboarding] Billing not enabled. Marking onboarding complete for org:", orgId);
		try {
			await orgs.markOnboardingComplete(orgId, true);
			await orgs.updateBillingPlan(orgId, selectedPlan);
		} catch (err) {
			console.error("[Onboarding] Failed to mark onboarding as complete:", err);
		}

		return NextResponse.json({
			success: true,
			message: "Billing not configured - trial started without payment",
		});
	}

	const org = await orgs.getBillingInfoV2(orgId);
	if (!org) {
		console.error("[Onboarding] Failed to fetch organization row");
		return NextResponse.json(
			{ error: "Failed to check organization billing state" },
			{ status: 500 },
		);
	}

	console.log("[Onboarding] Fetched organization billing row:", org);

	try {
		await orgs.updateBillingPlan(orgId, selectedPlan);

		const baseUrl = env.NEXT_PUBLIC_APP_URL;
		let customerId = org.autumnCustomerId ?? orgId;
		try {
			const customer = await autumnCreateCustomer({
				id: customerId,
				name: org.name,
				email: userEmail,
			});
			customerId = customer.customer?.id ?? customer.data?.id ?? customer.id ?? customerId;
			if (customerId !== org.autumnCustomerId) {
				await orgs.updateAutumnCustomerId(orgId, customerId);
			}
		} catch (err) {
			console.warn("[Onboarding] Failed to create Autumn customer:", err);
		}

		const setup = await autumnAttach({
			customer_id: customerId,
			product_id: selectedPlan,
			success_url: `${baseUrl}/onboarding/complete`,
			cancel_url: `${baseUrl}/onboarding`,
			customer_data: {
				email: userEmail,
				name: org.name,
			},
			force_checkout: true,
		});

		const checkoutUrl = setup.checkout_url ?? setup.url;
		if (checkoutUrl) {
			return NextResponse.json({
				success: true,
				checkoutUrl,
				message: "Card required to start trial",
			});
		}

		if (org.billingState === "unconfigured") {
			await orgs.initializeBillingState(orgId, "trial", TRIAL_CREDITS);
		}

		return NextResponse.json({
			success: true,
			message: "Trial started",
		});
	} catch (err) {
		console.error("[Onboarding] Failed to start dev:", err);
		return NextResponse.json({ error: "Failed to start dev" }, { status: 500 });
	}
}
