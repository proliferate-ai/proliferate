"use client";

import { env } from "@proliferate/environment/public";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

function getBaseURL() {
	if (typeof window !== "undefined") {
		// Client-side: use window.location.origin for full URL
		return `${window.location.origin}/api/auth`;
	}
	// Server-side: use environment variable
	const isBuild = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD;
	const appUrl = env.NEXT_PUBLIC_APP_URL ?? (isBuild ? "http://localhost:3000" : "");
	return `${appUrl}/api/auth`;
}

export const authClient = createAuthClient({
	baseURL: getBaseURL(),
	plugins: [organizationClient()],
});

export const {
	signIn,
	signUp,
	signOut,
	useSession,
	organization,
	useActiveOrganization,
	useListOrganizations,
	sendVerificationEmail,
} = authClient;
