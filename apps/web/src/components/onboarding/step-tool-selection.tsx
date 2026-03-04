"use client";

import { Button } from "@/components/ui/button";
import { ONBOARDING_TOOLS } from "@/config/onboarding";
import { cn } from "@/lib/display/utils";
import { useOnboardingStore } from "@/stores/onboarding";
import { Check } from "lucide-react";
import { OnboardingCardImage } from "./onboarding-card-image";

interface StepToolSelectionProps {
	onComplete: (selectedTools: string[]) => void;
	isSubmitting?: boolean;
}

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
		<div className="w-[520px]">
			<div className="rounded-2xl overflow-hidden border border-border">
				<OnboardingCardImage src="/tool2.png" alt="Select your tools" label="Integrations" />

				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-xl font-semibold text-foreground">Which tools do you use?</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							We&apos;ll help you connect them after setup.
						</p>
					</div>

					<div className="grid grid-cols-2 gap-1.5">
						{ONBOARDING_TOOLS.map((tool) => {
							const Icon = tool.icon;
							const isSelected = selected.has(tool.id);
							return (
								<button
									key={tool.id}
									type="button"
									onClick={() => toggle(tool.id)}
									className={cn(
										"flex items-center gap-2 w-full px-2.5 py-2 rounded-lg border transition-all text-left",
										isSelected
											? "border-primary bg-primary/5 ring-1 ring-primary/20"
											: "border-border hover:border-foreground/20 bg-card",
									)}
								>
									<div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted shrink-0">
										<Icon className="h-3.5 w-3.5" />
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium text-foreground leading-tight">{tool.name}</p>
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
						variant="contrast"
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
