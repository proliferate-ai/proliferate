"use client";

import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { Check, Zap } from "lucide-react";
import { useState } from "react";

interface StepPaymentProps {
	onComplete: () => void;
}

type PlanId = "dev" | "pro";

interface Plan {
	id: PlanId;
	name: string;
	price: string;
	priceNote?: string;
	description: string;
	features: string[];
	cta: string;
	popular?: boolean;
}

const PLANS: Plan[] = [
	{
		id: "dev",
		name: "Developer",
		price: "$20",
		priceNote: "/month",
		description: "For solo builders and small projects",
		features: ["1,000 free trial credits", "10 concurrent sessions", "5 snapshots"],
		cta: "Start free trial",
	},
	{
		id: "pro",
		name: "Professional",
		price: "$500",
		priceNote: "/month",
		description: "For teams shipping fast",
		features: [
			"1,000 free trial credits",
			"7,500 credits/month",
			"100 concurrent sessions",
			"200 snapshots",
		],
		cta: "Start free trial",
		popular: true,
	},
];

export function StepPayment({ onComplete }: StepPaymentProps) {
	const [selectedPlan, setSelectedPlan] = useState<PlanId>("dev");

	const startTrialMutation = useMutation({
		...orpc.onboarding.startTrial.mutationOptions(),
		onSuccess: (result) => {
			if (result.checkoutUrl) {
				// Redirect to Stripe checkout
				window.location.href = result.checkoutUrl;
			} else {
				// No checkout needed (billing not enabled or already configured)
				onComplete();
			}
		},
		onError: (err) => {
			console.error("Failed to select plan:", err);
		},
	});

	const handleSelectPlan = (planId: PlanId) => {
		setSelectedPlan(planId);
		startTrialMutation.mutate({ plan: planId });
	};

	return (
		<div className="w-full max-w-4xl">
			{/* Header */}
			<div className="text-center mb-8">
				<h1 className="text-3xl font-bold text-foreground mb-2">Start building with Proliferate</h1>
				<p className="text-muted-foreground">
					Choose the plan that works for you. Upgrade or downgrade anytime.
				</p>
			</div>

			{startTrialMutation.error && (
				<div className="mb-6 p-3 rounded-lg bg-destructive/10 text-destructive text-sm text-center">
					{startTrialMutation.error instanceof Error
						? startTrialMutation.error.message
						: "Failed to start. Please try again."}
				</div>
			)}

			{/* Plan cards */}
			<div className="grid md:grid-cols-2 gap-4">
				{PLANS.map((plan) => (
					<div
						key={plan.id}
						className={cn(
							"relative rounded-2xl border bg-card p-6 flex flex-col",
							plan.popular ? "border-primary shadow-lg shadow-primary/10" : "border-border",
						)}
					>
						{plan.popular && (
							<div className="absolute -top-3 left-1/2 -translate-x-1/2">
								<span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary text-primary-foreground text-xs font-medium">
									<Zap className="h-3 w-3" />
									Most popular
								</span>
							</div>
						)}

						<div className="mb-4">
							<h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
							<p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
						</div>

						<div className="mb-6">
							<span className="text-3xl font-bold text-foreground">{plan.price}</span>
							{plan.priceNote && (
								<span className="text-muted-foreground text-sm ml-1">{plan.priceNote}</span>
							)}
						</div>

						<ul className="space-y-3 mb-6 flex-1">
							{plan.features.map((feature) => (
								<li key={feature} className="flex items-start gap-2 text-sm">
									<Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
									<span className="text-muted-foreground">{feature}</span>
								</li>
							))}
						</ul>

						<Button
							variant={plan.popular ? "default" : "outline"}
							onClick={() => handleSelectPlan(plan.id)}
							disabled={startTrialMutation.isPending && selectedPlan === plan.id}
							className="w-full"
						>
							{startTrialMutation.isPending && selectedPlan === plan.id ? "Loading..." : plan.cta}
						</Button>
					</div>
				))}
			</div>

			{/* Footer note */}
			<p className="text-center text-xs text-muted-foreground mt-6">
				All plans include access to Claude, GPT-4, and other leading AI models.
				<br />
				Card required to start. You won't be charged until trial credits are used.
			</p>
		</div>
	);
}
