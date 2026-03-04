"use client";

import { useLayoutGate } from "@/hooks/ui/use-layout-gate";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
	const { ready, session } = useLayoutGate({ requireBilling: true });

	if (!ready) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	return <div className="h-dvh flex flex-col">{children}</div>;
}
