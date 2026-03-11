"use client";

import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/infra/orpc";
import { useMutation } from "@tanstack/react-query";
import { Coins, LayoutGrid } from "lucide-react";
import { OnboardingCardImage } from "./onboarding-card-image";

interface StepBillingProps {
	onComplete: () => void;
}

export function StepBilling({ onComplete }: StepBillingProps) {
	const startMutation = useMutation({
		...orpc.onboarding.startTrial.mutationOptions(),
		onSuccess: () => {
			onComplete();
		},
		onError: (err) => {
			console.error("Failed to initialize free credits:", err);
		},
	});

	const handleStart = () => {
		startMutation.mutate({ plan: "dev" });
	};

	return (
		<div className="w-[480px]">
			<div className="rounded-2xl overflow-hidden border border-border">
				{/* Image Area */}
				<OnboardingCardImage src="/colloseum.png" alt="Get started for free" label="Free" />

				{/* Content */}
				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-xl font-semibold text-foreground">Get started for free</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							No credit card required. Start building instantly.
						</p>
					</div>

					<div className="space-y-3">
						<div className="flex items-start gap-3">
							<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
								<Coins className="h-4 w-4 text-primary" />
							</div>
							<div>
								<p className="text-sm font-medium text-foreground">5 free credits</p>
								<p className="text-xs text-muted-foreground">
									1 credit = $1 = ~1 hour of compute time
								</p>
							</div>
						</div>

						<div className="flex items-start gap-3">
							<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
								<LayoutGrid className="h-4 w-4 text-primary" />
							</div>
							<div>
								<p className="text-sm font-medium text-foreground">Full access to all features</p>
								<p className="text-xs text-muted-foreground">
									Sessions, automations, snapshots, and more
								</p>
							</div>
						</div>
					</div>

					{startMutation.error && (
						<div className="mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
							{startMutation.error instanceof Error
								? startMutation.error.message
								: "Something went wrong. Please try again."}
						</div>
					)}

					<Button
						variant="contrast"
						onClick={handleStart}
						disabled={startMutation.isPending}
						className="h-11 w-full rounded-lg mt-5"
					>
						{startMutation.isPending ? "Setting up..." : "Get Started"}
					</Button>
					<p className="text-center text-xs text-muted-foreground mt-3">
						No payment needed. You won&apos;t be charged anything.
					</p>
				</div>
			</div>
		</div>
	);
}
