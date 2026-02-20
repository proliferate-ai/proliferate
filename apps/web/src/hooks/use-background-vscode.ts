"use client";

import { GATEWAY_URL } from "@/lib/gateway";
import { useEffect, useRef } from "react";

/**
 * Module-level set tracking sessions where a start request was already fired.
 * Shared between useBackgroundVscodeStart and VscodePanel to prevent duplicate
 * POST requests that cause EADDRINUSE on port 3901.
 */
export const vscodeStartedSessions = new Set<string>();

/**
 * Starts openvscode-server in the background as soon as the session connects.
 * This way the VS Code process is already running by the time the user clicks
 * the Code tab, eliminating the startup wait.
 *
 * Checks for an existing service first to avoid EADDRINUSE on page refresh.
 */
export function useBackgroundVscodeStart(sessionId: string | undefined, token: string | null) {
	const initiated = useRef(false);

	useEffect(() => {
		if (!sessionId || !token || !GATEWAY_URL || initiated.current) return;
		if (vscodeStartedSessions.has(sessionId)) return;
		initiated.current = true;
		vscodeStartedSessions.add(sessionId);

		const servicesUrl = `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/mcp/api/services`;

		(async () => {
			try {
				// Check if service already exists before trying to start.
				const checkRes = await fetch(servicesUrl);
				if (checkRes.ok) {
					const data = await checkRes.json();
					const existing = data.services?.find(
						(s: { name: string }) => s.name === "openvscode-server",
					);
					if (existing) {
						console.log("[vscode-bg] Service already exists:", existing.status);
						return;
					}
				}

				const basePath = `/proxy/${sessionId}/${token}/devtools/vscode`;
				console.log("[vscode-bg] Starting openvscode-server in background");
				const startRes = await fetch(servicesUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: "openvscode-server",
						command: `openvscode-server --port 3901 --without-connection-token --host 127.0.0.1 --server-base-path=${basePath} --default-folder /home/user/workspace`,
					}),
				});
				console.log("[vscode-bg] Start response:", startRes.status);
			} catch (err) {
				console.warn("[vscode-bg] Failed (VscodePanel will retry):", err);
			}
		})();
	}, [sessionId, token]);
}
