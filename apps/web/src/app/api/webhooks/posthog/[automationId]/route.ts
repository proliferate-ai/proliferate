/**
 * PostHog Webhook Endpoint (Automation-scoped)
 *
 * Accepts POST requests from PostHog webhook destinations.
 * Uses automation ID so the URL is known before the trigger is created.
 */

import { automations, runs, triggers } from "@proliferate/services";
import { PostHogProvider } from "@proliferate/triggers";
import { NextResponse } from "next/server";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ automationId: string }> },
) {
	const { automationId } = await params;
	const body = await request.text();

	const trigger = await automations.findTriggerForAutomationByProvider(automationId, "posthog");
	if (!trigger) {
		console.error(`[PostHog] No enabled trigger for automation: ${automationId}`);
		return NextResponse.json({ error: "No PostHog trigger found" }, { status: 404 });
	}

	if (!trigger.automation) {
		console.log(`[PostHog] Automation ${automationId} not found`);
		return NextResponse.json({ error: "Automation not found" }, { status: 404 });
	}

	if (!trigger.automation.enabled) {
		console.log(`[PostHog] Automation ${automationId} is disabled`);
		return NextResponse.json({ error: "Automation is disabled" }, { status: 403 });
	}

	const config = (trigger.config ?? {}) as {
		eventNames?: string[];
		propertyFilters?: Record<string, string>;
		requireSignatureVerification?: boolean;
	};

	if (config.requireSignatureVerification) {
		if (!trigger.webhookSecret) {
			console.error(`[PostHog] Missing webhook secret for automation ${automationId}`);
			return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
		}

		const isValid = await PostHogProvider.verifyWebhook(request, trigger.webhookSecret, body);
		if (!isValid) {
			console.error(`[PostHog] Invalid signature for automation ${automationId}`);
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}
	}

	let payload: unknown;
	try {
		payload = JSON.parse(body);
	} catch {
		return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
	}

	const items = PostHogProvider.parseWebhook(payload);
	if (items.length === 0) {
		return NextResponse.json({ processed: 0, skipped: 0 });
	}

	let processed = 0;
	let skipped = 0;

	for (const item of items) {
		if (!PostHogProvider.filter(item, config)) {
			const parsedContext = PostHogProvider.parseContext(item) as unknown as Record<
				string,
				unknown
			>;
			const dedupKey = PostHogProvider.computeDedupKey(item);
			await triggers.createSkippedEvent({
				triggerId: trigger.id,
				organizationId: trigger.organizationId,
				externalEventId: PostHogProvider.extractExternalId(item),
				providerEventType: PostHogProvider.getEventType(item),
				rawPayload: item as unknown as Record<string, unknown>,
				parsedContext,
				dedupKey,
				skipReason: "filter_mismatch",
			});
			skipped += 1;
			continue;
		}

		const dedupKey = PostHogProvider.computeDedupKey(item);
		if (dedupKey) {
			const exists = await triggers.eventExistsByDedupKey(trigger.id, dedupKey);
			if (exists) {
				skipped += 1;
				continue;
			}
		}

		const parsedContext = PostHogProvider.parseContext(item) as unknown as Record<string, unknown>;
		const providerEventType = PostHogProvider.getEventType(item);

		try {
			await runs.createRunFromTriggerEvent({
				triggerId: trigger.id,
				organizationId: trigger.organizationId,
				automationId: trigger.automation.id,
				externalEventId: PostHogProvider.extractExternalId(item),
				providerEventType,
				rawPayload: item as unknown as Record<string, unknown>,
				parsedContext,
				dedupKey,
			});
			processed += 1;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[PostHog] Failed to create run for automation ${automationId}:`, message);
			skipped += 1;
		}
	}

	return NextResponse.json({ processed, skipped });
}
