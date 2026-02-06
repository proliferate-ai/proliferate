/**
 * GitHub App Webhook Endpoint
 *
 * Receives webhooks directly from GitHub App installations.
 * Maps installation_id to integrations and triggers events.
 */

import { env } from "@proliferate/environment/server";
import { integrations, triggers } from "@proliferate/services";
import { GitHubProvider, type GitHubTriggerConfig, getProviderByType } from "@proliferate/triggers";
import { NextResponse } from "next/server";

const GITHUB_APP_WEBHOOK_SECRET = env.GITHUB_APP_WEBHOOK_SECRET;
const SERVICE_TO_SERVICE_AUTH_TOKEN = env.SERVICE_TO_SERVICE_AUTH_TOKEN;
const NEXTJS_APP_URL = env.NEXT_PUBLIC_APP_URL;

/**
 * Extract installation ID from GitHub webhook payload.
 * GitHub includes installation info in most webhook payloads.
 */
function extractInstallationId(payload: Record<string, unknown>): string | null {
	const installation = payload.installation as { id?: number } | undefined;
	if (installation?.id) {
		return String(installation.id);
	}
	return null;
}

/**
 * Create a skipped event record for visibility/debugging.
 */
async function createSkippedEventRecord(
	trigger: { id: string; organizationId: string },
	item: unknown,
	skipReason: string,
): Promise<void> {
	const provider = getProviderByType("github");
	if (!provider) return;

	const parsedContext = provider.parseContext(item);
	const dedupKey = provider.computeDedupKey(item);

	await triggers.createSkippedEvent({
		triggerId: trigger.id,
		organizationId: trigger.organizationId,
		externalEventId: provider.extractExternalId(item),
		providerEventType: provider.getEventType(item),
		rawPayload: item as unknown as Record<string, unknown>,
		parsedContext: parsedContext as unknown as Record<string, unknown>,
		dedupKey,
		skipReason,
	});
}

export async function POST(request: Request) {
	// Get raw body for signature verification
	const body = await request.text();

	// Verify webhook signature
	if (!GITHUB_APP_WEBHOOK_SECRET) {
		console.error("[GitHubApp] GITHUB_APP_WEBHOOK_SECRET not configured");
		return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
	}

	const isValid = await GitHubProvider.verifyWebhook(request, GITHUB_APP_WEBHOOK_SECRET, body);
	if (!isValid) {
		console.error("[GitHubApp] Invalid webhook signature");
		return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	}

	// Parse payload
	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(body);
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	// Get event type from GitHub header
	const eventType = request.headers.get("X-GitHub-Event");
	console.log(`[GitHubApp] Received webhook: ${eventType}`);

	// Handle installation lifecycle events
	if (eventType === "installation") {
		const action = payload.action as string;
		const installationId = extractInstallationId(payload);

		if (installationId && (action === "deleted" || action === "suspend")) {
			const status = action === "deleted" ? "deleted" : "suspended";
			await integrations.updateStatusByGitHubInstallationId(installationId, status);

			console.log(`[GitHubApp] Installation ${action}: ${installationId}`);
			return NextResponse.json({ success: true, message: `Installation ${action}` });
		}

		if (installationId && action === "unsuspend") {
			await integrations.updateStatusByGitHubInstallationId(installationId, "active");

			console.log(`[GitHubApp] Installation unsuspended: ${installationId}`);
			return NextResponse.json({ success: true, message: "Installation unsuspended" });
		}

		// Other installation events (created, new_permissions_accepted) - just acknowledge
		return NextResponse.json({ success: true, message: "Installation event acknowledged" });
	}

	// Extract installation ID for non-installation events
	const installationId = extractInstallationId(payload);
	if (!installationId) {
		console.log("[GitHubApp] No installation ID in payload, skipping");
		return NextResponse.json({
			success: true,
			message: "No installation ID, event skipped",
		});
	}

	// Find integration by github_installation_id
	const integration = await integrations.findActiveByGitHubInstallationId(installationId);

	if (!integration) {
		console.log(`[GitHubApp] No integration for installation: ${installationId}`);
		return NextResponse.json({
			success: true,
			message: "No integration found for installation",
		});
	}

	// Find active GitHub triggers for this integration
	const activeTriggers = await triggers.findActiveByIntegrationId(integration.id);

	if (activeTriggers.length === 0) {
		console.log(`[GitHubApp] No active triggers for integration: ${integration.id}`);
		return NextResponse.json({
			success: true,
			message: "No active triggers for this integration",
		});
	}

	// Get the provider for parsing
	const provider = getProviderByType("github");
	if (!provider) {
		console.error("[GitHubApp] GitHub provider not found");
		return NextResponse.json({ error: "Provider not found" }, { status: 500 });
	}

	// Parse the webhook payload into items
	const items = provider.parseWebhook(payload);

	if (items.length === 0) {
		console.log(`[GitHubApp] Event type not supported: ${eventType}`);
		return NextResponse.json({
			success: true,
			message: "Event type not supported",
		});
	}

	let processed = 0;
	let skipped = 0;

	// Process each trigger
	for (const trigger of activeTriggers) {
		const config = (trigger.config || {}) as GitHubTriggerConfig;

		for (const item of items) {
			// Apply provider filters
			const passesFilter = provider.filter(item, config);

			if (!passesFilter) {
				await createSkippedEventRecord(trigger, item, "filter_mismatch");
				skipped++;
				continue;
			}

			// Compute deduplication key
			const dedupKey = provider.computeDedupKey(item);

			// Check for duplicate
			if (dedupKey) {
				const existing = await triggers.findEventByDedupKey(trigger.id, dedupKey);

				if (existing) {
					skipped++;
					continue;
				}
			}

			// Parse context
			const parsedContext = provider.parseContext(item);

			// Create event record
			let event: { id: string };
			try {
				event = await triggers.createEvent({
					triggerId: trigger.id,
					organizationId: trigger.organizationId,
					externalEventId: provider.extractExternalId(item),
					providerEventType: provider.getEventType(item),
					rawPayload: item as unknown as Record<string, unknown>,
					parsedContext: parsedContext as unknown as Record<string, unknown>,
					dedupKey,
					status: "queued",
				});
			} catch (err) {
				console.error("[GitHubApp] Failed to create event:", err);
				continue;
			}

			processed++;

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
					console.error("[GitHubApp] Failed to queue event:", err);
					// Don't fail - event is recorded, can be processed later
				}
			}
		}
	}

	return NextResponse.json({
		success: true,
		processed,
		skipped,
	});
}
