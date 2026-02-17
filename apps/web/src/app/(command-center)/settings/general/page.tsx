"use client";

import { DangerZoneSection, WorkspaceSection } from "@/components/settings/general";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useOrgMembers } from "@/hooks/use-orgs";
import { useActiveOrganization, useSession } from "@/lib/auth-client";

export default function GeneralPage() {
	const { data: activeOrg, isPending: isActiveOrgPending } = useActiveOrganization();
	const { data: authSession } = useSession();
	const currentUserId = authSession?.user?.id;

	const { data: members } = useOrgMembers(activeOrg?.id ?? "");

	const currentUserRole = members?.find((m) => m.userId === currentUserId)?.role;
	const isOwner = currentUserRole === "owner";

	if (isActiveOrgPending) {
		return (
			<div className="py-8 text-center">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	if (!activeOrg) {
		return null;
	}

	return (
		<div className="space-y-10">
			<WorkspaceSection activeOrg={activeOrg} isOwner={isOwner} />
			{isOwner && <DangerZoneSection organizationName={activeOrg.name} />}
		</div>
	);
}
