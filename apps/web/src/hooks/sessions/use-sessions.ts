"use client";

import { orpc } from "@/lib/infra/orpc";
import { useQuery } from "@tanstack/react-query";

export function useSessions(params?: {
	enabled?: boolean;
	refetchInterval?: number | false;
}) {
	const { enabled = true, refetchInterval } = params ?? {};
	return useQuery({
		...orpc.sessions.list.queryOptions({
			input: {},
		}),
		enabled,
		refetchInterval: refetchInterval ?? false,
		refetchIntervalInBackground: false,
		select: (data) => data.sessions,
	});
}

export function useSessionData(id: string) {
	return useQuery({
		...orpc.sessions.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
	});
}
