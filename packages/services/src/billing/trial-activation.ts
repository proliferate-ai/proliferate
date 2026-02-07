/**
 * Trial auto-activation
 *
 * When trial credits are exhausted, attempt to activate the selected plan
 * using the customer's saved payment method.
 */

import {
	AUTUMN_FEATURES,
	AUTUMN_PRODUCTS,
	PLAN_CONFIGS,
	autumnAttach,
	autumnGetCustomer,
} from "@proliferate/shared/billing";
import { getServicesLogger } from "../logger";
import { getBillingInfoV2, initializeBillingState, updateAutumnCustomerId } from "../orgs/service";

export interface TrialActivationResult {
	activated: boolean;
	requiresCheckout: boolean;
	checkoutUrl?: string;
}

export async function tryActivatePlanAfterTrial(orgId: string): Promise<TrialActivationResult> {
	const org = await getBillingInfoV2(orgId);
	if (!org) {
		return { activated: false, requiresCheckout: false };
	}

	const plan = org.billingPlan === "pro" ? "pro" : org.billingPlan === "dev" ? "dev" : null;
	if (!plan) {
		return { activated: false, requiresCheckout: false };
	}

	const resolveActiveCredits = async (customerId: string): Promise<number> => {
		let includedCredits = PLAN_CONFIGS[plan].creditsIncluded;
		try {
			const customer = await autumnGetCustomer(customerId);
			const creditsFeature = customer.features[AUTUMN_FEATURES.credits];
			if (creditsFeature?.included_usage !== undefined) {
				includedCredits = creditsFeature.included_usage ?? includedCredits;
			}
			if (creditsFeature?.balance !== undefined) {
				return creditsFeature.balance ?? includedCredits;
			}
		} catch (err) {
			getServicesLogger()
				.child({ module: "trial-activation", orgId })
				.error({ err }, "Failed to fetch customer during trial activation");
		}
		return includedCredits;
	};

	try {
		const customerId = org.autumnCustomerId ?? orgId;
		const customer = await autumnGetCustomer(customerId);
		const hasProduct = customer.products?.some(
			(product) => product.id === AUTUMN_PRODUCTS[plan] && product.status !== "canceled",
		);

		if (hasProduct) {
			const balance = await resolveActiveCredits(customerId);
			await initializeBillingState(orgId, "active", balance);
			return { activated: true, requiresCheckout: false };
		}
	} catch (err) {
		getServicesLogger()
			.child({ module: "trial-activation", orgId })
			.warn({ err }, "Failed to pre-check customer products");
	}

	try {
		const result = await autumnAttach({
			customer_id: org.autumnCustomerId ?? orgId,
			product_id: AUTUMN_PRODUCTS[plan],
			idempotency_key: `trial-activate:${orgId}`,
		});

		const checkoutUrl = result.checkout_url ?? result.url;
		const customerId = result.customer?.id ?? org.autumnCustomerId ?? orgId;
		if (customerId && customerId !== org.autumnCustomerId) {
			await updateAutumnCustomerId(orgId, customerId);
		}

		if (checkoutUrl) {
			return { activated: false, requiresCheckout: true, checkoutUrl };
		}

		const balance = await resolveActiveCredits(customerId);
		await initializeBillingState(orgId, "active", balance);
		return { activated: true, requiresCheckout: false };
	} catch (err) {
		if (err instanceof Error && err.message.includes("product_already_attached")) {
			const customerId = org.autumnCustomerId ?? orgId;
			const balance = await resolveActiveCredits(customerId);
			await initializeBillingState(orgId, "active", balance);
			return { activated: true, requiresCheckout: false };
		}
		getServicesLogger()
			.child({ module: "trial-activation", orgId })
			.error({ err }, "Trial auto-activation failed");
		return { activated: false, requiresCheckout: false };
	}
}
