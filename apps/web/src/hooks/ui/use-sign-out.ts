"use client";

import { signOut } from "@/lib/auth/client";
import { useDashboardStore } from "@/stores/dashboard";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export function useSignOut() {
	const router = useRouter();
	const queryClient = useQueryClient();

	const handleSignOut = useCallback(async () => {
		// Sign out from better-auth
		await signOut();

		// Clear all cached queries (removes previous user's data)
		queryClient.clear();

		// Reset Zustand stores
		useDashboardStore.getState().reset();

		// Navigate to sign-in
		router.push("/sign-in");
	}, [queryClient, router]);

	return handleSignOut;
}
