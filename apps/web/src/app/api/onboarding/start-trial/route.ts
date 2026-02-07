/**
 * POST /api/onboarding/start-dev
 *
 * Start a credit-based trial for a new organization.
 * Stores selected plan and grants trial credits.
 */

import { requireAuth } from "@/lib/auth-helpers";
import { isBillingEnabled } from "@/lib/billing";
import { logger } from "@/lib/logger";

const log = logger.child({ handler: "start-trial" });
import { env } from "@proliferate/environment/server";
import { orgs } from "@proliferate/services";
import { TRIAL_CREDITS, autumnAttach, autumnCreateCustomer } from "@proliferate/shared/billing";
import { NextResponse } from "next/server";

interface StartdevRequest {
	plan?: "dev" | "pro";
}

export async function POST(request: Request) {
	log.info("POST called");

	const authResult = await requireAuth();
	if ("error" in authResult) {
		log.info({ error: authResult.error }, "Auth error");
		return NextResponse.json({ error: authResult.error }, { status: authResult.status });
	}

	const orgId = authResult.session.session.activeOrganizationId;
	const userEmail = authResult.session.user.email;

	log.info({ orgId }, "Active org");
	log.info({ userEmail }, "User email");

	if (!orgId) {
		log.warn({ userEmail }, "No active organization found for user");
		return NextResponse.json({ error: "No active organization" }, { status: 400 });
	}

	// Parse request body for plan selection
	let body: StartdevRequest = {};
	try {
		body = await request.json();
		log.info({ plan: body.plan }, "Request body parsed");
	} catch (err) {
		log.info("Could not parse request body, defaulting to dev plan");
		// Default to dev if no body
	}
	const selectedPlan = body.plan || "dev";
	log.info({ selectedPlan }, "Selected plan");

	// If billing not configured, just mark onboarding complete
	if (!isBillingEnabled()) {
		log.info({ orgId }, "Billing not enabled, marking onboarding complete");
		try {
			await orgs.markOnboardingComplete(orgId, true);
			await orgs.updateBillingPlan(orgId, selectedPlan);
		} catch (err) {
			log.error({ err }, "Failed to mark onboarding as complete");
		}

		return NextResponse.json({
			success: true,
			message: "Billing not configured - trial started without payment",
		});
	}

	const org = await orgs.getBillingInfoV2(orgId);
	if (!org) {
		log.error({ orgId }, "Failed to fetch organization row");
		return NextResponse.json(
			{ error: "Failed to check organization billing state" },
			{ status: 500 },
		);
	}

	log.info({ orgId, billingState: org.billingState }, "Fetched organization billing row");

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
			log.warn({ err }, "Failed to create Autumn customer");
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
		log.error({ err }, "Failed to start dev");
		return NextResponse.json({ error: "Failed to start dev" }, { status: 500 });
	}
}
