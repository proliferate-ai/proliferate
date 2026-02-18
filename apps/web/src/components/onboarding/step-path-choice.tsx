"use client";

import { CardButton } from "@/components/ui/card-button";
import type { FlowType } from "@/stores/onboarding";
import { ChevronRight } from "lucide-react";
import { OnboardingCardImage } from "./onboarding-card-image";

interface StepPathChoiceProps {
	onSelect: (flowType: FlowType) => void;
}

export function StepPathChoice({ onSelect }: StepPathChoiceProps) {
	return (
		<div className="w-full max-w-[720px]">
			<div className="mb-10 text-center">
				<h1 className="text-2xl sm:text-3xl font-bold text-foreground">
					How will you use Proliferate?
				</h1>
				<p className="mt-3 text-muted-foreground text-sm sm:text-base">
					AI agents that code in cloud environments. Connect your repos, configure the environment
					once, and let agents handle the rest.
				</p>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				{/* Developer Card */}
				<CardButton
					onClick={() => onSelect("developer")}
					className="group w-full rounded-2xl overflow-hidden border border-border hover:border-foreground/20 transition-all"
				>
					{/* Card Image Area */}
					<OnboardingCardImage
						src="/single.png"
						alt="Developer"
						label="Developer"
						labelContainerClassName="top-2"
					/>
					{/* Card Content */}
					<div className="flex flex-col gap-3 p-5 bg-card w-full">
						<p className="text-muted-foreground text-sm leading-relaxed">
							For solo developers working on personal projects and side builds.
						</p>
						<span className="font-medium flex items-center gap-1.5 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
							<span>Get started</span>
							<ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
						</span>
					</div>
				</CardButton>

				{/* Company Card */}
				<CardButton
					onClick={() => onSelect("organization")}
					className="group w-full rounded-2xl overflow-hidden border border-border hover:border-foreground/20 transition-all"
				>
					{/* Card Image Area */}
					<OnboardingCardImage
						src="/jam.png"
						alt="Company"
						label="Company"
						labelContainerClassName="top-2"
					/>
					{/* Card Content */}
					<div className="flex flex-col gap-3 p-5 bg-card w-full">
						<p className="text-muted-foreground text-sm leading-relaxed">
							For teams collaborating on shared repositories and projects.
						</p>
						<span className="font-medium flex items-center gap-1.5 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
							<span>Create organization</span>
							<ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
						</span>
					</div>
				</CardButton>
			</div>
		</div>
	);
}
