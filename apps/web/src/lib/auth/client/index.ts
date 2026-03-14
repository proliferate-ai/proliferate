"use client";

import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

function getBaseURL() {
	if (typeof window !== "undefined") {
		return `${window.location.origin}/api/auth`;
	}
	const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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
