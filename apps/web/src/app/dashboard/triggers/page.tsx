"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Redirect old triggers page to automations
export default function TriggersPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/dashboard/automations");
	}, [router]);

	return (
		<div className="flex-1 flex items-center justify-center">
			<p className="text-muted-foreground">Redirecting to Automations...</p>
		</div>
	);
}
