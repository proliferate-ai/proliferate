/**
 * GitHub App Webhook Endpoint (Installation lifecycle only)
 *
 * Handles GitHub App installation lifecycle events (created, deleted,
 * suspended, unsuspended). Trigger event processing has been moved
 * to the trigger service.
 */

import { logger } from "@/lib/logger";
import { env } from "@proliferate/environment/server";
import { integrations } from "@proliferate/services";
import { GitHubProvider } from "@proliferate/triggers";
import { NextResponse } from "next/server";

const log = logger.child({ handler: "github-app" });

const GITHUB_APP_WEBHOOK_SECRET = env.GITHUB_APP_WEBHOOK_SECRET;

/**
 * Extract installation ID from GitHub webhook payload.
 */
function extractInstallationId(payload: Record<string, unknown>): string | null {
	const installation = payload.installation as { id?: number } | undefined;
	if (installation?.id) {
		return String(installation.id);
	}
	return null;
}

export async function POST(request: Request) {
	const body = await request.text();

	// Verify webhook signature
	if (!GITHUB_APP_WEBHOOK_SECRET) {
		log.error("GITHUB_APP_WEBHOOK_SECRET not configured");
		return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
	}

	const isValid = await GitHubProvider.verifyWebhook(request, GITHUB_APP_WEBHOOK_SECRET, body);
	if (!isValid) {
		log.error("Invalid webhook signature");
		return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	}

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(body);
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const eventType = request.headers.get("X-GitHub-Event");
	log.info({ eventType }, "Received webhook");

	// Handle installation lifecycle events only
	if (eventType === "installation") {
		const action = payload.action as string;
		const installationId = extractInstallationId(payload);

		if (installationId && (action === "deleted" || action === "suspend")) {
			const status = action === "deleted" ? "deleted" : "suspended";
			await integrations.updateStatusByGitHubInstallationId(installationId, status);
			log.info({ action, installationId }, "Installation lifecycle event");
			return NextResponse.json({ success: true, message: `Installation ${action}` });
		}

		if (installationId && action === "unsuspend") {
			await integrations.updateStatusByGitHubInstallationId(installationId, "active");
			log.info({ installationId }, "Installation unsuspended");
			return NextResponse.json({ success: true, message: "Installation unsuspended" });
		}

		return NextResponse.json({ success: true, message: "Installation event acknowledged" });
	}

	// All other GitHub events (push, issues, PRs, etc.) are now handled
	// by the trigger service. Return 200 to prevent retries.
	return NextResponse.json({
		success: true,
		message: "Event processing migrated to trigger service",
	});
}
