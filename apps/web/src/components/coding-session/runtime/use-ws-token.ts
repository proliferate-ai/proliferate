"use client";

import { useEffect, useState } from "react";

interface WsTokenState {
	token: string | null;
	isLoading: boolean;
	error: string | null;
}

/** Fetches a WebSocket auth token from the API */
export function useWsToken(): WsTokenState {
	const [token, setToken] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function fetchToken() {
			console.log("[WsToken] Fetching token...");
			try {
				const res = await fetch("/api/auth/ws-token", { credentials: "include" });
				if (!res.ok) {
					const text = await res.text();
					console.error("[WsToken] Failed to get token:", res.status, text);
					throw new Error("Failed to get WebSocket token");
				}
				const data = await res.json();
				if (!cancelled) {
					console.log("[WsToken] Token received, length:", data.token?.length);
					setToken(data.token);
				}
			} catch (err) {
				console.error("[WsToken] Error:", err);
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Unknown error");
				}
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		}

		fetchToken();

		return () => {
			cancelled = true;
		};
	}, []);

	return { token, isLoading, error };
}
