"use client";

import { orpc } from "@/lib/infra/orpc";
import { useDashboardStore } from "@/stores/dashboard";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

/**
 * Hook for handling follow-up session creation from workspace composer.
 * Used when the current session is in a terminal state (completed/failed).
 */
export function useCreateFollowUp() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const { setActiveSession } = useDashboardStore();

	return useMutation({
		...orpc.sessions.createFollowUp.mutationOptions(),
		onSuccess: (result) => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
			setActiveSession(result.sessionId);
			router.push(`/workspace/${result.sessionId}`);
		},
	});
}
