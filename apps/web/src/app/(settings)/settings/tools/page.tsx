"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Redirect settings/tools to the unified integrations page
export default function ToolsRedirectPage() {
	const router = useRouter();

	useEffect(() => {
		router.replace("/dashboard/integrations");
	}, [router]);

	return (
		<div className="flex-1 flex items-center justify-center">
			<p className="text-muted-foreground">Redirecting to Integrations...</p>
		</div>
	);
}
