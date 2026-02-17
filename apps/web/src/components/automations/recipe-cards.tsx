"use client";

import { TemplateIconLinearPr, TemplateIconSentryFixer } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { Clock, Plus } from "lucide-react";
import type { ComponentType } from "react";

export interface Recipe {
	name: string;
	agentInstructions: string;
	icon: string;
	description: string;
}

const RECIPES: (Recipe & { Icon: ComponentType<{ className?: string }> })[] = [
	{
		name: "Sentry Auto-Fixer",
		description: "Auto-fix Sentry issues when they occur",
		icon: "bug",
		agentInstructions:
			"When a Sentry issue is received, analyze the error stacktrace and source code to identify the root cause. Then create a pull request with a fix and link it to the Sentry issue.",
		Icon: TemplateIconSentryFixer,
	},
	{
		name: "Linear PR Drafter",
		description: "Draft PRs when Linear issues move to In Progress",
		icon: "git-pull-request",
		agentInstructions:
			"When a Linear issue moves to In Progress, read the issue description and acceptance criteria. Then draft a pull request with an implementation plan and initial code changes.",
		Icon: TemplateIconLinearPr,
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

interface RecipeCardsProps {
	onSelect: (recipe: Recipe) => void;
	disabled?: boolean;
}

export function RecipeCards({ onSelect, disabled }: RecipeCardsProps) {
	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
			{RECIPES.map((recipe) => {
				const { Icon, ...recipeData } = recipe;
				return (
					<button
						key={recipe.name}
						type="button"
						disabled={disabled}
						onClick={() => onSelect(recipeData)}
						className={cn(
							"group flex flex-col items-start gap-3 p-5 rounded-lg border border-border bg-card text-left",
							"hover:border-primary/50 hover:bg-muted/30 transition-colors",
							"disabled:opacity-50 disabled:cursor-not-allowed",
						)}
					>
						<div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
							<Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
						</div>
						<div>
							<h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
								{recipe.name}
							</h3>
							<p className="text-sm text-muted-foreground mt-1">{recipe.description}</p>
						</div>
					</button>
				);
			})}
		</div>
	);
}
