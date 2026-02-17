"use client";

import { Button } from "@/components/ui/button";
import { GithubIcon, LinearIcon, PostHogIcon, SentryIcon, SlackIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useOnboardingStore } from "@/stores/onboarding";
import { Check } from "lucide-react";
import Image from "next/image";

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
	const selectedTools = useOnboardingStore((s) => s.selectedTools);
	const setSelectedTools = useOnboardingStore((s) => s.setSelectedTools);

	const selected = new Set(selectedTools);

	const toggle = (id: string) => {
		const next = new Set(selected);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		setSelectedTools(Array.from(next));
	};

	return (
		<div className="w-[480px]">
			<div className="rounded-2xl overflow-hidden border border-border">
				{/* Image Area */}
				<div className="relative bg-black" style={{ aspectRatio: "1360 / 880" }}>
					<Image src="/jam.png" alt="Select your tools" fill className="object-cover" />
					<div className="absolute top-3 left-0 right-0 flex justify-center pointer-events-none">
						<span className="px-4 py-1.5 font-bold text-xs tracking-[0.25em] uppercase text-white/80">
							Integrations
						</span>
					</div>
				</div>

				{/* Content */}
				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-xl font-semibold text-foreground">Which tools do you use?</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							We&apos;ll help you connect them after setup.
						</p>
					</div>

					<div className="space-y-1.5">
						{TOOLS.map((tool) => {
							const Icon = tool.icon;
							const isSelected = selected.has(tool.id);
							return (
								<button
									key={tool.id}
									type="button"
									onClick={() => toggle(tool.id)}
									className={cn(
										"flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg border transition-all text-left",
										isSelected
											? "border-primary bg-primary/5 ring-1 ring-primary/20"
											: "border-border hover:border-foreground/20 bg-card",
									)}
								>
									<div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted shrink-0">
										<Icon className="h-4 w-4" />
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium text-foreground leading-tight">{tool.name}</p>
										<p className="text-[11px] text-muted-foreground">{tool.description}</p>
									</div>
									<div
										className={cn(
											"flex h-5 w-5 items-center justify-center rounded-full border shrink-0 transition-all",
											isSelected
												? "border-primary bg-primary text-primary-foreground"
												: "border-border bg-background",
										)}
									>
										{isSelected && <Check className="h-3 w-3" />}
									</div>
								</button>
							);
						})}
					</div>

					<Button
						variant="dark"
						onClick={() => onComplete(Array.from(selected))}
						disabled={isSubmitting}
						className="h-11 w-full rounded-lg mt-5"
					>
						{isSubmitting ? "Saving..." : "Continue"}
					</Button>
				</div>
			</div>
		</div>
	);
}
