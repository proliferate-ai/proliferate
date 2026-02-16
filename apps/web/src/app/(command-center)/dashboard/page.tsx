"use client";

export const dynamic = "force-dynamic";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * /dashboard always redirects to /dashboard/inbox.
 * Per spec: "Always redirects to /dashboard/inbox."
 */
export default function DashboardPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/dashboard/inbox");
	}, [router]);

	return null;
}
