/**
 * Automation run notification dispatch.
 *
 * Dispatches notifications on terminal run transitions.
 * Currently supports Slack; channel abstraction allows future email/in-app.
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import { integrations, runs, sideEffects } from "@proliferate/services";
import { decrypt, getEncryptionKey } from "@proliferate/shared/crypto";

/** Timeout for outbound Slack API calls (ms). */
const SLACK_TIMEOUT_MS = 10_000;

// ============================================
// Channel abstraction
// ============================================

export interface RunNotification {
	runId: string;
	status: string;
	automationId: string;
	automationName: string;
	organizationId: string;
	channelId: string;
	slackInstallationId: string | null;
	statusReason: string | null;
	errorMessage: string | null;
	summaryMarkdown: string | null;
}

export interface NotificationResult {
	sent: boolean;
	error?: string;
}

export interface NotificationChannel {
	name: string;
	send(notification: RunNotification, logger: Logger): Promise<NotificationResult>;
}

// ============================================
// Slack channel
// ============================================

interface SlackBlock {
	type: string;
	text?: { type: string; text: string };
	accessory?: {
		type: string;
		text?: { type: string; text: string; emoji?: boolean };
		url?: string;
	};
}

function buildSlackBlocks(notification: RunNotification): SlackBlock[] {
	const appUrl = env.NEXT_PUBLIC_APP_URL;
	const runUrl = `${appUrl}/dashboard/automations/${notification.automationId}/events`;

	const statusLabels: Record<string, string> = {
		succeeded: "Run Succeeded",
		failed: "Run Failed",
		timed_out: "Run Timed Out",
		needs_human: "Run Needs Review",
	};

	const header = statusLabels[notification.status] ?? `Run ${notification.status}`;

	let detail: string;
	switch (notification.status) {
		case "succeeded":
			detail = notification.summaryMarkdown ?? "The run completed successfully.";
			break;
		case "failed":
			detail = notification.errorMessage
				? `Reason: ${notification.statusReason ?? "unknown"} — ${notification.errorMessage}`
				: `Reason: ${notification.statusReason ?? "unknown"}`;
			break;
		case "timed_out":
			detail = "The run exceeded its deadline.";
			break;
		case "needs_human":
			detail = notification.summaryMarkdown ?? "The agent needs human review to proceed.";
			break;
		default:
			detail = notification.statusReason ?? "";
	}

	return [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*${header}* · ${notification.automationName}\n${detail}`,
			},
			accessory: {
				type: "button",
				text: { type: "plain_text", text: "View Run", emoji: true },
				url: runUrl,
			},
		},
	];
}

class SlackNotificationChannel implements NotificationChannel {
	name = "slack";

	async send(notification: RunNotification, logger: Logger): Promise<NotificationResult> {
		const installation = await integrations.getSlackInstallationForNotifications(
			notification.organizationId,
			notification.slackInstallationId,
		);
		if (!installation) {
			if (notification.slackInstallationId) {
				const message = `Slack installation ${notification.slackInstallationId} not found or revoked for org ${notification.organizationId}. Update the automation notification settings.`;
				logger.warn(
					{
						orgId: notification.organizationId,
						installationId: notification.slackInstallationId,
						runId: notification.runId,
					},
					message,
				);
				return { sent: false, error: message };
			}
			logger.debug({ orgId: notification.organizationId }, "No Slack installation for org");
			return { sent: false };
		}

		const botToken = decrypt(installation.encryptedBotToken, getEncryptionKey());
		const blocks = buildSlackBlocks(notification);
		const fallbackText = `${blocks[0]?.text?.text ?? "Automation run notification"}`;

		let response: Response;
		try {
			response = await fetch("https://slack.com/api/chat.postMessage", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${botToken}`,
				},
				body: JSON.stringify({
					channel: notification.channelId,
					text: fallbackText,
					blocks,
				}),
				signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
			});
		} catch (err) {
			const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
			const message = isTimeout
				? `Slack API timed out after ${SLACK_TIMEOUT_MS}ms (retryable)`
				: `Slack API network error (retryable): ${err instanceof Error ? err.message : String(err)}`;
			logger.warn({ err, runId: notification.runId, timeoutMs: SLACK_TIMEOUT_MS }, message);
			return { sent: false, error: message };
		}

		const result = (await response.json()) as { ok: boolean; error?: string };
		if (!result.ok) {
			return { sent: false, error: result.error ?? "Slack API error" };
		}

		return { sent: true };
	}
}

// ============================================
// Channel resolution
// ============================================

/**
 * Resolve the Slack channel ID for an automation.
 *
 * Prefers the dedicated `notificationChannelId` column. Falls back to
 * `enabled_tools.slack_notify.channelId` for backward compatibility with
 * automations configured before the column existed.
 */
export function resolveNotificationChannelId(
	notificationChannelId: string | null | undefined,
	enabledTools: unknown,
): string | null {
	if (notificationChannelId) return notificationChannelId;

	if (enabledTools && typeof enabledTools === "object") {
		const tools = enabledTools as Record<string, unknown>;
		const slackNotify = tools.slack_notify;
		if (slackNotify && typeof slackNotify === "object") {
			const config = slackNotify as Record<string, unknown>;
			if (config.enabled && typeof config.channelId === "string" && config.channelId) {
				return config.channelId;
			}
		}
	}

	return null;
}

// ============================================
// Dispatcher
// ============================================

const channels: NotificationChannel[] = [new SlackNotificationChannel()];

export async function dispatchRunNotification(runId: string, logger: Logger): Promise<void> {
	const run = await runs.findRunWithRelations(runId);
	if (!run) {
		throw new Error(`Run not found: ${runId}`);
	}

	const channelId = resolveNotificationChannelId(
		run.automation?.notificationChannelId,
		run.automation?.enabledTools,
	);
	if (!channelId) {
		logger.debug({ runId }, "No notification channel configured");
		return;
	}

	const notification: RunNotification = {
		runId: run.id,
		status: run.status ?? "unknown",
		automationId: run.automationId,
		automationName: run.automation?.name ?? "Automation",
		organizationId: run.organizationId,
		statusReason: run.statusReason ?? null,
		errorMessage: run.errorMessage ?? null,
		summaryMarkdown: extractSummary(run.completionJson),
		channelId,
		slackInstallationId: run.automation?.notificationSlackInstallationId ?? null,
	};

	for (const channel of channels) {
		const effectId = `notify:${runId}:${channel.name}:${run.status}`;

		// Check idempotency: skip if this notification was already sent
		const existing = await sideEffects.findSideEffect(run.organizationId, effectId);
		if (existing) {
			logger.info(
				{ runId, channel: channel.name, status: run.status, effectId },
				"Notification already sent (idempotent replay)",
			);
			continue;
		}

		try {
			const result = await channel.send(notification, logger);
			if (result.sent) {
				// Record side effect only after successful send so transient
				// failures do not permanently suppress the notification on retry.
				await sideEffects.recordOrReplaySideEffect({
					organizationId: run.organizationId,
					runId,
					effectId,
					kind: "notification",
					provider: channel.name,
					requestHash: `${channelId}:${run.status}`,
				});
				logger.info(
					{ runId, channel: channel.name, status: run.status },
					"Notification dispatched",
				);
			} else if (result.error) {
				logger.error(
					{ runId, channel: channel.name, error: result.error },
					"Notification dispatch failed",
				);
				throw new Error(`${channel.name}: ${result.error}`);
			}
		} catch (err) {
			logger.error({ err, runId, channel: channel.name }, "Notification channel error");
			throw err;
		}
	}
}

function extractSummary(completionJson: unknown): string | null {
	if (!completionJson || typeof completionJson !== "object") return null;
	const json = completionJson as Record<string, unknown>;
	if (typeof json.summary_markdown === "string") return json.summary_markdown;
	if (typeof json.summaryMarkdown === "string") return json.summaryMarkdown;
	return null;
}
