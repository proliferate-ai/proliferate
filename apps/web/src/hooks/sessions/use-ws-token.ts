"use client";

import { orpc } from "@/lib/infra/orpc";
import { useQuery } from "@tanstack/react-query";

const WS_TOKEN_QUERY_KEY = ["ws-token"] as const;
const STALE_TIME = 30 * 60 * 1000;
const GC_TIME = 60 * 60 * 1000;
const REFRESH_INTERVAL = 25 * 60 * 1000;

async function fetchWsToken(): Promise<string> {
	const { token } = await orpc.auth.wsToken.call({});
	return token;
}

interface WsTokenState {
	token: string | null;
	isLoading: boolean;
	error: string | null;
}

export function useWsToken(): WsTokenState {
	const {
		data: token,
		isLoading,
		error,
	} = useQuery({
		queryKey: WS_TOKEN_QUERY_KEY,
		queryFn: fetchWsToken,
		staleTime: STALE_TIME,
		gcTime: GC_TIME,
		refetchInterval: REFRESH_INTERVAL,
		refetchIntervalInBackground: true,
		refetchOnWindowFocus: false,
		retry: 2,
	});

	return {
		token: token ?? null,
		isLoading,
		error: error ? (error instanceof Error ? error.message : "Unknown error") : null,
	};
}
