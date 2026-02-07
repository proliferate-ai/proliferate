/**
 * Nango Webhook Handler
 *
 * Receives webhooks from Nango (auth events, sync events, forwarded provider webhooks).
 * Uses shared trigger processor for event handling.
 */

import { logger } from "@/lib/logger";
import { getProviderFromIntegrationId } from "@/lib/nango";
import { env } from "@proliferate/environment/server";

const log = logger.child({ handler: "nango-webhook" });
import { integrations, triggers } from "@proliferate/services";
import { getProviderByType } from "@proliferate/triggers";
import { NextResponse } from "next/server";

const NANGO_SECRET_KEY = env.NANGO_SECRET_KEY;

// ============================================
// Types
// ============================================

interface NangoAuthWebhook {
	type: "auth";
	operation: "creation" | "override" | "refresh";
	connectionId: string;
	authMode: string;
	providerConfigKey: string;
	provider: string;
	environment: string;
	success: boolean;
	endUser?: {
		endUserId: string;
		organizationId?: string;
	};
	error?: {
		type: string;
		description: string;
	};
}

interface NangoSyncWebhook {
	type: "sync";
	connectionId: string;
	providerConfigKey: string;
	syncName: string;
	model: string;
	syncType: "INCREMENTAL" | "INITIAL" | "WEBHOOK";
	success: boolean;
	responseResults?: {
		added: number;
		updated: number;
		deleted: number;
	};
	error?: {
		type: string;
		description: string;
	};
}

interface NangoForwardWebhook {
	type: "forward";
	from: string;
	connectionId: string;
	providerConfigKey: string;
	payload: Record<string, unknown>;
}

type NangoWebhook = NangoAuthWebhook | NangoSyncWebhook | NangoForwardWebhook;

// ============================================
// Signature verification
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

async function verifyNangoWebhook(request: Request, body: string): Promise<boolean> {
	if (!NANGO_SECRET_KEY) {
		log.warn("NANGO_SECRET_KEY not configured, skipping verification");
		return true;
	}

	const signature = request.headers.get("X-Nango-Hmac-Sha256");
	if (!signature) {
		log.error("Missing X-Nango-Hmac-Sha256 header");
		return false;
	}

	const expected = await hmacSha256(NANGO_SECRET_KEY, body);
	return signature === expected;
}

// ============================================
// Auth webhook handler
// ============================================

async function handleAuthWebhook(webhook: NangoAuthWebhook): Promise<void> {
	const integration = await integrations.findByConnectionIdAndProvider(
		webhook.connectionId,
		"nango",
	);

	if (!integration) {
		log.info({ connectionId: webhook.connectionId }, "Integration not found for connection");
		return;
	}

	let newStatus: string | null = null;

	if (webhook.operation === "creation" && webhook.success) {
		newStatus = "active";
	} else if (webhook.operation === "override" && webhook.success) {
		newStatus = "active";
	} else if (webhook.operation === "refresh" && !webhook.success) {
		newStatus = "error";
		log.error(
			{ providerConfigKey: webhook.providerConfigKey, error: webhook.error?.description },
			"Token refresh failed",
		);
	}

	if (newStatus && newStatus !== integration.status) {
		await integrations.updateStatus(integration.id, newStatus);
		log.info(
			{ integrationId: integration.id, oldStatus: integration.status, newStatus },
			"Updated integration status",
		);
	}
}

// ============================================
// Forward webhook handler
// ============================================

async function handleForwardWebhook(
	webhook: NangoForwardWebhook,
): Promise<{ processed: number; skipped: number }> {
	// Map Nango integration ID to our provider type
	const providerType = getProviderFromIntegrationId(webhook.from);
	if (!providerType) {
		log.info({ from: webhook.from }, "Unsupported forward webhook provider");
		return { processed: 0, skipped: 0 };
	}

	// Get the provider implementation
	const provider = getProviderByType(providerType);
	if (!provider) {
		log.error({ providerType }, "Provider not found");
		return { processed: 0, skipped: 0 };
	}

	// Find the integration by connection_id
	const integration = await integrations.findByConnectionIdAndProvider(
		webhook.connectionId,
		"nango",
	);

	if (!integration) {
		log.info({ connectionId: webhook.connectionId }, "Integration not found for connection");
		return { processed: 0, skipped: 0 };
	}

	// Find active triggers for this integration
	const triggerRows = await triggers.findActiveWebhookTriggers(integration.id);
	if (triggerRows.length === 0) {
		log.info({ integrationId: integration.id }, "No active webhook triggers for integration");
		return { processed: 0, skipped: 0 };
	}

	// Parse the forwarded payload using the provider
	const items = provider.parseWebhook(webhook.payload);
	if (items.length === 0) {
		log.info({ from: webhook.from }, "Event type not supported by provider");
		return { processed: 0, skipped: 0 };
	}

	// Process events using shared processor
	const processableItems = items.map((item) => ({ item, provider }));
	return triggers.processTriggerEvents(triggerRows, processableItems);
}

// ============================================
// Main handler
// ============================================

export async function POST(request: Request) {
	const body = await request.text();

	// Verify signature
	const isValid = await verifyNangoWebhook(request, body);
	if (!isValid) {
		log.error("Invalid Nango webhook signature");
		return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	}

	// Parse payload
	let webhook: NangoWebhook;
	try {
		webhook = JSON.parse(body);
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	log.info({ type: webhook.type }, "Received Nango webhook");

	try {
		switch (webhook.type) {
			case "auth":
				await handleAuthWebhook(webhook);
				return NextResponse.json({ success: true, type: "auth" });

			case "sync":
				log.info({ syncName: webhook.syncName, success: webhook.success }, "Sync completed");
				return NextResponse.json({ success: true, type: "sync" });

			case "forward": {
				const result = await handleForwardWebhook(webhook);
				return NextResponse.json({
					success: true,
					type: "forward",
					processed: result.processed,
					skipped: result.skipped,
				});
			}

			default:
				log.info({ type: (webhook as NangoWebhook).type }, "Unknown webhook type");
				return NextResponse.json({ success: true, type: "unknown" });
		}
	} catch (err) {
		log.error({ err }, "Error processing Nango webhook");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
