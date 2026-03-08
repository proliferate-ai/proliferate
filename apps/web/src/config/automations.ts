import type { ModelProvider } from "@proliferate/shared/agents";
import {
	Bug,
	CircleDot,
	CircuitBoard,
	Clock,
	GitPullRequest,
	Plus,
	Shield,
	Zap,
} from "lucide-react";
import type { ComponentType } from "react";

export interface Recipe {
	name: string;
	agentInstructions: string;
	icon: string;
	description: string;
}

export const RECIPES: (Recipe & { Icon: ComponentType<{ className?: string }> })[] = [
	{
		name: "Sentry Auto-Fixer",
		description: "Auto-fix Sentry issues when they occur",
		icon: "bug",
		agentInstructions:
			"When a Sentry issue is received, analyze the error stacktrace and source code to identify the root cause. Then create a pull request with a fix and link it to the Sentry issue.",
		Icon: Bug,
	},
	{
		name: "Linear PR Drafter",
		description: "Draft PRs when Linear issues move to In Progress",
		icon: "git-pull-request",
		agentInstructions:
			"When a Linear issue moves to In Progress, read the issue description and acceptance criteria. Then draft a pull request with an implementation plan and initial code changes.",
		Icon: GitPullRequest,
	},
	{
		name: "Scheduled Code Review",
		description: "Run weekly code reviews on your repos",
		icon: "clock",
		agentInstructions:
			"Run a weekly code review on recent commits. Identify potential bugs, security issues, and areas for improvement. Summarize findings and suggest actionable fixes.",
		Icon: Clock,
	},
	{
		name: "Custom Automation",
		description: "Build from scratch",
		icon: "plus",
		agentInstructions: "",
		Icon: Plus,
	},
];

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	deepseek: "DeepSeek",
	xai: "xAI",
	mistral: "Mistral",
};

export type TemplateCategory = "bug-fixing" | "code-quality" | "project-management" | "devops";

export const TEMPLATE_CATEGORY_ORDER: TemplateCategory[] = [
	"bug-fixing",
	"code-quality",
	"project-management",
	"devops",
];

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
	"bug-fixing": "Bug Fixing",
	"code-quality": "Code Quality",
	"project-management": "Project Management",
	devops: "DevOps",
};

export const TEMPLATE_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
	bug: Bug,
	"git-pull-request": GitPullRequest,
	"circle-dot": CircleDot,
	"alert-triangle": Zap,
	// Fallbacks for future templates
	"circuit-board": CircuitBoard,
	shield: Shield,
};
