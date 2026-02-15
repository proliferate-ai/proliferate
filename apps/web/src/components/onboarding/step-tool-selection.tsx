"use client";

import { Button } from "@/components/ui/button";
import { GithubIcon, LinearIcon, PostHogIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useState } from "react";

interface StepToolSelectionProps {
	onComplete: (selectedTools: string[]) => void;
	isSubmitting?: boolean;
}

const TOOLS = [
	{
		id: "github",
		name: "GitHub",
		description: "Source control and pull requests",
		icon: GithubIcon,
	},
	{
		id: "slack",
		name: "Slack",
		description: "Notifications and automations",
		icon: SlackIcon,
	},
	{
		id: "linear",
		name: "Linear",
		description: "Issue tracking and project management",
		icon: LinearIcon,
	},
	{
		id: "sentry",
		name: "Sentry",
		description: "Error monitoring and debugging",
		icon: SentryIcon,
	},
	{
		id: "posthog",
		name: "PostHog",
		description: "Product analytics and insights",
		icon: PostHogIcon,
	},
] as const;

export function StepToolSelection({ onComplete, isSubmitting }: StepToolSelectionProps) {
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const toggle = (id: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	return (
		<div className="w-full max-w-lg">
			<div className="text-center mb-8">
				<h1 className="text-2xl sm:text-3xl font-bold text-foreground">Which tools do you use?</h1>
				<p className="mt-3 text-muted-foreground text-sm sm:text-base">
					We&apos;ll help you connect them after setup.
				</p>
			</div>

			<div className="grid grid-cols-1 gap-3">
				{TOOLS.map((tool) => {
					const Icon = tool.icon;
					const isSelected = selected.has(tool.id);
					return (
						<button
							key={tool.id}
							type="button"
							onClick={() => toggle(tool.id)}
							className={cn(
								"flex items-center gap-4 rounded-xl border p-4 text-left transition-all",
								isSelected
									? "border-primary bg-primary/5 ring-1 ring-primary/20"
									: "border-border hover:border-foreground/20 bg-card",
							)}
						>
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
								<Icon className="h-5 w-5" />
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-sm font-medium text-foreground">{tool.name}</p>
								<p className="text-xs text-muted-foreground">{tool.description}</p>
							</div>
							<div
								className={cn(
									"flex h-5 w-5 items-center justify-center rounded-full border transition-all",
									isSelected
										? "border-primary bg-primary text-primary-foreground"
										: "border-border",
								)}
							>
								{isSelected && <Check className="h-3 w-3" />}
							</div>
						</button>
					);
				})}
			</div>

			<div className="mt-8 flex justify-center">
				<Button
					variant="dark"
					onClick={() => onComplete(Array.from(selected))}
					disabled={isSubmitting}
					className="h-11 w-full rounded-lg"
				>
					{isSubmitting ? "Saving..." : "Continue"}
				</Button>
			</div>
		</div>
	);
}
