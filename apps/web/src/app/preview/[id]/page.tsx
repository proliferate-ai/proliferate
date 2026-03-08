"use client";

import { PreviewSession } from "@/components/preview-session/preview-session";
import { useOrgSwitch } from "@/hooks/org/use-org-switch";
import { buildPreviewRedirectUrl } from "@/lib/display/urls";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export default function PreviewSessionPage() {
	const { id } = useParams();
	const searchParams = useSearchParams();
	const targetOrgId = searchParams.get("orgId");

	const buildRedirectUrl = useCallback(
		(orgId: string) => buildPreviewRedirectUrl(id as string, orgId),
		[id],
	);

	const { isSwitching, isOrgPending, shouldSwitchOrg, switchError } = useOrgSwitch({
		targetOrgId,
		buildRedirectUrl,
	});

	if (targetOrgId && (isOrgPending || shouldSwitchOrg || isSwitching)) {
		return (
			<div className="h-screen flex items-center justify-center text-sm text-muted-foreground">
				Switching organization...
			</div>
		);
	}

	if (switchError) {
		return (
			<div className="h-screen flex items-center justify-center text-sm text-destructive">
				{switchError}
			</div>
		);
	}

	return (
		<div className="h-screen">
			<div className="border-b px-4 py-2 text-sm text-muted-foreground">
				<Link href="/" className="hover:text-foreground">
					&larr; Back to Dashboard
				</Link>
			</div>
			<PreviewSession sessionId={id as string} />
		</div>
	);
}
