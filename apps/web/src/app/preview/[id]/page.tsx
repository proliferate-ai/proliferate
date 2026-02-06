"use client";

export const dynamic = "force-dynamic";

import { PreviewSession } from "@/components/preview-session";
import { organization, useActiveOrganization } from "@/lib/auth-client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export default function PreviewSessionPage() {
	const { id } = useParams();
	const searchParams = useSearchParams();
	const targetOrgId = searchParams.get("orgId");
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
				window.location.replace(`/preview/${id}?orgId=${targetOrgId}`);
			})
			.catch((err) => {
				console.error("Failed to switch organization:", err);
				setSwitchError("Unable to switch organization for this session preview.");
				setIsSwitching(false);
			});
	}, [targetOrgId, isOrgPending, isSwitching, shouldSwitchOrg, id]);

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
