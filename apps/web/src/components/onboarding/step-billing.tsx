"use client";

import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/orpc";
import { useMutation } from "@tanstack/react-query";
import { Coins, Gift, LayoutGrid } from "lucide-react";

interface StepBillingProps {
	onComplete: () => void;
}

export function StepBilling({ onComplete }: StepBillingProps) {
	const startTrialMutation = useMutation({
		...orpc.onboarding.startTrial.mutationOptions(),
		onSuccess: (result) => {
			if (result.checkoutUrl) {
				window.location.href = result.checkoutUrl;
			} else {
				onComplete();
			}
		},
		onError: (err) => {
			console.error("Failed to start trial:", err);
		},
	});

	const handleStartTrial = () => {
		startTrialMutation.mutate({ plan: "dev" });
	};

	return (
		<div className="w-full max-w-md">
			<div className="text-center mb-8">
				<div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 mb-4">
					<Gift className="h-7 w-7 text-primary" />
				</div>
				<h1 className="text-2xl sm:text-3xl font-bold text-foreground">Start your free trial</h1>
				<p className="mt-3 text-muted-foreground text-sm sm:text-base">
					No credit card required. Get started instantly.
				</p>
			</div>

			<div className="rounded-2xl border border-border bg-card p-6 space-y-4">
				<div className="flex items-start gap-3">
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
						<Coins className="h-4 w-4 text-primary" />
					</div>
					<div>
						<p className="text-sm font-medium text-foreground">1,000 free credits</p>
						<p className="text-xs text-muted-foreground">
							Enough to explore and build your first projects
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

			{startTrialMutation.error && (
				<div className="mt-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
					{startTrialMutation.error instanceof Error
						? startTrialMutation.error.message
						: "Something went wrong. Please try again."}
				</div>
			)}

			<div className="mt-6">
				<Button
					variant="dark"
					onClick={handleStartTrial}
					disabled={startTrialMutation.isPending}
					className="h-12 w-full rounded-lg text-base font-medium"
				>
					{startTrialMutation.isPending ? "Starting..." : "Start Free Trial"}
				</Button>
				<p className="text-center text-xs text-muted-foreground mt-3">
					No payment needed. You won&apos;t be charged anything.
				</p>
			</div>
		</div>
	);
}
