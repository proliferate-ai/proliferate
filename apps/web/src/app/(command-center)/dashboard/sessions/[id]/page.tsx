"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { use, useEffect } from "react";

/**
 * Legacy redirect: /dashboard/sessions/:id → /workspace/:id
 * Preserves orgId query param for cross-org session links.
 */
export default function LegacyDashboardSessionRedirect({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const router = useRouter();
	const searchParams = useSearchParams();
	const orgId = searchParams.get("orgId");

	useEffect(() => {
		const target = orgId ? `/workspace/${id}?orgId=${orgId}` : `/workspace/${id}`;
		router.replace(target);
	}, [id, orgId, router]);

	return null;
}
