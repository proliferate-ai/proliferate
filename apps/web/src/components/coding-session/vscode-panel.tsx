"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { vscodeStartedSessions } from "@/hooks/use-background-vscode";
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
	return `${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/vscode/?folder=/home/user/workspace`;
}

type SetupStage = "requesting" | "starting_process" | "checking_health" | "ready" | "error";

const MAX_PROCESS_POLL_ATTEMPTS = 30;
const MAX_HEALTH_POLL_ATTEMPTS = 20;

export function VscodePanel({ sessionId }: VscodePanelProps) {
	const { token } = useWsToken();
	const togglePanel = usePreviewPanelStore((s) => s.togglePanel);
	const [stage, setStage] = useState<SetupStage>("requesting");
	const [errorCause, setErrorCause] = useState<string | null>(null);
	const pollingRef = useRef<(() => void) | null>(null);
	const startupInitiated = useRef(false);

	const clearPolling = useCallback(() => {
		if (!pollingRef.current) return;
		pollingRef.current();
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
			console.log("[vscode] Starting health check, url:", vscodeUrl(sessionId, tkn));
			setStage("checking_health");
			let attempts = 0;
			let cancelled = false;
			clearPolling();

			const poll = async () => {
				if (cancelled) return;
				attempts++;
				if (attempts > MAX_HEALTH_POLL_ATTEMPTS) {
					await failWithDiagnostics(
						"Process is running, but the HTTP endpoint failed to become ready.",
					);
					return;
				}

				try {
					const res = await fetch(vscodeUrl(sessionId, tkn), { method: "GET" });
					console.log("[vscode] Health check attempt", attempts, "status:", res.status);
					// 200: ready; 401/403/404: upstream responded (auth/path), so process is alive.
					if (res.ok || res.status === 401 || res.status === 403 || res.status === 404) {
						setStage("ready");
						return;
					}
				} catch (err) {
					console.log("[vscode] Health check attempt", attempts, "error:", err);
				}

				if (!cancelled) setTimeout(poll, 1000);
			};

			pollingRef.current = () => {
				cancelled = true;
			};
			setTimeout(poll, 1000);
		},
		[clearPolling, failWithDiagnostics, sessionId],
	);

	const startVscodeServer = useCallback(async () => {
		if (!token || !GATEWAY_URL) return;
		clearPolling();

		setStage("requesting");
		setErrorCause(null);

		console.log("[vscode] Starting VS Code setup", { sessionId, gateway: GATEWAY_URL });

		try {
			// Check if service already exists in any state.
			const servicesRes = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
			if (servicesRes.ok) {
				const data = await servicesRes.json();
				console.log("[vscode] Services response:", JSON.stringify(data.services, null, 2));
				const vscodeService = data.services?.find(
					(s: { name: string }) => s.name === "openvscode-server",
				);
				if (vscodeService) {
					console.log("[vscode] Found existing service:", vscodeService.status);
					if (vscodeService.status === "running") {
						checkHttpHealth(token);
						return;
					}
					if (vscodeService.status === "error") {
						await failWithDiagnostics("VS Code process crashed during startup.");
						return;
					}
					// Service exists but still starting — skip to polling.
					setStage("starting_process");
					let attempts = 0;
					let cancelled = false;

					const poll = async () => {
						if (cancelled) return;
						attempts++;
						if (attempts > MAX_PROCESS_POLL_ATTEMPTS) {
							await failWithDiagnostics(
								"Process start timed out. The sandbox may be resource constrained.",
							);
							return;
						}

						try {
							const res = await fetch(devtoolsUrl(sessionId, token, "/api/services"));
							if (res.ok) {
								const d = await res.json();
								const svc = d.services?.find(
									(s: { name: string }) => s.name === "openvscode-server",
								);
								if (!svc) {
									if (!cancelled) setTimeout(poll, 1000);
									return;
								}
								if (svc.status === "error") {
									await failWithDiagnostics("VS Code process crashed during startup.");
									return;
								}
								if (svc.status === "running") {
									checkHttpHealth(token);
									return;
								}
							}
						} catch {
							// Keep polling.
						}

						if (!cancelled) setTimeout(poll, 1000);
					};

					pollingRef.current = () => {
						cancelled = true;
					};
					setTimeout(poll, 1000);
					return;
				}
			}

			// Start openvscode-server via service manager (skip if background hook already fired).
			if (!vscodeStartedSessions.has(sessionId)) {
				vscodeStartedSessions.add(sessionId);
				const basePath = `/proxy/${sessionId}/${token}/devtools/vscode`;
				const command = `openvscode-server --port 3901 --without-connection-token --host 127.0.0.1 --server-base-path=${basePath} --default-folder /home/user/workspace`;
				console.log("[vscode] Starting service with command:", command);
				const startRes = await fetch(devtoolsUrl(sessionId, token, "/api/services"), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "openvscode-server", command }),
				});
				console.log("[vscode] Start response:", startRes.status);

				// 409 can occur if a service lock/race exists; treat as dispatch success.
				if (!startRes.ok && startRes.status !== 409) {
					throw new Error(`Failed to dispatch service start (HTTP ${startRes.status}).`);
				}
			} else {
				console.log("[vscode] Skipped POST — background hook already started service");
			}

			setStage("starting_process");

			// Poll for process presence/status.
			let attempts = 0;
			let cancelled = false;

			const poll = async () => {
				if (cancelled) return;
				attempts++;
				if (attempts > MAX_PROCESS_POLL_ATTEMPTS) {
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

						if (!svc) {
							if (!cancelled) setTimeout(poll, 1000);
							return;
						}
						if (svc.status === "error") {
							await failWithDiagnostics("VS Code process crashed during startup.");
							return;
						}
						if (svc.status === "running") {
							checkHttpHealth(token);
							return;
						}
					}
				} catch {
					// Keep polling.
				}

				if (!cancelled) setTimeout(poll, 1000);
			};

			pollingRef.current = () => {
				cancelled = true;
			};
			setTimeout(poll, 1000);
		} catch (err) {
			setStage("error");
			setErrorCause(err instanceof Error ? err.message : "Unknown startup error.");
		}
	}, [checkHttpHealth, clearPolling, failWithDiagnostics, sessionId, token]);

	useEffect(() => {
		if (startupInitiated.current) return;
		startupInitiated.current = true;
		startVscodeServer();

		return () => {
			clearPolling();
		};
	}, [clearPolling, startVscodeServer]);

	const iframeSrc = token && stage === "ready" ? vscodeUrl(sessionId, token) : "";
	if (iframeSrc) {
		console.log("[vscode] Iframe src:", iframeSrc);
	}
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
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									startupInitiated.current = false;
									vscodeStartedSessions.delete(sessionId);
									startVscodeServer();
								}}
							>
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
						allow="clipboard-read; clipboard-write"
						onLoad={(e) => {
							try {
								const iframe = e.target as HTMLIFrameElement;
								console.log(
									"[vscode] Iframe loaded, current URL:",
									iframe.contentWindow?.location.href,
								);
							} catch {
								console.log("[vscode] Iframe loaded (cross-origin, cannot read URL)");
							}
						}}
					/>
				)}
			</div>
		</PanelShell>
	);
}
