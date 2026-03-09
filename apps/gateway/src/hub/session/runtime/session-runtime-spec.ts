export interface SessionRuntimeSpec {
	agentName: "pi" | "opencode";
	extensions: string[];
	memoryEnabled: boolean;
}

export function resolveRuntimeSpec(kind: string | null): SessionRuntimeSpec {
	if (kind === "manager") {
		return {
			agentName: "pi",
			extensions: ["manager-tools-extension", "memory-system-extension"],
			memoryEnabled: true,
		};
	}
	return { agentName: "opencode", extensions: [], memoryEnabled: false };
}
