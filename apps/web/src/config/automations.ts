import { Bug, CircleDot, CircuitBoard, GitPullRequest, Shield, Zap } from "lucide-react";

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
