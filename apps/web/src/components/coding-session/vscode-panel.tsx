"use client";

import { Button } from "@/components/ui/button";
import { GATEWAY_URL } from "@/lib/gateway";
import { Code, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelShell } from "./panel-shell";
import { useWsToken } from "./runtime/use-ws-token";

interface VscodePanelProps {
	sessionId: string;
}

function devtoolsUrl(sessionId: string, token: string, path: string): string {
	return `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/mcp${path}`;
}

function vscodeUrl(sessionId: string, token: string): string {
	return `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/vscode/`;
}

type PanelStatus = "starting" | "ready" | "error";

export function VscodePanel({ sessionId }: VscodePanelProps) {
	const { token } = useWsToken();
	const [status, setStatus] = useState<PanelStatus>("starting");
	const [attemptCount, setAttemptCount] = useState(0);
	const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const startVscodeServer = useCallback(async () => {
		if (!token || !GATEWAY_URL) return;

		if (pollingRef.current) {
			clearInterval(pollingRef.current);
			pollingRef.current = null;
		}

		setStatus("starting");
		setAttemptCount(0);

		try {
			// Check if openvscode-server is already running
			const servicesRes = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
			if (servicesRes.ok) {
				const data = await servicesRes.json();
				const vscodeService = data.services?.find(
					(s: { name: string; status: string }) =>
						s.name === "openvscode-server" && s.status === "running",
				);
				if (vscodeService) {
					setStatus("ready");
					return;
				}
			}

			// Start openvscode-server via service manager
			const basePath = `/proxy/${sessionId}/${token}/devtools/vscode`;
			const startRes = await fetch(devtoolsUrl(sessionId, token, "/api/services"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "openvscode-server",
					command: `openvscode-server --port 3901 --without-connection-token --host 127.0.0.1 --server-base-path=${basePath} --default-folder /home/user/workspace`,
				}),
			});

			if (!startRes.ok) {
				const err = await startRes.json().catch(() => ({ error: "Unknown error" }));
				throw new Error(err.error || `HTTP ${startRes.status}`);
			}

			// Poll until ready
			let attempts = 0;
			pollingRef.current = setInterval(async () => {
				attempts++;
				setAttemptCount(attempts);
				if (attempts > 30) {
					if (pollingRef.current) {
						clearInterval(pollingRef.current);
						pollingRef.current = null;
					}
					setStatus("error");
					return;
				}
				try {
					const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
					if (res.ok) {
						const data = await res.json();
						const svc = data.services?.find(
							(s: { name: string; status: string }) =>
								s.name === "openvscode-server" && s.status === "running",
						);
						if (svc) {
							if (pollingRef.current) {
								clearInterval(pollingRef.current);
								pollingRef.current = null;
							}
							setStatus("ready");
						}
					}
				} catch {
					// Keep polling
				}
			}, 1000);
		} catch {
			setStatus("error");
		}
	}, [sessionId, token]);

	useEffect(() => {
		startVscodeServer();

		return () => {
			if (pollingRef.current) {
				clearInterval(pollingRef.current);
				pollingRef.current = null;
			}
		};
	}, [startVscodeServer]);

	const handleRetry = () => {
		startVscodeServer();
	};

	const iframeSrc = token ? vscodeUrl(sessionId, token) : "";

	return (
		<PanelShell title="Code" icon={<Code className="h-4 w-4 text-muted-foreground" />} noPadding>
			<div className="h-full min-h-0">
				{status === "starting" && (
					<div className="flex flex-col items-center justify-center h-full gap-3">
						<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						<p className="text-sm text-muted-foreground">Starting VS Code...</p>
						{attemptCount > 0 && (
							<div className="w-32 h-1 bg-muted rounded-full overflow-hidden">
								<div
									className="h-full bg-primary transition-all duration-500"
									style={{ width: `${Math.min((attemptCount / 30) * 100, 100)}%` }}
								/>
							</div>
						)}
					</div>
				)}
				{status === "error" && (
					<div className="flex flex-col items-center justify-center h-full gap-3">
						<p className="text-sm text-destructive">Failed to start VS Code server</p>
						<Button variant="outline" size="sm" onClick={handleRetry}>
							Retry
						</Button>
					</div>
				)}
				{status === "ready" && iframeSrc && (
					<iframe
						src={iframeSrc}
						title="VS Code"
						className="w-full h-full border-0"
						sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
					/>
				)}
			</div>
		</PanelShell>
	);
}
