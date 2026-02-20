/**
 * Shared Slack utilities
 */

import type { Logger } from "@proliferate/logger";
import { decrypt, getEncryptionKey } from "@proliferate/shared/crypto";

/**
 * Download an image from Slack and convert to base64
 * Returns null if download fails
 *
 * Note: Slack's private URLs redirect to a CDN. We need to handle this manually
 * because fetch drops Authorization headers on cross-origin redirects.
 */
export async function downloadSlackImageAsBase64(
	url: string,
	encryptedBotToken: string,
	logger: Logger,
): Promise<{ data: string; mediaType: string } | null> {
	try {
		const botToken = decrypt(encryptedBotToken, getEncryptionKey());

		// First request with auth - may redirect to CDN
		const authResponse = await fetch(url, {
			headers: { Authorization: `Bearer ${botToken}` },
			redirect: "manual", // Don't auto-follow, we need to handle it
		});

		let finalResponse: Response;

		if (authResponse.status >= 300 && authResponse.status < 400) {
			// Got a redirect - follow it without auth (CDN doesn't need it)
			const redirectUrl = authResponse.headers.get("location");
			if (!redirectUrl) {
				logger.error("Redirect without location header");
				return null;
			}
			logger.debug("Following redirect to CDN");
			finalResponse = await fetch(redirectUrl);
		} else {
			finalResponse = authResponse;
		}

		if (!finalResponse.ok) {
			logger.error({ status: finalResponse.status }, "Failed to download image");
			return null;
		}

		const mediaType = finalResponse.headers.get("content-type") || "image/png";

		// Validate we actually got an image, not an HTML error page
		if (!mediaType.startsWith("image/")) {
			logger.error({ mediaType, url }, "Expected image but got different content type");
			return null;
		}

		const buffer = await finalResponse.arrayBuffer();
		const base64 = Buffer.from(buffer).toString("base64");

		logger.info({ mediaType, bytes: base64.length }, "Downloaded image");
		return { data: base64, mediaType };
	} catch (err) {
		logger.error({ err }, "Failed to download image");
		return null;
	}
}

/**
 * Post a message to Slack using encrypted token
 */
export async function postToSlack(
	encryptedBotToken: string,
	channelId: string,
	threadTs: string,
	text: string,
	logger: Logger,
): Promise<void> {
	const botToken = decrypt(encryptedBotToken, getEncryptionKey());

	const response = await fetch("https://slack.com/api/chat.postMessage", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${botToken}`,
		},
		body: JSON.stringify({
			channel: channelId,
			thread_ts: threadTs,
			text,
		}),
	});

	const result = await response.json();
	if (!result.ok) {
		logger.error({ error: result.error }, "Failed to post message");
	}
}

/**
 * Post a welcome message with buttons to Slack when a new session is created
 */
export async function postWelcomeMessage(
	encryptedBotToken: string,
	channelId: string,
	threadTs: string,
	sessionId: string,
	appUrl: string,
	orgId: string | undefined,
	logger: Logger,
): Promise<void> {
	const botToken = decrypt(encryptedBotToken, getEncryptionKey());

	const orgQuery = orgId ? `?orgId=${orgId}` : "";
	const sessionUrl = `${appUrl}/dashboard/sessions/${sessionId}${orgQuery}`;
	const previewUrl = `${appUrl}/preview/${sessionId}${orgQuery}`;

	const blocks = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: "*Proliferate will respond in this thread.*\nFeel free to chat here or check out the web-app & live app preview.",
			},
		},
		{
			type: "actions",
			elements: [
				{
					type: "button",
					text: { type: "plain_text", text: "Open web app", emoji: true },
					url: sessionUrl,
					style: "primary",
				},
				{
					type: "button",
					text: { type: "plain_text", text: "View live preview", emoji: true },
					url: previewUrl,
				},
			],
		},
	];

	const response = await fetch("https://slack.com/api/chat.postMessage", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${botToken}`,
		},
		body: JSON.stringify({
			channel: channelId,
			thread_ts: threadTs,
			blocks,
			text: "Talk to Proliferate in this thread", // Fallback for notifications
		}),
	});

	const result = await response.json();
	if (!result.ok) {
		logger.error({ error: result.error }, "Failed to post welcome message");
	}
}

/**
 * Format tool output for Slack
 */
export function formatToolMessage(toolName: string, result: string): string {
	const maxLength = 2000;
	const truncatedResult = result.length > maxLength ? `${result.slice(0, maxLength)}...` : result;
	return `*Tool: ${toolName}*\n\`\`\`\n${truncatedResult}\n\`\`\``;
}

/**
 * Determine if we should post tool output to Slack
 */
export function shouldPostTool(_toolName: string): boolean {
	return false;
}

/**
 * Upload a file to Slack using the new upload flow
 */
export async function uploadFileToSlack(
	encryptedBotToken: string,
	channelId: string,
	threadTs: string,
	filename: string,
	content: Uint8Array | ArrayBuffer,
	_contentType: string,
	logger: Logger,
): Promise<boolean> {
	const botToken = decrypt(encryptedBotToken, getEncryptionKey());
	const byteLength = content instanceof ArrayBuffer ? content.byteLength : content.length;

	try {
		// Step 1: Get upload URL
		const getUrlResponse = await fetch(
			`https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${byteLength}`,
			{
				method: "GET",
				headers: { Authorization: `Bearer ${botToken}` },
			},
		);

		const urlResult = (await getUrlResponse.json()) as {
			ok: boolean;
			error?: string;
			upload_url?: string;
			file_id?: string;
		};

		if (!urlResult.ok || !urlResult.upload_url || !urlResult.file_id) {
			logger.error({ error: urlResult.error }, "Failed to get upload URL");
			return false;
		}

		// Step 2: Upload file to the presigned URL
		const uploadResponse = await fetch(urlResult.upload_url, {
			method: "POST",
			body: content as BodyInit,
		});

		if (!uploadResponse.ok) {
			logger.error({ status: uploadResponse.status }, "Failed to upload to presigned URL");
			return false;
		}

		// Step 3: Complete the upload and share to channel/thread
		const completeResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${botToken}`,
			},
			body: JSON.stringify({
				files: [{ id: urlResult.file_id, title: filename }],
				channel_id: channelId,
				thread_ts: threadTs,
			}),
		});

		const completeResult = (await completeResponse.json()) as { ok: boolean; error?: string };
		if (!completeResult.ok) {
			logger.error({ error: completeResult.error }, "Failed to complete upload");
			return false;
		}

		return true;
	} catch (err) {
		logger.error({ err }, "Upload error");
		return false;
	}
}
