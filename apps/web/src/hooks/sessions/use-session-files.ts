"use client";

import { useWsToken } from "@/hooks/sessions/use-ws-token";
import { GATEWAY_URL } from "@/lib/infra/gateway";
import {
	getFsTree,
	readFsFile,
	readFsFileBinary,
	writeFsFile,
} from "@/lib/infra/gateway-harness-client";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export function useSessionFilesTree(
	sessionId: string,
	path: string,
	depth: number,
	enabled = true,
) {
	const { token } = useWsToken();
	const canFetch = !!token && !!GATEWAY_URL && enabled;

	return useQuery({
		queryKey: ["fs-tree", sessionId, path, depth],
		queryFn: async () => getFsTree(sessionId, token!, path, depth),
		enabled: canFetch,
		staleTime: 15_000,
		retry: 2,
	});
}

export function useSessionFileContent(sessionId: string, path: string | null, enabled = true) {
	const { token } = useWsToken();
	const canFetch = !!token && !!GATEWAY_URL && !!path && enabled;

	return useQuery({
		queryKey: ["file-read", sessionId, path],
		queryFn: async () => readFsFile(sessionId, token!, path!),
		enabled: canFetch,
		staleTime: 5_000,
		retry: 1,
	});
}

export function useSessionFileBinaryContent(
	sessionId: string,
	path: string | null,
	enabled = true,
) {
	const { token } = useWsToken();
	const canFetch = !!token && !!GATEWAY_URL && !!path && enabled;

	return useQuery({
		queryKey: ["file-read-binary", sessionId, path],
		queryFn: async () => readFsFileBinary(sessionId, token!, path!),
		enabled: canFetch,
		staleTime: 5_000,
		retry: 1,
	});
}

export function useSessionWriteFile(sessionId: string) {
	const { token } = useWsToken();
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({ path, content }: { path: string; content: string }) => {
			if (!token || !GATEWAY_URL) {
				throw new Error("Session is not ready for file writes");
			}
			return writeFsFile(sessionId, token, path, content);
		},
		onSuccess: (_, variables) => {
			queryClient.invalidateQueries({ queryKey: ["file-read", sessionId, variables.path] });
			queryClient.invalidateQueries({ queryKey: ["fs-tree", sessionId] });
		},
	});
}

export function useSessionFilePrefetch(sessionId: string) {
	const { token } = useWsToken();
	const canFetch = !!token && !!GATEWAY_URL;

	const prefetchFileContent = useCallback(
		async (queryClient: QueryClient, path: string) => {
			if (!canFetch) return null;
			return queryClient.fetchQuery({
				queryKey: ["file-read", sessionId, path],
				queryFn: () => readFsFile(sessionId, token!, path),
				staleTime: 5_000,
			});
		},
		[canFetch, sessionId, token],
	);

	return { canFetch, prefetchFileContent };
}
