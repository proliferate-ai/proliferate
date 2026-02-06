/**
 * Custom Webhook Endpoint
 *
 * Accepts any POST payload and creates a trigger event.
 * Users can optionally configure HMAC-SHA256 signature verification.
 */

import { env } from "@proliferate/environment/server";
import { triggers } from "@proliferate/services";
import { NextResponse } from "next/server";

const SERVICE_TO_SERVICE_AUTH_TOKEN = env.SERVICE_TO_SERVICE_AUTH_TOKEN;
const NEXTJS_APP_URL = env.NEXT_PUBLIC_APP_URL;

// ============================================
// HMAC-SHA256 verification (optional)
// ============================================

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
	// Check common signature header names
	const signature =
		request.headers.get("X-Webhook-Signature") ||
		request.headers.get("X-Signature") ||
		request.headers.get("X-Hub-Signature-256")?.replace("sha256=", "") ||
		request.headers.get("X-Signature-256");

	if (!signature) {
		return false;
	}

	const expected = await hmacSha256(secret, body);

	// Timing-safe comparison
	if (signature.length !== expected.length) {
		return false;
	}

	let mismatch = 0;
	for (let i = 0; i < signature.length; i++) {
		mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
	}
	return mismatch === 0;
}

// ============================================
// Main webhook handler
// ============================================

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ triggerId: string }> },
) {
	const { triggerId } = await params;

	// Get raw body for signature verification
	const body = await request.text();

	// Fetch the trigger with automation
	let trigger: triggers.TriggerWithAutomationRow | null;
	try {
		trigger = await triggers.findTriggerWithAutomationById(triggerId);
	} catch (err) {
		console.error(`[CustomWebhook] Failed to fetch trigger ${triggerId}:`, err);
		return NextResponse.json({ error: "Failed to fetch trigger" }, { status: 500 });
	}

	if (!trigger) {
		console.error(`[CustomWebhook] Trigger not found: ${triggerId}`);
		return NextResponse.json({ error: "Trigger not found" }, { status: 404 });
	}

	// Check if trigger is enabled
	if (!trigger.enabled) {
		console.log(`[CustomWebhook] Trigger ${triggerId} is disabled`);
		return NextResponse.json({ error: "Trigger is disabled" }, { status: 403 });
	}

	// Check if automation is enabled
	if (!trigger.automation?.enabled) {
		console.log(`[CustomWebhook] Automation for trigger ${triggerId} is disabled`);
		return NextResponse.json({ error: "Automation is disabled" }, { status: 403 });
	}

	// Check if this is indeed a webhook trigger
	if (trigger.provider !== "webhook") {
		console.log(`[CustomWebhook] Trigger ${triggerId} is not a webhook trigger`);
		return NextResponse.json({ error: "Not a webhook trigger" }, { status: 400 });
	}

	// Verify signature if secret is configured
	if (trigger.webhookSecret) {
		const isValid = await verifyWebhookSignature(request, body, trigger.webhookSecret);
		if (!isValid) {
			console.error(`[CustomWebhook] Invalid signature for trigger ${triggerId}`);
			return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
		}
	}

	// Parse the payload
	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(body) as Record<string, unknown>;
	} catch {
		// If not JSON, treat as raw text
		payload = { raw: body };
	}

	const receivedAt = new Date().toISOString();

	// Create a dedup key based on the payload hash (to prevent exact duplicates)
	const payloadHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
	const dedupKey = `webhook:${Array.from(new Uint8Array(payloadHash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")
		.slice(0, 32)}`;

	// Check for duplicate (within last 5 minutes)
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
	try {
		const existing = await triggers.findDuplicateEventByDedupKey(
			triggerId,
			dedupKey,
			fiveMinutesAgo,
		);
		if (existing) {
			console.log(`[CustomWebhook] Duplicate webhook for trigger ${triggerId}`);
			return NextResponse.json({
				success: true,
				message: "Duplicate webhook ignored",
				duplicate: true,
			});
		}
	} catch (err) {
		console.error("[CustomWebhook] Failed to check for duplicate:", err);
		// Continue - better to risk duplicates than fail the webhook
	}

	// Create trigger event
	let event: { id: string };
	try {
		event = await triggers.createEvent({
			triggerId,
			organizationId: trigger.organizationId,
			externalEventId: `webhook:${receivedAt}`,
			providerEventType: "webhook:received",
			rawPayload: payload,
			parsedContext: {
				title: "Webhook Received",
				summary: `Custom webhook received at ${new Date(receivedAt).toLocaleString()}`,
				source: "webhook",
				timestamp: receivedAt,
				payload,
			},
			dedupKey,
			status: "queued",
		});
	} catch (err) {
		console.error(`[CustomWebhook] Failed to create event for trigger ${triggerId}:`, err);
		return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
	}

	console.log(`[CustomWebhook] Created event ${event.id} for trigger ${triggerId}`);

	// Queue for processing via internal API
	if (SERVICE_TO_SERVICE_AUTH_TOKEN && NEXTJS_APP_URL) {
		try {
			await fetch(`${NEXTJS_APP_URL}/api/internal/process-trigger-event`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${SERVICE_TO_SERVICE_AUTH_TOKEN}`,
				},
				body: JSON.stringify({
					eventId: event.id,
					triggerId: trigger.id,
					organizationId: trigger.organizationId,
				}),
			});
		} catch (err) {
			console.error("[CustomWebhook] Failed to notify API for event processing:", err);
			// Don't fail - event is recorded, can be processed later
		}
	}

	return NextResponse.json({
		success: true,
		eventId: event.id,
	});
}

// Also support GET for health checks
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ triggerId: string }> },
) {
	const { triggerId } = await params;

	// Check if trigger exists
	let trigger: { id: string; enabled: boolean | null; provider: string } | null;
	try {
		trigger = await triggers.findTriggerBasicById(triggerId);
	} catch (err) {
		console.error(`[CustomWebhook] Failed to fetch trigger ${triggerId}:`, err);
		return NextResponse.json({ error: "Failed to fetch trigger" }, { status: 500 });
	}

	if (!trigger) {
		return NextResponse.json({ error: "Trigger not found" }, { status: 404 });
	}

	return NextResponse.json({
		status: "ok",
		triggerId: trigger.id,
		enabled: trigger.enabled,
		provider: trigger.provider,
		message: "Send a POST request to this URL with your webhook payload",
	});
}
