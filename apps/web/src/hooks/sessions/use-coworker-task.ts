"use client";

import { orpc } from "@/lib/infra/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export function useCreateCoworkerTask() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.sessions.createCoworkerTask.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
		},
	});
}
