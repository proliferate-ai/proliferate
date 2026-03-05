"use client";

import { useWsToken } from "@/hooks/sessions/use-ws-token";
import { GATEWAY_URL } from "@/lib/infra/gateway";
import { getGitDiff, getGitStatus, listGitRepos } from "@/lib/infra/gateway-devtools-client";
import { useQuery } from "@tanstack/react-query";

export function useGitRepos(sessionId: string) {
	const { token } = useWsToken();
	const canFetch = !!token && !!GATEWAY_URL;

	return useQuery({
		queryKey: ["git-repos", sessionId],
		queryFn: async () => listGitRepos(sessionId, token!),
		enabled: canFetch,
		staleTime: 60_000,
		retry: 2,
	});
}

export function useGitStatus(sessionId: string, repoId: string | null) {
	const { token } = useWsToken();
	const canFetch = !!token && !!GATEWAY_URL && !!repoId;

	return useQuery({
		queryKey: ["git-status", sessionId, repoId],
		queryFn: async () => getGitStatus(sessionId, token!, repoId!),
		enabled: canFetch,
		staleTime: 10_000,
		retry: 1,
	});
}

export function useGitDiff(sessionId: string, repoId: string | null, path: string | null) {
	const { token } = useWsToken();
	const canFetch = !!token && !!GATEWAY_URL && !!repoId && !!path;

	return useQuery({
		queryKey: ["git-diff", sessionId, repoId, path],
		queryFn: async () => getGitDiff(sessionId, token!, repoId!, path),
		enabled: canFetch,
		staleTime: 5_000,
		retry: 1,
	});
}
