"use client";

import { publicConfig } from "@/lib/config/public";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: `${publicConfig.appUrl}/api/auth`,
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
