/**
 * Slack API Client
 *
 * Pure Slack API wrapper - no business logic, just clean API calls.
 * This is used by handlers to post messages, upload files, etc.
 */

import { decrypt, getEncryptionKey } from "@proliferate/shared/crypto";

export interface SlackBlock {
	type: string;
	text?: { type: string; text: string };
	elements?: Array<{
		type: string;
		text?: { type: string; text: string; emoji?: boolean };
		url?: string;
		style?: string;
	}>;
}

export interface PostMessageOptions {
	text: string;
	blocks?: SlackBlock[];
}

export class SlackApiClient {
	private readonly botToken: string;
	private readonly channelId: string;
	private readonly threadTs: string;

	constructor(encryptedBotToken: string, channelId: string, threadTs: string) {
		this.botToken = decrypt(encryptedBotToken, getEncryptionKey());
		this.channelId = channelId;
		this.threadTs = threadTs;
	}

	/**
	 * Post a text message to the thread
	 */
	async postMessage(text: string): Promise<boolean> {
		return this.post({ text });
	}

	/**
	 * Post a message with blocks
	 */
	async postBlocks(blocks: SlackBlock[], fallbackText: string): Promise<boolean> {
		return this.post({ text: fallbackText, blocks });
	}

	/**
	 * Upload a file to the thread using Slack's new upload flow
	 * 1. Get upload URL from files.getUploadURLExternal
	 * 2. Upload file to that URL
	 * 3. Complete upload with files.completeUploadExternal
	 */
	async uploadFile(filename: string, content: ArrayBuffer, _contentType: string): Promise<boolean> {
		try {
			// Step 1: Get upload URL
			const getUrlResponse = await fetch(
				`https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${content.byteLength}`,
				{
					method: "GET",
					headers: { Authorization: `Bearer ${this.botToken}` },
				},
			);

			const urlResult = (await getUrlResponse.json()) as {
				ok: boolean;
				error?: string;
				upload_url?: string;
				file_id?: string;
			};

			if (!urlResult.ok || !urlResult.upload_url || !urlResult.file_id) {
				console.error("[SlackApiClient] Failed to get upload URL:", urlResult.error);
				return false;
			}

			// Step 2: Upload file to the presigned URL
			const uploadResponse = await fetch(urlResult.upload_url, {
				method: "POST",
				body: content,
			});

			if (!uploadResponse.ok) {
				console.error("[SlackApiClient] Failed to upload to presigned URL:", uploadResponse.status);
				return false;
			}

			// Step 3: Complete the upload and share to channel/thread
			const completeResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.botToken}`,
				},
				body: JSON.stringify({
					files: [{ id: urlResult.file_id, title: filename }],
					channel_id: this.channelId,
					thread_ts: this.threadTs,
				}),
			});

			const completeResult = (await completeResponse.json()) as { ok: boolean; error?: string };
			if (!completeResult.ok) {
				console.error("[SlackApiClient] Failed to complete upload:", completeResult.error);
				return false;
			}

			return true;
		} catch (err) {
			console.error("[SlackApiClient] Upload error:", err);
			return false;
		}
	}

	/**
	 * Upload multiple files to the thread as a single message.
	 * Files are uploaded in parallel, then shared together in one completeUploadExternal call.
	 */
	async uploadFiles(
		files: Array<{ filename: string; content: ArrayBuffer; contentType: string }>,
	): Promise<number> {
		if (files.length === 0) return 0;

		// Step 1: Get upload URLs for all files in parallel
		const urlPromises = files.map(async (file) => {
			const response = await fetch(
				`https://slack.com/api/files.getUploadURLExternal?filename=${encodeURIComponent(file.filename)}&length=${file.content.byteLength}`,
				{
					method: "GET",
					headers: { Authorization: `Bearer ${this.botToken}` },
				},
			);
			const result = (await response.json()) as {
				ok: boolean;
				error?: string;
				upload_url?: string;
				file_id?: string;
			};
			if (!result.ok || !result.upload_url || !result.file_id) {
				console.error("[SlackApiClient] Failed to get upload URL:", result.error);
				return null;
			}
			return { ...file, upload_url: result.upload_url, file_id: result.file_id };
		});

		const filesWithUrls = (await Promise.all(urlPromises)).filter(Boolean) as Array<{
			filename: string;
			content: ArrayBuffer;
			upload_url: string;
			file_id: string;
		}>;

		if (filesWithUrls.length === 0) return 0;

		// Step 2: Upload all files to their presigned URLs in parallel
		const uploadPromises = filesWithUrls.map(async (file) => {
			const response = await fetch(file.upload_url, {
				method: "POST",
				body: file.content,
			});
			if (!response.ok) {
				console.error("[SlackApiClient] Failed to upload to presigned URL:", response.status);
				return null;
			}
			return file;
		});

		const uploadedFiles = (await Promise.all(uploadPromises)).filter(Boolean) as Array<{
			filename: string;
			file_id: string;
		}>;

		if (uploadedFiles.length === 0) return 0;

		// Step 3: Complete all uploads in a single call - files appear as one message
		const completeResponse = await fetch("https://slack.com/api/files.completeUploadExternal", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.botToken}`,
			},
			body: JSON.stringify({
				files: uploadedFiles.map((f) => ({ id: f.file_id, title: f.filename })),
				channel_id: this.channelId,
				thread_ts: this.threadTs,
			}),
		});

		const completeResult = (await completeResponse.json()) as { ok: boolean; error?: string };
		if (!completeResult.ok) {
			console.error("[SlackApiClient] Failed to complete upload:", completeResult.error);
			return 0;
		}

		return uploadedFiles.length;
	}

	private async post(options: PostMessageOptions): Promise<boolean> {
		const response = await fetch("https://slack.com/api/chat.postMessage", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.botToken}`,
			},
			body: JSON.stringify({
				channel: this.channelId,
				thread_ts: this.threadTs,
				text: options.text,
				...(options.blocks && { blocks: options.blocks }),
			}),
		});

		const result = (await response.json()) as { ok: boolean; error?: string };
		if (!result.ok) {
			console.error("[SlackApiClient] Failed to post message:", result.error);
			return false;
		}
		return true;
	}
}
