"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/display/utils";

interface StepIndicatorProps {
	currentStep: number;
	totalSteps: number;
	onStepClick?: (step: number) => void;
}

export function StepIndicator({ currentStep, totalSteps, onStepClick }: StepIndicatorProps) {
	return (
		<div className="flex items-center justify-center gap-2">
			{Array.from({ length: totalSteps }).map((_, index) => {
				const stepNum = index + 1;
				const isCompleted = stepNum < currentStep;
				const isCurrent = stepNum === currentStep;
				const canClick = isCompleted && onStepClick;

				return (
					<Button
						variant="ghost"
						key={stepNum}
						onClick={() => canClick && onStepClick(stepNum)}
						disabled={!canClick}
						className={cn(
							"h-1.5 p-0 rounded-full transition-all",
							isCompleted || isCurrent ? "w-6 bg-foreground" : "w-1.5 bg-muted-foreground/30",
							canClick && "cursor-pointer hover:opacity-70",
							!canClick && "cursor-default",
						)}
					/>
				);
			})}
		</div>
	);
}
