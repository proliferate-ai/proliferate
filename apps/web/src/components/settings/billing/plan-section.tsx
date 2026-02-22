"use client";

import { SettingsCard, SettingsSection } from "@/components/settings/settings-row";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActivatePlan } from "@/hooks/use-billing";
import { cn } from "@/lib/utils";
import type { BillingInfo } from "@/types/billing";
import { Check } from "lucide-react";
import { useState } from "react";

type PlanId = "dev" | "pro";

interface PlanOption {
	id: PlanId;
	name: string;
	price: string;
	creditsIncluded: number;
	maxConcurrentSessions: number;
	maxSnapshots: number;
	snapshotRetentionDays: number;
}

const PLANS: PlanOption[] = [
	{
		id: "dev",
		name: "Developer",
		price: "$20",
		creditsIncluded: 1000,
		maxConcurrentSessions: 10,
		maxSnapshots: 5,
		snapshotRetentionDays: 30,
	},
	{
		id: "pro",
		name: "Professional",
		price: "$500",
		creditsIncluded: 7500,
		maxConcurrentSessions: 100,
		maxSnapshots: 200,
		snapshotRetentionDays: 90,
	},
];

interface PlanSectionProps {
	plan: BillingInfo["plan"];
	limits: BillingInfo["limits"];
	hasActiveSubscription: BillingInfo["hasActiveSubscription"];
	selectedPlan: BillingInfo["selectedPlan"];
	billingState: BillingInfo["state"]["billingState"];
	isAdmin: boolean;
}

function formatCurrency(cents: number): string {
	return (cents / 100).toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
	});
}

export function PlanSection({
	plan,
	limits,
	hasActiveSubscription,
	selectedPlan,
	billingState,
	isAdmin,
}: PlanSectionProps) {
	const isTrial = billingState === "trial";
	const activatePlan = useActivatePlan();
	const [confirmPlan, setConfirmPlan] = useState<PlanId | null>(null);

	const currentPlanId: PlanId | null =
		selectedPlan === "dev" || selectedPlan === "pro" ? selectedPlan : null;
	const targetPlan = confirmPlan ? (PLANS.find((p) => p.id === confirmPlan) ?? null) : null;

	const handleConfirm = async () => {
		if (!confirmPlan) {
			console.info("[plan-section] Skipping plan confirmation: missing selected plan");
			return;
		}
		if (currentPlanId && confirmPlan === currentPlanId) {
			console.info("[plan-section] Skipping plan confirmation: plan unchanged", {
				plan: confirmPlan,
			});
			return;
		}
		console.info("[plan-section] Attempting plan activation", {
			plan: confirmPlan,
			isAdmin,
		});
		try {
			const result = await activatePlan.mutateAsync({ plan: confirmPlan });
			console.info("[plan-section] Plan activation mutation succeeded", {
				plan: confirmPlan,
				hasCheckoutUrl: Boolean(result.checkoutUrl),
			});
			if (result.checkoutUrl) {
				window.location.href = result.checkoutUrl;
				return;
			}
			window.location.reload();
		} catch (error) {
			console.error("[plan-section] Plan activation mutation failed", {
				plan: confirmPlan,
				isAdmin,
				error,
			});
		} finally {
			setConfirmPlan(null);
		}
	};

	const getActionLabel = (planId: PlanId): string => {
		if (!hasActiveSubscription) return "Activate";
		if (planId === "pro") return currentPlanId === "dev" ? "Upgrade to Pro" : "Switch to Pro";
		if (planId === "dev")
			return currentPlanId === "pro" ? "Downgrade to Developer" : "Switch to Developer";
		return `Switch to ${PLANS.find((p) => p.id === planId)?.name ?? planId}`;
	};

	return (
		<SettingsSection title="Plan">
			<SettingsCard>
				<div className="p-4">
					{/* Current plan header */}
					<div className="flex items-center justify-between pb-3 border-b border-border/60">
						<div>
							<div className="flex items-center gap-2">
								<p className="font-semibold">{plan.name}</p>
								{isTrial && (
									<Badge variant="secondary" className="text-xs">
										Trial
									</Badge>
								)}
							</div>
							<p className="text-sm text-muted-foreground">
								{formatCurrency(plan.monthlyPriceCents)}/month
							</p>
						</div>
					</div>

					{/* Plan picker cards */}
					<div className="mt-4 grid grid-cols-2 gap-3">
						{PLANS.map((p) => {
							const isCurrent =
								hasActiveSubscription && currentPlanId !== null && p.id === currentPlanId;
							const isSelected = !hasActiveSubscription && p.id === selectedPlan;
							const showAction = !isCurrent;

							return (
								<div
									key={p.id}
									className={cn(
										"rounded-lg border p-4 flex flex-col",
										isCurrent || isSelected ? "border-primary bg-primary/5" : "border-border",
									)}
								>
									<div className="flex items-center justify-between mb-2">
										<p className="font-medium text-sm">{p.name}</p>
										{isCurrent && (
											<Badge variant="secondary" className="text-[10px]">
												Current
											</Badge>
										)}
										{isSelected && (
											<Badge variant="secondary" className="text-[10px]">
												Selected
											</Badge>
										)}
									</div>
									<p className="text-2xl font-bold">
										{p.price}
										<span className="text-sm font-normal text-muted-foreground">/mo</span>
									</p>
									<ul className="mt-3 space-y-1.5 text-xs text-muted-foreground flex-1">
										<li className="flex items-center gap-1.5">
											<Check className="h-3 w-3 text-primary shrink-0" />
											{p.creditsIncluded.toLocaleString()} credits/mo
										</li>
										<li className="flex items-center gap-1.5">
											<Check className="h-3 w-3 text-primary shrink-0" />
											{p.maxConcurrentSessions} concurrent sessions
										</li>
										<li className="flex items-center gap-1.5">
											<Check className="h-3 w-3 text-primary shrink-0" />
											{p.maxSnapshots} snapshots
										</li>
									</ul>
									{showAction && (
										<Button
											size="sm"
											variant={p.id === "pro" ? "default" : "outline"}
											className="mt-3 w-full"
											onClick={() => setConfirmPlan(p.id)}
											disabled={activatePlan.isPending}
										>
											{getActionLabel(p.id)}
										</Button>
									)}
								</div>
							);
						})}
					</div>

					{/* Error display */}
					{activatePlan.error && (
						<div className="mt-3 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
							{activatePlan.error instanceof Error
								? activatePlan.error.message
								: "Failed to update plan. Please try again."}
						</div>
					)}

					{/* Plan limits */}
					<div className="mt-4 space-y-2">
						<p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
							Plan Limits
						</p>
						<div className="grid gap-2 text-sm">
							<div className="flex items-center justify-between py-1.5">
								<span className="text-muted-foreground">Credits per month</span>
								<span className="font-medium">{plan.creditsIncluded.toLocaleString()}</span>
							</div>
							<div className="flex items-center justify-between py-1.5">
								<span className="text-muted-foreground">Concurrent sessions</span>
								<span className="font-medium">{limits.maxConcurrentSessions}</span>
							</div>
							<div className="flex items-center justify-between py-1.5">
								<span className="text-muted-foreground">Snapshots</span>
								<span className="font-medium">{limits.maxSnapshots}</span>
							</div>
							<div className="flex items-center justify-between py-1.5">
								<span className="text-muted-foreground">Snapshot retention</span>
								<span className="font-medium">{limits.snapshotRetentionDays} days</span>
							</div>
						</div>
					</div>
				</div>
			</SettingsCard>

			<AlertDialog
				open={confirmPlan !== null && targetPlan !== null}
				onOpenChange={(open) => {
					if (!open) setConfirmPlan(null);
				}}
			>
				{targetPlan && (
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{!hasActiveSubscription
									? `Activate ${targetPlan.name}?`
									: confirmPlan === "pro" && currentPlanId === "dev"
										? `Upgrade to ${targetPlan.name}?`
										: confirmPlan === "dev" && currentPlanId === "pro"
											? `Downgrade to ${targetPlan.name}?`
											: `Switch to ${targetPlan.name}?`}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{hasActiveSubscription ? (
									<>
										Your plan will change to {targetPlan.name} at {targetPlan.price}/mo with{" "}
										{targetPlan.creditsIncluded.toLocaleString()} credits and{" "}
										{targetPlan.maxConcurrentSessions} concurrent sessions.
									</>
								) : (
									<>
										Activate your {targetPlan.name} plan at {targetPlan.price}
										/mo. Your card will be charged when trial credits are used.
									</>
								)}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={activatePlan.isPending}>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={(e) => {
									e.preventDefault();
									handleConfirm();
								}}
								disabled={activatePlan.isPending}
							>
								{activatePlan.isPending ? "Processing..." : "Confirm"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				)}
			</AlertDialog>
		</SettingsSection>
	);
}
