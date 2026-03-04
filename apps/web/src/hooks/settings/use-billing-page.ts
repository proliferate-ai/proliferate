"use client";

import { useBilling, useUpdateBillingSettings } from "@/hooks/org/use-billing";
import { useCurrentUserRole } from "@/hooks/org/use-current-user-role";
import { useActiveOrganization } from "@/lib/auth/client";
import type { BillingInfo } from "@/types/billing";
import { env } from "@proliferate/environment/public";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function useBillingPage() {
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
	const router = useRouter();
	const { data: activeOrg, isPending: isOrgPending } = useActiveOrganization();
	const { isAdmin } = useCurrentUserRole();

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

	return {
		billingEnabled,
		activeOrg,
		isOrgPending,
		isAdmin,
		billing,
		isBillingPending,
		error,
		handleUpdateBillingSettings,
	};
}
