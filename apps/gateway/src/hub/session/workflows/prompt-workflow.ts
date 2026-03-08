import { randomUUID } from "crypto";
import type { Message, SessionEventMessage } from "@proliferate/shared";
import { publishSessionEvent } from "../../../lib/redis";
import type { PromptOptions } from "../../shared/types";

export interface PromptWorkflowDeps {
	sessionId: string;
	isManagerSession: () => boolean;
	isCompletedAutomationSession: () => boolean;
	isRunActive: () => boolean;
	markRunStarted: (runId: string) => void;
	clearRunState: () => void;
	getMigrationState: () => "normal" | "migrating";
	touchActivity: () => void;
	getLastKnownAgentIdleAt: () => number | null;
	clearAgentIdle: () => void;
	projectActiveStatusFromIdle: () => void;
	log: (message: string, data?: Record<string, unknown>) => void;
	logError: (message: string, error?: unknown) => void;
	ensureRuntimeReady: () => Promise<void>;
	getOpenCodeSessionId: () => string | null;
	getOpenCodeUrl: () => string | null;
	broadcast: (message: { type: "message"; payload: Message }) => void;
	recordUserPromptTelemetry: () => void;
	setLastPromptSenderUserId: (userId: string) => void;
	getSessionClientType: () => string | null;
	resetEventProcessorForNewPrompt: () => void;
	sendPromptToRuntime: (content: string, images?: PromptOptions["images"]) => Promise<void>;
}

export async function runPromptWorkflow(
	deps: PromptWorkflowDeps,
	content: string,
	userId: string,
	options?: PromptOptions,
): Promise<void> {
	if (deps.isCompletedAutomationSession()) {
		throw new Error("Cannot send messages to a completed automation session.");
	}
	if (deps.isRunActive()) {
		throw new Error("A run is already active for this session.");
	}

	const migrationState = deps.getMigrationState();
	if (migrationState !== "normal") {
		deps.log("Dropping prompt during migration", { migrationState });
		return;
	}

	deps.touchActivity();
	const wasIdle = deps.getLastKnownAgentIdleAt() !== null;
	deps.clearAgentIdle();
	if (wasIdle) {
		deps.projectActiveStatusFromIdle();
	}

	deps.log("Handling prompt", {
		userId,
		contentLength: content.length,
		source: options?.source,
		imageCount: options?.images?.length,
	});
	deps.setLastPromptSenderUserId(userId);

	await deps.ensureRuntimeReady();
	if (!deps.isManagerSession()) {
		const openCodeSessionId = deps.getOpenCodeSessionId();
		const openCodeUrl = deps.getOpenCodeUrl();
		if (!openCodeSessionId || !openCodeUrl) {
			throw new Error("Agent session unavailable");
		}
	}

	const parts: Message["parts"] = [];
	if (options?.images && options.images.length > 0) {
		for (const img of options.images) {
			parts.push({ type: "image", image: `data:${img.mediaType};base64,${img.data}` });
		}
	}
	parts.push({ type: "text", text: content });

	const userMessage: Message = {
		id: randomUUID(),
		role: "user",
		content,
		isComplete: true,
		createdAt: Date.now(),
		senderId: userId,
		source: options?.source,
		parts,
	};
	deps.broadcast({ type: "message", payload: userMessage });
	deps.recordUserPromptTelemetry();
	deps.log("User message broadcast", { messageId: userMessage.id });

	if (deps.getSessionClientType()) {
		const event: SessionEventMessage = {
			type: "user_message",
			sessionId: deps.sessionId,
			source: options?.source || "web",
			timestamp: Date.now(),
			content,
			userId,
		};
		publishSessionEvent(event).catch((err) => {
			deps.logError("Failed to publish session event", err);
		});
	}

	deps.resetEventProcessorForNewPrompt();
	deps.log("Sending prompt to OpenCode...");
	const runId = randomUUID();
	deps.markRunStarted(runId);
	try {
		await deps.sendPromptToRuntime(content, options?.images);
		deps.log("Prompt sent to OpenCode", { runId });
	} catch (error) {
		deps.clearRunState();
		throw error;
	}
}
