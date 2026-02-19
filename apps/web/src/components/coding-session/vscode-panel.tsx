"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { GATEWAY_URL } from "@/lib/gateway";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { FileText, Loader2, ServerCrash } from "lucide-react";
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

type SetupStage = "requesting" | "starting_process" | "checking_health" | "ready" | "error";

const MAX_PROCESS_POLL_ATTEMPTS = 30;
const MAX_HEALTH_POLL_ATTEMPTS = 20;

export function VscodePanel({ sessionId }: VscodePanelProps) {
	const { token } = useWsToken();
	const togglePanel = usePreviewPanelStore((s) => s.togglePanel);
	const [stage, setStage] = useState<SetupStage>("requesting");
	const [errorCause, setErrorCause] = useState<string | null>(null);
	const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const clearPolling = useCallback(() => {
		if (!pollingRef.current) return;
		clearInterval(pollingRef.current);
		pollingRef.current = null;
	}, []);

	const fetchCrashLogs = useCallback(
		async (tkn: string): Promise<string> => {
			return new Promise<string>((resolve) => {
				let done = false;
				const finish = (value: string) => {
					if (done) return;
					done = true;
					resolve(value);
				};

				const es = new EventSource(devtoolsUrl(sessionId, tkn, "/api/logs/openvscode-server"));
				const timeout = setTimeout(() => {
					es.close();
					finish("Log retrieval timed out.");
				}, 3000);

				es.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data) as { type?: string; content?: string };
						if (data.type === "initial") {
							clearTimeout(timeout);
							es.close();
							const lines = (data.content || "").trim().split("\n").filter(Boolean);
							finish(lines.slice(-8).join("\n") || "Process exited without logs.");
						}
					} catch {
						// Ignore malformed messages.
					}
				};

				es.onerror = () => {
					clearTimeout(timeout);
					es.close();
					finish("Could not connect to service logs.");
				};
			});
		},
		[sessionId],
	);

	const failWithDiagnostics = useCallback(
		async (defaultMessage: string) => {
			setStage("error");
			if (!token) {
				setErrorCause(defaultMessage);
				return;
			}
			try {
				const tail = await fetchCrashLogs(token);
				setErrorCause(tail || defaultMessage);
			} catch {
				setErrorCause(defaultMessage);
			}
		},
		[fetchCrashLogs, token],
	);

	const checkHttpHealth = useCallback(
		(tkn: string) => {
			setStage("checking_health");
			let attempts = 0;
			clearPolling();

			pollingRef.current = setInterval(async () => {
				attempts++;
				if (attempts > MAX_HEALTH_POLL_ATTEMPTS) {
					clearPolling();
					await failWithDiagnostics(
						"Process is running, but the HTTP endpoint failed to become ready.",
					);
					return;
				}

				try {
					const res = await fetch(vscodeUrl(sessionId, tkn), { method: "HEAD" });
					// 200: ready; 401/403/404: upstream responded (auth/path), so process is alive.
					if (res.ok || res.status === 401 || res.status === 403 || res.status === 404) {
						clearPolling();
						setStage("ready");
					}
				} catch {
					// Keep polling.
				}
			}, 1000);
		},
		[clearPolling, failWithDiagnostics, sessionId],
	);

	const startVscodeServer = useCallback(async () => {
		if (!token || !GATEWAY_URL) return;
		clearPolling();

		setStage("requesting");
		setErrorCause(null);

		try {
			// Check if service already exists and is running.
			const servicesRes = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
			if (servicesRes.ok) {
				const data = await servicesRes.json();
				const vscodeService = data.services?.find(
					(s: { name: string; status: string }) =>
						s.name === "openvscode-server" && s.status === "running",
				);
				if (vscodeService) {
					checkHttpHealth(token);
					return;
				}
			}

			// Start openvscode-server via service manager.
			const basePath = `/proxy/${sessionId}/${token}/devtools/vscode`;
			const startRes = await fetch(devtoolsUrl(sessionId, token, "/api/services"), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "openvscode-server",
					command: `openvscode-server --port 3901 --without-connection-token --host 127.0.0.1 --server-base-path=${basePath} --default-folder /home/user/workspace`,
				}),
			});

			// 409 can occur if a service lock/race exists; treat as dispatch success.
			if (!startRes.ok && startRes.status !== 409) {
				throw new Error(`Failed to dispatch service start (HTTP ${startRes.status}).`);
			}

			setStage("starting_process");

			// Poll for process presence/status.
			let attempts = 0;
			pollingRef.current = setInterval(async () => {
				attempts++;
				if (attempts > MAX_PROCESS_POLL_ATTEMPTS) {
					clearPolling();
					await failWithDiagnostics(
						"Process start timed out. The sandbox may be resource constrained.",
					);
					return;
				}

				try {
					const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
					if (res.ok) {
						const data = await res.json();
						const svc = data.services?.find((s: { name: string; status: string }) => {
							return s.name === "openvscode-server";
						});

						if (!svc) return;
						if (svc.status === "error") {
							clearPolling();
							await failWithDiagnostics("VS Code process crashed during startup.");
							return;
						}
						if (svc.status === "running") {
							clearPolling();
							checkHttpHealth(token);
						}
					}
				} catch {
					// Keep polling.
				}
			}, 1000);
		} catch (err) {
			setStage("error");
			setErrorCause(err instanceof Error ? err.message : "Unknown startup error.");
		}
	}, [checkHttpHealth, clearPolling, failWithDiagnostics, sessionId, token]);

	useEffect(() => {
		startVscodeServer();

		return () => {
			clearPolling();
		};
	}, [clearPolling, startVscodeServer]);

	const iframeSrc = token && stage === "ready" ? vscodeUrl(sessionId, token) : "";
	const progressMap: Record<SetupStage, number> = {
		requesting: 10,
		starting_process: 45,
		checking_health: 80,
		ready: 100,
		error: 0,
	};

	return (
		<PanelShell title="Code Editor" noPadding>
			<div className="flex-1 min-h-0 h-full">
				{stage === "error" ? (
					<div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center">
						<div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
							<ServerCrash className="h-5 w-5 text-destructive" />
						</div>
						<div className="space-y-1 max-w-md">
							<p className="text-sm font-medium">Failed to start VS Code</p>
							{errorCause && (
								<div className="mt-2 text-left bg-muted/50 border p-3 rounded-md">
									<p className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap break-all">
										{errorCause}
									</p>
								</div>
							)}
						</div>
						<div className="flex items-center gap-2 mt-1">
							<Button variant="outline" size="sm" onClick={startVscodeServer}>
								Retry
							</Button>
							<Button variant="secondary" size="sm" onClick={() => togglePanel("services")}>
								<FileText className="h-3.5 w-3.5 mr-1.5" />
								Open Services
							</Button>
						</div>
					</div>
				) : stage !== "ready" ? (
					<div className="flex flex-col items-center justify-center h-full gap-5 px-8">
						<div className="flex items-center gap-3">
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
							<p className="text-sm font-medium">Starting editor workspace...</p>
						</div>
						<div className="w-full max-w-xs space-y-2">
							<Progress value={progressMap[stage]} className="w-full h-1.5" />
							<div className="flex justify-between text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">
								<span className={stage === "requesting" ? "text-foreground" : undefined}>
									Request
								</span>
								<span className={stage === "starting_process" ? "text-foreground" : undefined}>
									Process
								</span>
								<span className={stage === "checking_health" ? "text-foreground" : undefined}>
									Network
								</span>
							</div>
						</div>
					</div>
				) : (
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
