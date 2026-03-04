"use client";

import { DashboardSessionsTableHeader } from "@/components/sessions/dashboard-sessions-table-header";
import { SessionsList } from "@/components/sessions/sessions-list";
import { DASHBOARD_ORIGIN_OPTIONS } from "@/config/sessions";
import { Suspense } from "react";

export default function SessionsPage() {
	return (
		<Suspense>
			<SessionsList
				automationOriginValue="automation"
				originOptions={DASHBOARD_ORIGIN_OPTIONS}
				newSessionPath="/sessions"
				showCreatorFilter
				enableSorting
				tableHeader={<DashboardSessionsTableHeader />}
			/>
		</Suspense>
	);
}
