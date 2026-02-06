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
 * Our canonical model IDs.
 * These are the IDs used throughout our codebase and stored in the database.
 */
export type ModelId = "claude-opus-4.6" | "claude-opus-4.5" | "claude-sonnet-4";

/**
 * Agent types we support.
 */
export type AgentType = "opencode";

/**
 * Configuration passed through the stack for agent/model selection.
 */
export interface AgentConfig {
	agentType: AgentType;
	modelId: ModelId;
}

// ============================================
// Model Registry
// ============================================

export interface ModelInfo {
	id: ModelId;
	name: string;
	description: string;
	default?: boolean;
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
			{
				id: "claude-opus-4.6",
				name: "Opus 4.6",
				description: "Most capable model for complex tasks",
				default: true,
			},
			{
				id: "claude-opus-4.5",
				name: "Opus 4.5",
				description: "Previous generation Opus model",
				default: false,
			},
			{
				id: "claude-sonnet-4",
				name: "Sonnet 4",
				description: "Fast and efficient for most tasks",
				default: false,
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
 * OpenCode uses "anthropic/claude-sonnet-4-5" style IDs (NO date suffix!).
 * OpenCode internally maps these to actual Anthropic API model IDs.
 */
export function toOpencodeModelId(modelId: ModelId): string {
	const transforms: Record<ModelId, string> = {
		"claude-opus-4.6": "anthropic/claude-opus-4-6",
		"claude-opus-4.5": "anthropic/claude-opus-4-5",
		"claude-sonnet-4": "anthropic/claude-sonnet-4-5",
	};
	return transforms[modelId] || transforms[DEFAULT_MODEL_ID];
}

/**
 * Transform canonical model ID to Anthropic API format.
 * The API uses versioned model IDs like "claude-sonnet-4-20250514".
 * NOTE: claude-opus-4-5-20250514 does NOT exist - use sonnet-4 for now.
 */
export function toAnthropicApiModelId(modelId: ModelId): string {
	const transforms: Record<ModelId, string> = {
		"claude-opus-4.6": "claude-opus-4-6",
		"claude-opus-4.5": "claude-opus-4-5-20251101",
		"claude-sonnet-4": "claude-sonnet-4-20250514",
	};
	return transforms[modelId] || transforms[DEFAULT_MODEL_ID];
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
	if (normalized.includes("opus")) {
		return "claude-opus-4.5";
	}
	if (normalized.includes("sonnet")) {
		return "claude-sonnet-4";
	}

	return DEFAULT_MODEL_ID;
}

/**
 * Validate if a string is a valid canonical model ID.
 */
export function isValidModelId(id: string): id is ModelId {
	return id === "claude-opus-4.6" || id === "claude-opus-4.5" || id === "claude-sonnet-4";
}

/**
 * Validate if a string is a valid agent type.
 */
export function isValidAgentType(type: string): type is AgentType {
	return type in AGENTS;
}
