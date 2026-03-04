"use client";

import { SessionsList } from "@/components/sessions/sessions-list";
import { SessionsTableHeader } from "@/components/sessions/sessions-table-header";
import { SESSIONS_ORIGIN_OPTIONS } from "@/config/sessions";
import { Suspense } from "react";

export default function SessionsPage() {
	return (
		<Suspense>
			<SessionsList
				automationOriginValue="coworker"
				originOptions={SESSIONS_ORIGIN_OPTIONS}
				newSessionPath="/dashboard"
				tableHeader={<SessionsTableHeader />}
			/>
		</Suspense>
	);
}
