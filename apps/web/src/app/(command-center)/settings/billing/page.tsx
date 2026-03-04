"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { BuyCreditsSection } from "@/components/settings/billing/buy-credits-section";
import { CostDriversSection } from "@/components/settings/billing/cost-drivers-section";
import { CreditUsageSection } from "@/components/settings/billing/credit-usage-section";
import { EntitlementStatusSection } from "@/components/settings/billing/entitlement-status-section";
import { OverageSection } from "@/components/settings/billing/overage-section";
import { PlanSection } from "@/components/settings/billing/plan-section";
import { RecentEventsSection } from "@/components/settings/billing/recent-events-section";
import { UsageSummarySection } from "@/components/settings/billing/usage-summary-section";
import { useBillingPage } from "@/hooks/settings/use-billing-page";

export default function BillingPage() {
	const {
		billingEnabled,
		activeOrg,
		isOrgPending,
		isAdmin,
		billing,
		isBillingPending,
		error,
		handleUpdateBillingSettings,
	} = useBillingPage();

	if (!billingEnabled) {
		return null;
	}

	if (isOrgPending || isBillingPending) {
		return (
			<PageShell title="Billing" subtitle="Credits, plans, and usage" maxWidth="2xl">
				<div className="space-y-4">
					{[1, 2, 3].map((i) => (
						<div key={i} className="h-24 rounded-lg bg-muted/30 animate-pulse" />
					))}
				</div>
			</PageShell>
		);
	}

	if (error) {
		return (
			<PageShell title="Billing" subtitle="Credits, plans, and usage" maxWidth="2xl">
				<p className="text-sm text-muted-foreground text-center py-8">
					Failed to load billing information
				</p>
			</PageShell>
		);
	}

	if (!activeOrg || !billing) {
		return null;
	}

	return (
		<PageShell title="Billing" subtitle="Credits, plans, and usage" maxWidth="2xl">
			<div className="space-y-10">
				<CreditUsageSection credits={billing.credits} />
				<UsageSummarySection />
				<EntitlementStatusSection />
				{isAdmin && <BuyCreditsSection />}
				<CostDriversSection />
				<RecentEventsSection />
				<PlanSection
					plan={billing.plan}
					limits={billing.limits}
					hasActiveSubscription={billing.hasActiveSubscription}
					selectedPlan={billing.selectedPlan}
					billingState={billing.state.billingState}
					isAdmin={isAdmin}
				/>
				{isAdmin && (
					<OverageSection
						billingSettings={billing.billingSettings}
						overage={billing.overage}
						onUpdate={handleUpdateBillingSettings}
					/>
				)}
			</div>
		</PageShell>
	);
}
