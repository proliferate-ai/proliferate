"use client";

import { useWsToken } from "@/hooks/sessions/use-ws-token";
import { GATEWAY_URL } from "@/lib/infra/gateway";
import { getFsTree, readFsFile } from "@/lib/infra/gateway-harness-client";
import { useQuery } from "@tanstack/react-query";

export function useSessionFilesTree(sessionId: string, path: string, depth: number) {
	const { token } = useWsToken();
	const canFetch = !!token && !!GATEWAY_URL;

	return useQuery({
		queryKey: ["fs-tree", sessionId, path, depth],
		queryFn: async () => getFsTree(sessionId, token!, path, depth),
		enabled: canFetch,
		staleTime: 15_000,
		retry: 2,
	});
}

export function useSessionFileContent(sessionId: string, path: string | null) {
	const { token } = useWsToken();
	const canFetch = !!token && !!GATEWAY_URL && !!path;

	return useQuery({
		queryKey: ["file-read", sessionId, path],
		queryFn: async () => readFsFile(sessionId, token!, path!),
		enabled: canFetch,
		staleTime: 5_000,
		retry: 1,
	});
}
