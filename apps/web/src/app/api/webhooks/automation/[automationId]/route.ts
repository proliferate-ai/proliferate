/**
 * Automation Webhook Endpoint
 *
 * Accepts POST requests to trigger an automation via its webhook trigger.
 * Uses automation ID so the URL is known before the trigger is created.
 */

import { logger } from "@/lib/logger";
import { automations, runs } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ handler: "automation-webhook" });

async function hmacSha256(secret: string, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	return Array.from(new Uint8Array(signatureBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

async function verifyWebhookSignature(
	request: Request,
	body: string,
	secret: string,
): Promise<boolean> {
	const signature =
		request.headers.get("X-Webhook-Signature") ||
		request.headers.get("X-Signature") ||
		request.headers.get("X-Hub-Signature-256")?.replace("sha256=", "") ||
		request.headers.get("X-Signature-256");

	if (!signature) {
		return false;
	}

	const expected = await hmacSha256(secret, body);

	if (signature.length !== expected.length) {
		return false;
	}

	let mismatch = 0;
	for (let i = 0; i < signature.length; i++) {
		mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return mismatch === 0;
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ automationId: string }> },
) {
	const { automationId } = await params;
	const body = await request.text();

	// Find the webhook trigger for this automation
	const trigger = await automations.findWebhookTrigger(automationId);

	if (!trigger) {
		log.error({ automationId }, "No enabled webhook trigger for automation");
		return NextResponse.json({ error: "No webhook trigger found" }, { status: 404 });
	}

	// Check if automation is enabled
	if (!trigger.automation?.enabled) {
		log.info({ automationId }, "Automation is disabled");
		return NextResponse.json({ error: "Automation is disabled" }, { status: 403 });
	}

	// Verify signature if required in config
	const requireSignature = (trigger.config as { requireSignatureVerification?: boolean } | null)
		?.requireSignatureVerification;
	if (requireSignature && trigger.webhookSecret) {
		const isValid = await verifyWebhookSignature(request, body, trigger.webhookSecret);
		if (!isValid) {
			log.error({ automationId }, "Invalid signature for automation");
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}
	}

	// Parse the payload
	let payload: unknown;
	try {
		payload = JSON.parse(body);
	} catch {
		payload = { raw: body };
	}

	const receivedAt = new Date().toISOString();

	// Create a dedup key
	const payloadHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
	const dedupKey = `webhook:${Array.from(new Uint8Array(payloadHash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 32)}`;

	// Check for duplicate (within last 5 minutes)
	const isDuplicate = await automations.isDuplicateTriggerEvent(trigger.id, dedupKey);

	if (isDuplicate) {
		log.info({ automationId }, "Duplicate webhook for automation");
		return NextResponse.json({
			success: true,
			message: "Duplicate webhook ignored",
			duplicate: true,
		});
	}

	// Build parsed context for the trigger
	const parsedContext: Record<string, unknown> = {
		title: "Webhook Received",
		summary: `Custom webhook received at ${new Date(receivedAt).toLocaleString()}`,
		source: "webhook",
		timestamp: receivedAt,
		payload: payload,
	};

	// Load automation details for run creation
	const automation = trigger.automation;
	if (!automation) {
		return NextResponse.json({ error: "Automation not found" }, { status: 404 });
	}

	// Create run (and trigger event) via services
	try {
		const { run, event } = await runs.createRunFromTriggerEvent({
			triggerId: trigger.id,
			organizationId: trigger.organizationId,
			automationId: automation.id,
			externalEventId: `webhook:${receivedAt}`,
			providerEventType: "webhook:received",
			rawPayload: payload as Record<string, unknown>,
			parsedContext,
			dedupKey,
		});

		log.info({ runId: run.id, eventId: event.id }, "Created run for event");

		return NextResponse.json({
			success: true,
			eventId: event.id,
			runId: run.id,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error({ err, automationId }, "Failed to create run for automation");
		return NextResponse.json({ error: "Failed to create run" }, { status: 500 });
	}
}
