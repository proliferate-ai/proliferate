"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import {
	BuyCreditsSection,
	CreditUsageSection,
	OverageSection,
	PlanSection,
} from "@/components/settings/billing";
import { useBilling, useOrgMembers, useUpdateBillingSettings } from "@/hooks";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import type { BillingInfo } from "@/types/billing";
import { env } from "@proliferate/environment/public";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function BillingPage() {
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
	const router = useRouter();
	const { data: activeOrg, isPending: isOrgPending } = useActiveOrganization();
	const { data: authSession } = useSession();
	const currentUserId = authSession?.user?.id;

	const { data: members } = useOrgMembers(activeOrg?.id ?? "");

	const currentUserRole = members?.find((m) => m.userId === currentUserId)?.role;
	const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";

	const { data: billing, isPending: isBillingPending, error } = useBilling();

	const updateSettingsMutation = useUpdateBillingSettings();

	useEffect(() => {
		if (!billingEnabled) {
			router.replace("/settings/general");
		}
	}, [billingEnabled, router]);

	const handleUpdateBillingSettings = async (settings: Partial<BillingInfo["billingSettings"]>) => {
		await updateSettingsMutation.mutateAsync(settings);
	};

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
				{isAdmin && <BuyCreditsSection />}
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
						onUpdate={handleUpdateBillingSettings}
					/>
				)}
			</div>
		</PageShell>
	);
}
