import type { ReasoningEffort } from "@proliferate/shared/agents";

export const EFFORT_OPTIONS: { id: ReasoningEffort; label: string; description: string }[] = [
	{ id: "quick", label: "Quick", description: "Minimal reasoning, fastest responses" },
	{ id: "normal", label: "Normal", description: "Balanced reasoning (default)" },
	{ id: "deep", label: "Deep", description: "Maximum reasoning depth" },
];
