/**
 * Automation run notification dispatch.
 *
 * Dispatches notifications on terminal run transitions.
 * Supports Slack channel posts and DMs.
 */

import { env } from "@proliferate/environment/server";
import type { Logger } from "@proliferate/logger";
import { integrations, notifications, runs, sessions, sideEffects } from "@proliferate/services";
import { decrypt, getEncryptionKey } from "@proliferate/shared/crypto";

/** Timeout for outbound Slack API calls (ms). */
const SLACK_TIMEOUT_MS = 10_000;
const SLACK_API_BASE = "https://slack.com/api";

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
// Slack DM helper
// ============================================

/**
 * Open a Slack DM channel with a user and post a message.
 */
async function postSlackDm(
	botToken: string,
	slackUserId: string,
	text: string,
	blocks: SlackBlock[],
): Promise<NotificationResult> {
	// Open DM channel with the user
	let dmChannelId: string;
	try {
		const openResponse = await fetch(`${SLACK_API_BASE}/conversations.open`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${botToken}`,
			},
			body: JSON.stringify({ users: slackUserId }),
			signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
		});
		const openResult = (await openResponse.json()) as {
			ok: boolean;
			channel?: { id: string };
			error?: string;
		};
		if (!openResult.ok || !openResult.channel?.id) {
			return { sent: false, error: `conversations.open: ${openResult.error ?? "unknown"}` };
		}
		dmChannelId = openResult.channel.id;
	} catch (err) {
		const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
		return {
			sent: false,
			error: isTimeout
				? `Slack DM open timed out after ${SLACK_TIMEOUT_MS}ms (retryable)`
				: `Slack DM open error (retryable): ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	// Post message to the DM channel
	try {
		const postResponse = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${botToken}`,
			},
			body: JSON.stringify({ channel: dmChannelId, text, blocks }),
			signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
		});
		const postResult = (await postResponse.json()) as { ok: boolean; error?: string };
		if (!postResult.ok) {
			return { sent: false, error: `chat.postMessage DM: ${postResult.error ?? "unknown"}` };
		}
		return { sent: true };
	} catch (err) {
		const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
		return {
			sent: false,
			error: isTimeout
				? `Slack DM post timed out after ${SLACK_TIMEOUT_MS}ms (retryable)`
				: `Slack DM post error (retryable): ${err instanceof Error ? err.message : String(err)}`,
		};
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
// Run notification dispatcher
// ============================================

const slackChannel = new SlackNotificationChannel();

export async function dispatchRunNotification(runId: string, logger: Logger): Promise<void> {
	const run = await runs.findRunWithRelations(runId);
	if (!run) {
		throw new Error(`Run not found: ${runId}`);
	}

	const destinationType = run.automation?.notificationDestinationType ?? null;

	// Explicit "none" disables notifications
	if (destinationType === "none") {
		logger.debug({ runId }, "Notifications disabled for this automation");
		return;
	}

	const slackInstallationId = run.automation?.notificationSlackInstallationId ?? null;

	// DM mode: send to a specific Slack user via DM
	if (destinationType === "slack_dm_user") {
		const slackUserId = run.automation?.notificationSlackUserId ?? null;
		if (!slackUserId) {
			logger.warn({ runId }, "DM notifications configured but no Slack user ID set");
			return;
		}

		const effectId = `notify:${runId}:dm:${run.status}`;
		const existingDm = await sideEffects.findSideEffect(run.organizationId, effectId);
		if (existingDm) {
			logger.info({ runId, effectId }, "DM notification already sent (idempotent replay)");
			return;
		}

		const dmResult = await sendSlackDmNotification({
			organizationId: run.organizationId,
			slackInstallationId,
			slackUserId,
			blocks: buildSlackBlocks({
				runId: run.id,
				status: run.status ?? "unknown",
				automationId: run.automationId,
				automationName: run.automation?.name ?? "Automation",
				organizationId: run.organizationId,
				statusReason: run.statusReason ?? null,
				errorMessage: run.errorMessage ?? null,
				summaryMarkdown: extractSummary(run.completionJson),
				channelId: "",
				slackInstallationId,
			}),
			logger,
		});

		if (dmResult.sent) {
			await sideEffects.recordOrReplaySideEffect({
				organizationId: run.organizationId,
				runId,
				effectId,
				kind: "notification",
				provider: "slack_dm",
				requestHash: `${slackUserId}:${run.status}`,
			});
			logger.info({ runId, slackUserId }, "Run DM notification sent");
		} else if (dmResult.error) {
			logger.error({ runId, error: dmResult.error }, "Run DM notification failed");
			throw new Error(`slack_dm: ${dmResult.error}`);
		}
		return;
	}

	// Channel mode (default / legacy)
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
		slackInstallationId,
	};

	const effectId = `notify:${runId}:slack:${run.status}`;
	const existing = await sideEffects.findSideEffect(run.organizationId, effectId);
	if (existing) {
		logger.info({ runId, effectId }, "Notification already sent (idempotent replay)");
		return;
	}

	const result = await slackChannel.send(notification, logger);
	if (result.sent) {
		await sideEffects.recordOrReplaySideEffect({
			organizationId: run.organizationId,
			runId,
			effectId,
			kind: "notification",
			provider: "slack",
			requestHash: `${channelId}:${run.status}`,
		});
		logger.info({ runId, status: run.status }, "Run notification dispatched to channel");
	} else if (result.error) {
		logger.error({ runId, error: result.error }, "Run notification dispatch failed");
		throw new Error(`slack: ${result.error}`);
	}
}

// ============================================
// Session completion notification dispatcher
// ============================================

/**
 * Dispatch notifications for a completed session.
 * Looks up subscriptions and sends DMs via Slack.
 */
export async function dispatchSessionNotification(
	sessionId: string,
	logger: Logger,
): Promise<void> {
	const subscriptions = await notifications.listSessionSubscriptions(sessionId);
	if (subscriptions.length === 0) {
		logger.debug({ sessionId }, "No session notification subscriptions");
		return;
	}

	// Fetch session info for the notification message
	const session = await sessions.findByIdInternal(sessionId);
	if (!session) {
		throw new Error(`Session not found: ${sessionId}`);
	}

	const appUrl = env.NEXT_PUBLIC_APP_URL;
	const sessionUrl = `${appUrl}/dashboard/sessions/${sessionId}`;
	const title = session.title ?? "Coding Session";
	const statusLabel =
		session.status === "completed" ? "Session Completed" : `Session ${session.status}`;

	const blocks: SlackBlock[] = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: `*${statusLabel}* · ${title}`,
			},
			accessory: {
				type: "button",
				text: { type: "plain_text", text: "View Session", emoji: true },
				url: sessionUrl,
			},
		},
	];

	const failures: Array<{ subscriptionId: string; error: string }> = [];

	for (const sub of subscriptions) {
		if (!sub.slackUserId) continue;

		const log = logger.child({ sessionId, subscriptionId: sub.id, slackUserId: sub.slackUserId });
		try {
			const result = await sendSlackDmNotification({
				organizationId: session.organizationId,
				slackInstallationId: sub.slackInstallationId,
				slackUserId: sub.slackUserId,
				blocks,
				logger: log,
			});
			if (result.sent) {
				log.info("Session completion DM sent");
			} else if (result.error) {
				log.error({ error: result.error }, "Session completion DM failed");
				failures.push({ subscriptionId: sub.id, error: result.error });
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.error({ err }, "Failed to send session notification DM");
			failures.push({ subscriptionId: sub.id, error: message });
		}
	}

	if (failures.length > 0) {
		throw new Error(
			`Session notification delivery failed for ${failures.length}/${subscriptions.length} subscriptions`,
		);
	}
}

// ============================================
// Shared DM send helper
// ============================================

/**
 * Send a Slack DM notification to a user.
 * Resolves the bot token from the installation and opens a DM channel.
 *
 * For run notifications, callers handle idempotency via side effects.
 * For session notifications, the outbox provides at-most-once delivery.
 */
async function sendSlackDmNotification(input: {
	organizationId: string;
	slackInstallationId: string | null;
	slackUserId: string;
	blocks: SlackBlock[];
	logger: Logger;
}): Promise<NotificationResult> {
	const installation = await integrations.getSlackInstallationForNotifications(
		input.organizationId,
		input.slackInstallationId,
	);
	if (!installation) {
		input.logger.warn(
			{ installationId: input.slackInstallationId },
			"No Slack installation found for DM",
		);
		return { sent: false, error: "No Slack installation found" };
	}

	const botToken = decrypt(installation.encryptedBotToken, getEncryptionKey());
	const fallbackText = input.blocks[0]?.text?.text ?? "Notification";
	return postSlackDm(botToken, input.slackUserId, fallbackText, input.blocks);
}

function extractSummary(completionJson: unknown): string | null {
	if (!completionJson || typeof completionJson !== "object") return null;
	const json = completionJson as Record<string, unknown>;
	if (typeof json.summary_markdown === "string") return json.summary_markdown;
	if (typeof json.summaryMarkdown === "string") return json.summaryMarkdown;
	return null;
}
