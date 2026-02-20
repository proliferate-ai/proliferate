/**
 * Slack Client
 *
 * Extends AsyncClient for Slack integration.
 * Uses gateway SDK for session creation.
 */

import { env } from "@proliferate/environment/server";
import type { ServerMessage } from "@proliferate/gateway-clients";
import { AsyncClient } from "@proliferate/gateway-clients/server";
import type { AsyncClientDeps } from "@proliferate/gateway-clients/server";
import type { Logger } from "@proliferate/logger";
import { ensureSlackReceiver } from "@proliferate/queue";
import type { SlackMessageJob, SlackReceiverJob } from "@proliferate/queue";
import { integrations, sessions } from "@proliferate/services";
import type { ClientSource, WakeOptions } from "@proliferate/shared";
import { SlackApiClient } from "./api";
import {
	type HandlerContext,
	type ToolHandler,
	defaultToolHandler,
	textPartCompleteHandler,
	todoWriteToolHandler,
	verifyToolHandler,
} from "./handlers";
import { downloadSlackImageAsBase64, postToSlack, postWelcomeMessage } from "./lib";

const APP_URL = env.NEXT_PUBLIC_APP_URL;

/**
 * Metadata stored in sessions.client_metadata for Slack sessions
 */
export interface SlackClientMetadata {
	installationId: string;
	channelId: string;
	threadTs: string;
	/** Encrypted bot token - included when passed to receiver */
	encryptedBotToken?: string;
}

// Tools we actually want to post about (most are too noisy)
const SIGNIFICANT_TOOLS = ["verify", "todowrite"];

// Tool handlers in priority order (first match wins)
const toolHandlers: ToolHandler[] = [verifyToolHandler, todoWriteToolHandler, defaultToolHandler];

/**
 * Find handler for a tool
 */
function findToolHandler(toolName: string): ToolHandler {
	const normalized = toolName.toLowerCase();
	for (const handler of toolHandlers) {
		if (handler.tools.length === 0) {
			return handler;
		}
		if (handler.tools.some((t) => normalized === t || normalized.includes(t))) {
			return handler;
		}
	}
	return defaultToolHandler;
}

/**
 * Check if a tool is significant enough to post about
 */
function isSignificantTool(toolName: string): boolean {
	const normalized = toolName.toLowerCase();
	return SIGNIFICANT_TOOLS.some((t) => normalized === t || normalized.includes(t));
}

/**
 * Slack client extending AsyncClient
 */
export class SlackClient extends AsyncClient<
	SlackClientMetadata,
	SlackMessageJob,
	SlackReceiverJob
> {
	readonly clientType = "slack" as ClientSource;
	private readonly logger: Logger;

	constructor(deps: AsyncClientDeps, logger: Logger) {
		super(deps);
		this.logger = logger;
	}

	/**
	 * Wake the Slack client for a session event.
	 * Overrides base class to fetch encrypted bot token before queuing.
	 * Also posts the user message to Slack immediately (before receiver connects).
	 */
	override async wake(
		sessionId: string,
		metadata: SlackClientMetadata,
		source: ClientSource,
		options?: WakeOptions,
	): Promise<void> {
		// Don't wake for Slack-originated events
		if (source === "slack") {
			this.logger.debug("Skipping wake for Slack-originated event");
			return;
		}

		// Get the encrypted bot token from the installation
		const encryptedBotToken = await this.getEncryptedBotToken(metadata.installationId);
		if (!encryptedBotToken) {
			this.logger.error(
				{ installationId: metadata.installationId },
				"No bot token found for installation",
			);
			return;
		}

		// Post the user message to Slack immediately (before receiver connects)
		if (options?.content) {
			this.logger.info({ threadTs: metadata.threadTs }, "Posting web user message to Slack thread");
			await postToSlack(
				encryptedBotToken,
				metadata.channelId,
				metadata.threadTs,
				`\u{1F4AC} *User:*\n${options.content}`,
				this.logger,
			);
		}

		// Build receiver job data
		const jobData: SlackReceiverJob = {
			sessionId,
			installationId: metadata.installationId,
			channelId: metadata.channelId,
			threadTs: metadata.threadTs,
			encryptedBotToken,
		};

		// Ensure receiver job exists (deduped by jobId)
		await ensureSlackReceiver(this.receiverQueue, jobData);
	}

	/**
	 * Process an inbound Slack message.
	 */
	async processInbound(job: SlackMessageJob): Promise<void> {
		const {
			installationId,
			channelId,
			threadTs,
			content,
			encryptedBotToken,
			slackUserId,
			organizationId,
			imageUrls,
		} = job;

		this.logger.info({ threadTs }, "Processing inbound message");

		// 1. Find existing session for this Slack thread
		const existingSession = await sessions.findSessionBySlackThread(
			installationId,
			channelId,
			threadTs,
		);

		let sessionId: string;

		if (existingSession) {
			sessionId = existingSession.id;
			this.logger.info({ sessionId }, "Found existing session");
		} else {
			// No session - create one via gateway SDK
			this.logger.info("No existing session, creating via gateway SDK");

			// Resolve configuration strategy from installation settings
			const configStrategy = await integrations.getSlackInstallationConfigStrategy(installationId);
			const configOption = configStrategy?.defaultConfigurationId
				? { configurationId: configStrategy.defaultConfigurationId }
				: { managedConfiguration: {} as { repoIds?: string[] } };

			try {
				const result = await this.syncClient.createSession({
					organizationId,
					...configOption,
					sessionType: "coding",
					clientType: "slack",
					clientMetadata: {
						installationId,
						channelId,
						threadTs,
					},
					initialPrompt: content,
				});

				sessionId = result.sessionId;
				this.logger.info(
					{
						sessionId,
						isNewConfiguration: result.isNewConfiguration,
						hasSnapshot: result.hasSnapshot,
					},
					"Created session",
				);

				// Post welcome message with buttons
				await postWelcomeMessage(
					encryptedBotToken,
					channelId,
					threadTs,
					sessionId,
					APP_URL,
					organizationId,
					this.logger,
				);

				// Post status message if this is a new configuration
				if (result.isNewConfiguration) {
					await postToSlack(
						encryptedBotToken,
						channelId,
						threadTs,
						"Setting up your workspace for the first time. This may take a moment...",
						this.logger,
					);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : "Unknown error";

				if (message.includes("No repos found")) {
					await postToSlack(
						encryptedBotToken,
						channelId,
						threadTs,
						`I can't start a session yet — no repos have been added. Connect a repo at ${APP_URL}/dashboard/integrations to get started.`,
						this.logger,
					);
				} else {
					this.logger.error({ err }, "Failed to create session");
					await postToSlack(
						encryptedBotToken,
						channelId,
						threadTs,
						"Sorry, I ran into an issue. Please try again or check the web app.",
						this.logger,
					);
				}
				return;
			}
		}

		// 2. Ensure receiver job exists (deduped by jobId)
		const receiverJob: SlackReceiverJob = {
			sessionId,
			installationId,
			channelId,
			threadTs,
			encryptedBotToken,
		};

		await ensureSlackReceiver(this.receiverQueue, receiverJob);

		// 3. Download images if any
		const images: string[] = [];
		if (imageUrls && imageUrls.length > 0) {
			this.logger.info({ count: imageUrls.length }, "Downloading images");
			for (const url of imageUrls) {
				const img = await downloadSlackImageAsBase64(url, encryptedBotToken, this.logger);
				if (img) {
					images.push(`data:${img.mediaType};base64,${img.data}`);
				}
			}
			this.logger.info({ downloaded: images.length }, "Downloaded images");
		}

		// 4. Cancel any in-progress operation, then post prompt to Gateway
		await this.syncClient.postCancel(sessionId, slackUserId);
		await this.syncClient.postMessage(sessionId, {
			content,
			userId: slackUserId,
			images: images.length > 0 ? images : undefined,
		});

		this.logger.info({ sessionId }, "Posted prompt to Gateway");
	}

	/**
	 * Handle a Gateway event.
	 */
	async handleEvent(
		sessionId: string,
		metadata: SlackClientMetadata,
		event: ServerMessage,
	): Promise<"continue" | "stop"> {
		if (!metadata.encryptedBotToken) {
			throw new Error("encryptedBotToken is required for handling events");
		}

		const slackApiClient = new SlackApiClient(
			metadata.encryptedBotToken,
			metadata.channelId,
			metadata.threadTs,
			this.logger.child({ component: "api" }),
		);

		const ctx: HandlerContext = {
			client: slackApiClient,
			slackClient: slackApiClient,
			syncClient: this.syncClient,
			sessionId,
			appUrl: APP_URL,
			logger: this.logger,
		};

		switch (event.type) {
			case "status":
				this.logger.debug({ status: event.payload.status }, "Status");
				return "continue";

			case "init":
				this.logger.debug("Received init");
				return "continue";

			case "message":
				// Web user messages are posted in wake() via Redis pub/sub
				// No action needed here - just continue listening
				return "continue";

			case "text_part_complete":
				await textPartCompleteHandler.handle(ctx, event);
				return "continue";

			case "tool_end":
				await this.handleToolEnd(ctx, event.payload.tool, String(event.payload.result) || "");
				return "continue";

			case "message_complete":
				this.logger.info("Message complete");
				return "stop";

			case "message_cancelled":
				this.logger.info("Message cancelled, continuing to listen");
				return "continue";

			case "error":
				this.logger.error({ message: event.payload.message }, "Gateway error");
				await slackApiClient.postMessage(`Error: ${event.payload.message}`);
				return "stop";

			default:
				return "continue";
		}
	}

	private async handleToolEnd(
		ctx: HandlerContext,
		toolName: string,
		result: string,
	): Promise<void> {
		if (!isSignificantTool(toolName)) {
			return;
		}

		const handler = findToolHandler(toolName);
		this.logger.info({ toolName, handler: handler.tools[0] || "default" }, "Tool handler matched");

		try {
			await handler.handle(ctx, toolName, result);
		} catch (err) {
			this.logger.error({ err, toolName }, "Tool handler error");
			await ctx.slackClient.postMessage(`Tool ${toolName} completed`);
		}
	}

	private async getEncryptedBotToken(installationId: string): Promise<string | null> {
		try {
			return await integrations.getSlackInstallationBotToken(installationId);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			this.logger.error({ installationId, message }, "Error fetching installation");
			return null;
		}
	}
}
