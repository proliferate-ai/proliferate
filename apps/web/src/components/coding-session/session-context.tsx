"use client";

import { createContext, useContext } from "react";

interface SessionContextValue {
	sessionId: string;
	repoId?: string;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessionContext() {
	const ctx = useContext(SessionContext);
	if (!ctx) {
		throw new Error("useSessionContext must be used within a SessionContext.Provider");
	}
	return ctx;
}
