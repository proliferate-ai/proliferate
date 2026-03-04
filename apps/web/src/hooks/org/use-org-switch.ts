import { organization, useActiveOrganization } from "@/lib/auth/client";
import { useEffect, useMemo, useState } from "react";

interface UseOrgSwitchOptions {
	targetOrgId: string | null;
	buildRedirectUrl: (orgId: string) => string;
}

interface UseOrgSwitchResult {
	isSwitching: boolean;
	isOrgPending: boolean;
	shouldSwitchOrg: boolean;
	switchError: string | null;
}

export function useOrgSwitch({
	targetOrgId,
	buildRedirectUrl,
}: UseOrgSwitchOptions): UseOrgSwitchResult {
	const { data: activeOrg, isPending: isOrgPending } = useActiveOrganization();
	const [switchError, setSwitchError] = useState<string | null>(null);
	const [isSwitching, setIsSwitching] = useState(false);

	const shouldSwitchOrg = useMemo(
		() => Boolean(targetOrgId && activeOrg?.id && activeOrg.id !== targetOrgId),
		[targetOrgId, activeOrg?.id],
	);

	useEffect(() => {
		if (!targetOrgId || isOrgPending || isSwitching || !shouldSwitchOrg) return;
		setIsSwitching(true);
		organization
			.setActive({ organizationId: targetOrgId })
			.then(() => {
				window.location.replace(buildRedirectUrl(targetOrgId));
			})
			.catch(() => {
				setSwitchError("Unable to switch organization for this session.");
				setIsSwitching(false);
			});
	}, [targetOrgId, isOrgPending, isSwitching, shouldSwitchOrg, buildRedirectUrl]);

	return { isSwitching, isOrgPending, shouldSwitchOrg, switchError };
}
