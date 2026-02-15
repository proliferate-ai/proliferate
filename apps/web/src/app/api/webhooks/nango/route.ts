/**
 * Nango Webhook Handler (Auth & Sync only)
 *
 * Receives webhooks from Nango for auth lifecycle and sync events.
 * Forward webhooks (provider trigger events) are now handled by the
 * trigger service via apps/trigger-service/src/api/webhooks.ts.
 */

import { logger } from "@/lib/logger";
import { env } from "@proliferate/environment/server";
import { integrations } from "@proliferate/services";
import { NextResponse } from "next/server";

const log = logger.child({ handler: "nango-webhook" });

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

type NangoWebhook = NangoAuthWebhook | NangoSyncWebhook | { type: string };

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
				await handleAuthWebhook(webhook as NangoAuthWebhook);
				return NextResponse.json({ success: true, type: "auth" });

			case "sync":
				log.info(
					{
						syncName: (webhook as NangoSyncWebhook).syncName,
						success: (webhook as NangoSyncWebhook).success,
					},
					"Sync completed",
				);
				return NextResponse.json({ success: true, type: "sync" });

			case "forward":
				// Forward webhooks are now handled by the trigger service.
				// Return 200 to prevent retries if Nango still sends here during migration.
				log.info("Forward webhook received — should be routed to trigger service");
				return NextResponse.json({ success: true, type: "forward", migrated: true });

			default:
				log.info({ type: webhook.type }, "Unknown webhook type");
				return NextResponse.json({ success: true, type: "unknown" });
		}
	} catch (err) {
		log.error({ err }, "Error processing Nango webhook");
		return NextResponse.json({ error: "Internal server error" }, { status: 500 });
	}
}
