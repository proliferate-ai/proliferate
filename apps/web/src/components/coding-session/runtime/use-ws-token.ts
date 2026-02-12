"use client";

import { orpc } from "@/lib/orpc";
import { useQuery } from "@tanstack/react-query";

const WS_TOKEN_QUERY_KEY = ["ws-token"] as const;
const STALE_TIME = 30 * 60 * 1000; // 30 minutes (token valid for 60 min)
const GC_TIME = 60 * 60 * 1000; // 1 hour — match token lifetime

async function fetchWsToken(): Promise<string> {
	const { token } = await orpc.auth.wsToken.call({});
	return token;
}

interface WsTokenState {
	token: string | null;
	isLoading: boolean;
	error: string | null;
}

/** Fetches a WebSocket auth token from the API, cached for 30 minutes */
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
		refetchOnWindowFocus: false,
		retry: 2,
	});

	return {
		token: token ?? null,
		isLoading,
		error: error ? (error instanceof Error ? error.message : "Unknown error") : null,
	};
}

export { WS_TOKEN_QUERY_KEY };
