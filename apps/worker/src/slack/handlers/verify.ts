/**
 * Verify Tool Handler
 *
 * Uploads verification media to Slack and posts a summary with dashboard link.
 */

import type { VerificationFile } from "@proliferate/gateway-clients";
import type { HandlerContext, ToolHandler } from "./index";

export const verifyToolHandler: ToolHandler = {
	tools: ["verify"],

	async handle(ctx: HandlerContext, _toolName: string, result: string): Promise<void> {
		const logger = ctx.logger.child({ handler: "verify" });

		// Parse the result to get the S3 key prefix
		let key: string;
		try {
			const parsed = JSON.parse(result) as { key?: string };
			if (!parsed.key) {
				// No key = no files uploaded, just post the raw result
				await ctx.slackClient.postMessage(`Verification: ${result}`);
				return;
			}
			key = parsed.key;
		} catch {
			// Not JSON - might be an error message
			await ctx.slackClient.postMessage(`Verification: ${result}`);
			return;
		}

		logger.info({ key }, "Fetching files for key");

		// Fetch file list from gateway
		let files: VerificationFile[];
		try {
			files = await ctx.syncClient.tools.verification.list(ctx.sessionId, { prefix: key });
		} catch (err) {
			logger.error({ err }, "Failed to list files");
			await ctx.slackClient.postMessage("Verification complete (unable to load previews)");
			return;
		}

		if (!files || files.length === 0) {
			await ctx.slackClient.postMessage("Verification complete (no files)");
			return;
		}

		// Separate media from other files
		const mediaFiles = files.filter(
			(f: VerificationFile) =>
				f.contentType.startsWith("image/") || f.contentType.startsWith("video/"),
		);
		const otherFiles = files.filter(
			(f: VerificationFile) =>
				!f.contentType.startsWith("image/") && !f.contentType.startsWith("video/"),
		);

		// Upload media files to Slack in parallel, batched into a single message
		const filesToUpload = mediaFiles.slice(0, 5);
		logger.info({ count: filesToUpload.length }, "Uploading media files");

		// Fetch all files from gateway in parallel
		const fileContents = await Promise.all(
			filesToUpload.map(async (file: VerificationFile) => {
				try {
					const { data, contentType } = await ctx.syncClient.tools.verification.getStream(
						ctx.sessionId,
						file.key,
					);
					return { filename: file.name, content: data, contentType };
				} catch (err) {
					logger.error({ err, filename: file.name }, "Failed to fetch file");
					return null;
				}
			}),
		);

		const validFiles = fileContents.filter(Boolean) as Array<{
			filename: string;
			content: ArrayBuffer;
			contentType: string;
		}>;

		const uploaded = await ctx.slackClient.uploadFiles(validFiles);
		logger.info({ uploaded, total: filesToUpload.length }, "Uploaded files");

		// Build summary
		const summaryParts: string[] = [];
		if (mediaFiles.length > 5) {
			summaryParts.push(`Showing ${filesToUpload.length} of ${mediaFiles.length} images/videos`);
		}
		if (otherFiles.length > 0) {
			summaryParts.push(
				`${otherFiles.length} other file(s): ${otherFiles.map((f: VerificationFile) => f.name).join(", ")}`,
			);
		}

		// Post summary with dashboard link
		const sessionUrl = `${ctx.appUrl}/session/${ctx.sessionId}`;
		await ctx.slackClient.postBlocks(
			[
				{
					type: "section",
					text: {
						type: "mrkdwn",
						text:
							summaryParts.length > 0
								? `*Verification complete*\n${summaryParts.join("\n")}`
								: "*Verification complete*",
					},
				},
				{
					type: "actions",
					elements: [
						{
							type: "button",
							text: { type: "plain_text", text: "View full report", emoji: true },
							url: sessionUrl,
							style: "primary",
						},
					],
				},
			],
			"Verification complete",
		);
	},
};
