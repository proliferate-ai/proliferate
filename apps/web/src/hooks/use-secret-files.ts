"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * List secret files for a configuration (metadata only, no content).
 */
export function useSecretFiles(configurationId: string) {
	return useQuery(orpc.secretFiles.list.queryOptions({ input: { configurationId } }));
}

/**
 * Upsert a secret file. Content is encrypted server-side.
 */
export function useUpsertSecretFile(configurationId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.secretFiles.upsert.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.secretFiles.list.queryOptions({ input: { configurationId } }).queryKey,
			});
		},
	});
}

/**
 * Delete a secret file.
 */
export function useDeleteSecretFile(configurationId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		...orpc.secretFiles.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.secretFiles.list.queryOptions({ input: { configurationId } }).queryKey,
			});
		},
	});
}
