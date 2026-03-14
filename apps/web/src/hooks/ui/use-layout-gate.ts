"use client";

import { useRequireAuth } from "@/hooks/ui/use-require-auth";
import { useActiveOrganization } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface LayoutGateOptions {
	requireOnboarding?: boolean;
}

export function useLayoutGate(options: LayoutGateOptions = {}) {
	const { requireOnboarding = false } = options;
	const router = useRouter();
	const { session, isPending: authPending } = useRequireAuth();

	const { data: activeOrg, isPending: orgPending } = useActiveOrganization();

	const needsOnboarding = requireOnboarding && !orgPending && !activeOrg;

	useEffect(() => {
		if (!authPending && session && !orgPending && needsOnboarding) {
			router.push("/onboarding");
		}
	}, [authPending, session, orgPending, needsOnboarding, router]);

	const gatesLoading = authPending || (requireOnboarding && orgPending);

	const ready = !gatesLoading && !!session && !needsOnboarding;

	return { ready, session, gatesLoading };
}
