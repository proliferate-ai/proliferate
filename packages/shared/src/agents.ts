/**
 * Agent and Model Configuration
 *
 * Canonical model IDs and transforms for different providers.
 * All model selection should flow through this module.
 */

// ============================================
// Canonical Types
// ============================================

/**
 * LLM provider identifiers.
 */
export type ModelProvider = "anthropic" | "openai" | "google" | "deepseek" | "xai" | "mistral";

/**
 * Our canonical model IDs.
 * These are the IDs used throughout our codebase and stored in the database.
 */
export type ModelId =
	| "claude-opus-4.6"
	| "claude-sonnet-4"
	| "gpt-5.2"
	| "gemini-3-pro"
	| "gemini-3-flash"
	| "deepseek-v3"
	| "deepseek-r1"
	| "grok-4.1"
	| "grok-4.1-fast"
	| "codestral";

/**
 * Agent types we support.
 */
export type AgentType = "opencode";

/**
 * Reasoning effort levels — a 3-tier abstraction over provider-specific params.
 * - "quick": Minimal reasoning, fastest responses
 * - "normal": Default balanced reasoning
 * - "deep": Maximum reasoning depth
 */
export type ReasoningEffort = "quick" | "normal" | "deep";

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "normal";

/**
 * Configuration passed through the stack for agent/model selection.
 */
export interface AgentConfig {
	agentType: AgentType;
	modelId: ModelId;
	reasoningEffort?: ReasoningEffort;
}

// ============================================
// Model Registry
// ============================================

export interface ModelInfo {
	id: ModelId;
	name: string;
	description: string;
	provider: ModelProvider;
	default?: boolean;
	/** Whether this model supports configurable reasoning effort. */
	supportsReasoning?: boolean;
}

export interface AgentInfo {
	id: AgentType;
	name: string;
	description: string;
	models: ModelInfo[];
}

/**
 * Static registry of available agents and models.
 */
export const AGENTS: Record<AgentType, AgentInfo> = {
	opencode: {
		id: "opencode",
		name: "OpenCode",
		description: "Terminal-based coding agent",
		models: [
			// Anthropic
			{
				id: "claude-opus-4.6",
				name: "Claude Opus 4.6",
				description: "Most capable model for complex tasks",
				provider: "anthropic",
				default: true,
				supportsReasoning: true,
			},
			{
				id: "claude-sonnet-4",
				name: "Claude Sonnet 4",
				description: "Fast and efficient for most tasks",
				provider: "anthropic",
				supportsReasoning: true,
			},
			// OpenAI
			{
				id: "gpt-5.2",
				name: "GPT-5.2",
				description: "OpenAI flagship thinking model",
				provider: "openai",
				supportsReasoning: true,
			},
			// Google
			{
				id: "gemini-3-pro",
				name: "Gemini 3 Pro",
				description: "Google flagship with 1M context",
				provider: "google",
			},
			{
				id: "gemini-3-flash",
				name: "Gemini 3 Flash",
				description: "Fast Google model for quick tasks",
				provider: "google",
			},
			// DeepSeek
			{
				id: "deepseek-v3",
				name: "DeepSeek V3",
				description: "Strong open-weight coding model",
				provider: "deepseek",
			},
			{
				id: "deepseek-r1",
				name: "DeepSeek R1",
				description: "Reasoning model with chain-of-thought",
				provider: "deepseek",
				supportsReasoning: true,
			},
			// xAI
			{
				id: "grok-4.1",
				name: "Grok 4.1",
				description: "xAI flagship model",
				provider: "xai",
				supportsReasoning: true,
			},
			{
				id: "grok-4.1-fast",
				name: "Grok 4.1 Fast",
				description: "Fast xAI model for quick tasks",
				provider: "xai",
			},
			// Mistral
			{
				id: "codestral",
				name: "Codestral",
				description: "Mistral code-specialized model",
				provider: "mistral",
			},
		],
	},
};

// ============================================
// Defaults
// ============================================

export const DEFAULT_AGENT_TYPE: AgentType = "opencode";
export const DEFAULT_MODEL_ID: ModelId = "claude-opus-4.6";

export function getDefaultAgentConfig(): AgentConfig {
	return {
		agentType: DEFAULT_AGENT_TYPE,
		modelId: DEFAULT_MODEL_ID,
	};
}

export function getDefaultModelId(agentType: AgentType): ModelId {
	const agent = AGENTS[agentType];
	if (!agent) return DEFAULT_MODEL_ID;

	const defaultModel = agent.models.find((m) => m.default);
	return defaultModel?.id || agent.models[0].id;
}

// ============================================
// Lookups
// ============================================

export function getAgent(agentType: string): AgentInfo | undefined {
	if (!isValidAgentType(agentType)) return undefined;
	return AGENTS[agentType];
}

export function getModel(agentType: string, modelId: string): ModelInfo | undefined {
	const agent = getAgent(agentType);
	if (!agent) return undefined;
	return agent.models.find((m) => m.id === modelId);
}

export function formatAgentModel(agentType: string, modelId: string): string {
	const agent = getAgent(agentType);
	const model = getModel(agentType, modelId);

	if (!agent) return "Unknown Agent";
	if (!model) return agent.name;

	return `${agent.name}: ${model.name}`;
}

export function getAgentTypes(): AgentType[] {
	return Object.keys(AGENTS) as AgentType[];
}

export function getModelsForAgent(agentType: AgentType): ModelInfo[] {
	return AGENTS[agentType]?.models || [];
}

// ============================================
// Provider Transforms
// ============================================

/**
 * Transform canonical model ID to OpenCode config format.
 *
 * Anthropic models use the native "anthropic/" prefix.
 * Non-Anthropic models use "litellm/" prefix, routed through the LiteLLM
 * proxy as an OpenAI-compatible custom provider.
 */
export function toOpencodeModelId(modelId: ModelId): string {
	const transforms: Record<ModelId, string> = {
		"claude-opus-4.6": "anthropic/claude-opus-4-6",
		"claude-sonnet-4": "anthropic/claude-sonnet-4-5",
		"gpt-5.2": "litellm/gpt-5.2",
		"gemini-3-pro": "litellm/gemini-3-pro-preview",
		"gemini-3-flash": "litellm/gemini-3-flash-preview",
		"deepseek-v3": "litellm/deepseek-v3",
		"deepseek-r1": "litellm/deepseek-r1",
		"grok-4.1": "litellm/grok-4.1",
		"grok-4.1-fast": "litellm/grok-4.1-fast",
		codestral: "litellm/codestral",
	};
	return transforms[modelId] || transforms[DEFAULT_MODEL_ID];
}

/**
 * Transform canonical model ID to the actual API model ID.
 * Used for billing validation and spend tracking.
 */
export function toApiModelId(modelId: ModelId): string {
	const transforms: Record<ModelId, string> = {
		"claude-opus-4.6": "claude-opus-4-6",
		"claude-sonnet-4": "claude-sonnet-4-20250514",
		"gpt-5.2": "gpt-5.2",
		"gemini-3-pro": "gemini-3-pro-preview",
		"gemini-3-flash": "gemini-3-flash-preview",
		"deepseek-v3": "deepseek-chat",
		"deepseek-r1": "deepseek-reasoner",
		"grok-4.1": "grok-4.1",
		"grok-4.1-fast": "grok-4.1-fast",
		codestral: "codestral-latest",
	};
	return transforms[modelId] || transforms[DEFAULT_MODEL_ID];
}

/**
 * Get the provider for a canonical model ID.
 */
export function getModelProvider(modelId: ModelId): ModelProvider {
	const model = getModel(DEFAULT_AGENT_TYPE, modelId);
	return model?.provider ?? "anthropic";
}

/**
 * Parse a model ID from various formats back to canonical.
 * Useful for migrating old data or handling external inputs.
 */
export function parseModelId(input: string): ModelId {
	const normalized = input.toLowerCase();

	if (normalized.includes("opus") && normalized.includes("4.6")) {
		return "claude-opus-4.6";
	}
	if (normalized.includes("opus") && normalized.includes("4.5")) {
		// Legacy: fall back to Opus 4.6
		return "claude-opus-4.6";
	}
	if (normalized.includes("sonnet")) {
		return "claude-sonnet-4";
	}
	if (normalized.includes("gpt-5")) {
		return "gpt-5.2";
	}
	if (normalized.includes("gemini") && normalized.includes("pro")) {
		return "gemini-3-pro";
	}
	if (normalized.includes("gemini") && normalized.includes("flash")) {
		return "gemini-3-flash";
	}
	if (normalized.includes("deepseek") && normalized.includes("r1")) {
		return "deepseek-r1";
	}
	if (normalized.includes("deepseek")) {
		return "deepseek-v3";
	}
	if (normalized.includes("grok") && normalized.includes("fast")) {
		return "grok-4.1-fast";
	}
	if (normalized.includes("grok")) {
		return "grok-4.1";
	}
	if (
		normalized.includes("codestral") ||
		(normalized.includes("mistral") && normalized.includes("code"))
	) {
		return "codestral";
	}

	return DEFAULT_MODEL_ID;
}

/**
 * Validate if a string is a valid canonical model ID.
 */
export function isValidModelId(id: string): id is ModelId {
	return (
		id === "claude-opus-4.6" ||
		id === "claude-sonnet-4" ||
		id === "gpt-5.2" ||
		id === "gemini-3-pro" ||
		id === "gemini-3-flash" ||
		id === "deepseek-v3" ||
		id === "deepseek-r1" ||
		id === "grok-4.1" ||
		id === "grok-4.1-fast" ||
		id === "codestral"
	);
}

/**
 * Validate if a string is a valid agent type.
 */
export function isValidAgentType(type: string): type is AgentType {
	return type in AGENTS;
}

// ============================================
// Reasoning Effort
// ============================================

/**
 * Check if a model supports configurable reasoning effort.
 */
export function modelSupportsReasoning(modelId: ModelId): boolean {
	const model = getModel(DEFAULT_AGENT_TYPE, modelId);
	return model?.supportsReasoning ?? false;
}

// ============================================
// Backward Compatibility
// ============================================

/**
 * @deprecated Use `toApiModelId()` instead.
 */
export const toAnthropicApiModelId = toApiModelId;
