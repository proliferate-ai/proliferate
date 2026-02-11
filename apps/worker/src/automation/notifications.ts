/**
 * Automation run notification dispatch.
 *
 * Dispatches notifications on terminal run transitions.
 * Currently supports Slack; channel abstraction allows future email/in-app.
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import { integrations, runs } from "@proliferate/services";
import { decrypt, getEncryptionKey } from "@proliferate/shared/crypto";

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
	const runUrl = `${appUrl}/automations/${notification.automationId}/runs/${notification.runId}`;

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
		);
		if (!installation) {
			logger.debug({ orgId: notification.organizationId }, "No Slack installation for org");
			return { sent: false };
		}

		const botToken = decrypt(installation.encryptedBotToken, getEncryptionKey());
		const blocks = buildSlackBlocks(notification);
		const fallbackText = `${blocks[0]?.text?.text ?? "Automation run notification"}`;

		const response = await fetch("https://slack.com/api/chat.postMessage", {
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
		});

		const result = (await response.json()) as { ok: boolean; error?: string };
		if (!result.ok) {
			return { sent: false, error: result.error ?? "Slack API error" };
		}

		return { sent: true };
	}
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

	const channelId = run.automation?.notificationChannelId;
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
	};

	for (const channel of channels) {
		try {
			const result = await channel.send(notification, logger);
			if (result.sent) {
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
