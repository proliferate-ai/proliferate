"use client";

import { useWsToken } from "@/hooks/sessions/use-ws-token";
import { checkPreviewHealth } from "@/lib/infra/gateway-devtools-client";
import { useCallback } from "react";

export function usePreviewHealthCheck(sessionId: string | undefined, url: string | null) {
	const { token } = useWsToken();

	return useCallback(async (): Promise<boolean> => {
		if (!url || !sessionId || !token) {
			return false;
		}

		try {
			const data = await checkPreviewHealth(sessionId, token, url);
			return data.ready === true;
		} catch {
			return false;
		}
	}, [sessionId, token, url]);
}
