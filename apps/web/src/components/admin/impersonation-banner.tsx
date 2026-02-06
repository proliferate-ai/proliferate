"use client";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAdmin } from "@/hooks/use-admin";
import { AlertTriangle, X } from "lucide-react";

export function ImpersonationBanner() {
	const { impersonating, stopImpersonating, isStoppingImpersonation } = useAdmin();

	if (!impersonating) {
		return null;
	}

	return (
		<div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between">
			<div className="flex items-center gap-2">
				<AlertTriangle className="h-4 w-4" />
				<Text variant="small" className="font-medium">
					Viewing as {impersonating.user.name || impersonating.user.email} in{" "}
					{impersonating.org.name}
				</Text>
			</div>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => stopImpersonating({})}
				disabled={isStoppingImpersonation}
				className="h-7 px-2 text-amber-950 hover:bg-amber-600 hover:text-amber-950"
			>
				<X className="h-4 w-4 mr-1" />
				Exit
			</Button>
		</div>
	);
}
