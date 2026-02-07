"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ConnectionsPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/dashboard/integrations");
	}, [router]);

	return null;
}
