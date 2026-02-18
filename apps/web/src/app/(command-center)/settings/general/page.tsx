"use client";

import { PageShell } from "@/components/dashboard/page-shell";
import { DangerZoneSection, WorkspaceSection } from "@/components/settings/general";
import { useOrgMembers } from "@/hooks/use-orgs";
import { useActiveOrganization, useSession } from "@/lib/auth-client";

export default function GeneralPage() {
	const { data: activeOrg, isPending: isActiveOrgPending } = useActiveOrganization();
	const { data: authSession } = useSession();
	const currentUserId = authSession?.user?.id;

	const { data: members } = useOrgMembers(activeOrg?.id ?? "");

	const currentUserRole = members?.find((m) => m.userId === currentUserId)?.role;
	const isOwner = currentUserRole === "owner";

	if (isActiveOrgPending || !activeOrg) {
		return (
			<PageShell title="General" subtitle="Workspace configuration" maxWidth="2xl">
				<div className="space-y-4">
					{[1, 2].map((i) => (
						<div key={i} className="h-24 rounded-lg bg-muted/30 animate-pulse" />
					))}
				</div>
			</PageShell>
		);
	}

	return (
		<PageShell title="General" subtitle="Workspace configuration" maxWidth="2xl">
			<div className="space-y-10">
				<WorkspaceSection activeOrg={activeOrg} isOwner={isOwner} />
				{isOwner && <DangerZoneSection organizationName={activeOrg.name} />}
			</div>
		</PageShell>
	);
}
