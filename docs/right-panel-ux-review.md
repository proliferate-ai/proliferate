# Right Panel UX Review: Preview & VS Code Panels

**Date:** 2026-02-19
**Branch:** `codex/right-panel-ux-vscode-fixes`
**Purpose:** Gather context for technical advisor review of right-panel UX issues (preview iframe readiness detection, VS Code startup failures, code quality).

---

## 1. Observed Problems

### Problem A: Preview panel stuck on "Connecting to preview..." forever

When the preview panel has a URL but the sandbox dev server isn't ready (or returns 502/503), the panel shows a spinner with "Connecting to preview..." for a very long time. The CORS-only health check always fails because Modal's reverse proxy returns 502 **without CORS headers**, so `fetch(url, { mode: "cors" })` throws a TypeError on every attempt. After 8 retries with exponential backoff (1s, 2s, 4s, 8s, 10s, 10s, 10s, 10s = ~55s total), it finally shows "Preview Not Ready" with a retry button.

**Console errors (repeated 8 times):**
```
Access to fetch at 'https://ta-...modal.host/' from origin 'https://...ngrok-free.dev'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present.

GET https://ta-...modal.host/ net::ERR_FAILED 502 (Bad Gateway)
Uncaught (in promise) TypeError: Failed to fetch
```

**Root cause:** The preview URL points to Modal's reverse proxy (`*.modal.host`), which returns 502/503 when the sandbox app server hasn't started yet. These responses lack CORS headers, so the browser blocks them. The client-side health check cannot distinguish "server not ready (502)" from "server ready but no CORS headers (200)" — both throw the same TypeError.

**Previous state:** The code had a `no-cors` fallback that would detect the server as reachable even on 502 (because `no-cors` resolves opaque responses for any response status), which caused the opposite problem — showing a blank white iframe for a 502 page.

### Problem B: VS Code panel — EADDRINUSE / never starts

VS Code panel shows "Failed to start VS Code" with error:
```
EADDRINUSE: listen EADDRINUSE: address already in use 127.0.0.1:3901
```

This happens when:
1. User opens VS Code panel → starts openvscode-server on port 3901
2. User navigates away or panel unmounts (React strict mode double-invoke, tab switch)
3. User returns → tries to start again → port already bound

Additionally, the health check uses `HEAD` requests which return `405 Method Not Allowed` from the ngrok proxy worker (`workers.ngrok.dev`). The proxy likely doesn't support HEAD.

### Problem C: Noisy uncaught promise rejections

The `checkUrl` fetch in preview-panel throws unhandled promise rejections that pollute the console. While caught in the application logic, the browser's fetch wrapper (`frame_ant.js` — likely a browser extension intercepting fetch) re-throws before the catch handler runs.

---

## 2. Architecture Overview

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│   Browser        │────▶│   Gateway          │────▶│   Sandbox        │
│   (Next.js app)  │     │   (Express)        │     │   (Modal/E2B)    │
│                  │     │                    │     │                  │
│  PreviewPanel    │     │  /proxy/:sid/:tok  │     │  Caddy reverse   │
│    └─ iframe ────┼─────┼─── /devtools/vscod │─────┼── /_proliferate/ │
│    └─ fetch()  ──┼──X──┤     (path rewrite) │     │     vscode/*     │
│                  │     │                    │     │                  │
│  VscodePanel     │     │  Proxy middlewares:│     │  openvscode-     │
│    └─ HEAD ────  │─────┼── requireProxyAuth │     │  server :3901    │
│    └─ POST ───── │─────┼── ensureSessionRdy │     │                  │
│                  │     │── http-proxy-mw    │     │  sandbox-mcp     │
└─────────────────┘     └───────────────────┘     │  (service mgr)   │
                                                   └──────────────────┘

Key insight: iframe navigation is NOT subject to CORS.
fetch() IS subject to CORS. This mismatch is the core problem.
```

**Preview URL flow:**
1. Sandbox boots → provider returns `previewUrl` (Modal tunnel URL)
2. Gateway broadcasts `{ type: "preview_url", payload: { url } }` via WebSocket
3. Frontend receives it → stores in component state → passes to `<RightPanel previewUrl={...} />`
4. `<PreviewPanel url={previewUrl} />` polls the URL before showing the iframe

**VS Code URL construction:**
```
${GATEWAY_URL}/proxy/${sessionId}/${token}/devtools/vscode/
```
Where `GATEWAY_URL` resolves to `workers.ngrok.dev` in local dev (via ngrok tunnel).

---

## 3. Full Source Files

### preview-panel.tsx (current state, 281 lines)

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { ExternalLink, Maximize2, Minimize2, RefreshCw } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PanelShell } from "./panel-shell";

interface PreviewPanelProps {
	url: string | null;
	className?: string;
}

function PreviewOfflineIllustration() {
	return (
		<div className="relative mx-auto h-[66px] w-[66px]">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 66 66"
				fill="none"
				className="h-[66px] w-[66px]"
			>
				<rect
					x="8"
					y="10"
					width="50"
					height="36"
					rx="6"
					className="fill-muted/40 dark:fill-muted/50 stroke-muted-foreground/35 dark:stroke-muted-foreground/45"
					strokeWidth="1.5"
				/>
				<rect
					x="14"
					y="16"
					width="38"
					height="24"
					rx="3"
					className="fill-background/70 dark:fill-background/55 stroke-muted-foreground/25 dark:stroke-muted-foreground/35"
					strokeWidth="1.2"
				/>
				<circle
					cx="33"
					cy="28"
					r="6"
					className="fill-muted/45 dark:fill-muted/55 stroke-muted-foreground/35 dark:stroke-muted-foreground/45"
					strokeWidth="1.2"
				/>
				<path
					d="M33 25V28.5L36 30.5"
					className="stroke-muted-foreground/50 dark:stroke-muted-foreground/60"
					strokeWidth="1.3"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<path
					d="M26 53H40"
					className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
				<path
					d="M33 46V53"
					className="stroke-muted-foreground/40 dark:stroke-muted-foreground/50"
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			</svg>

			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 66 66"
				fill="none"
				className="absolute inset-0 h-[66px] w-[66px] animate-spin text-muted-foreground/35 dark:text-muted-foreground/45"
				style={{ animationDuration: "6s" }}
			>
				<circle
					cx="33"
					cy="33"
					r="30"
					stroke="currentColor"
					strokeWidth="1.4"
					strokeDasharray="4 5"
				/>
			</svg>

			<span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/60 dark:bg-muted-foreground/70 animate-pulse" />
		</div>
	);
}

export function PreviewPanel({ url, className }: PreviewPanelProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	// "checking" = polling the URL, "ready" = server is up, "unavailable" = not serving
	const [status, setStatus] = useState<"checking" | "ready" | "unavailable">("checking");
	const [refreshKey, setRefreshKey] = useState(0);

	const checkUrl = useCallback(async (targetUrl: string): Promise<boolean> => {
		try {
			const res = await fetch(targetUrl, { mode: "cors" });
			return res.ok;
		} catch {
			// CORS or network error. We can't distinguish a CORS-blocked 200
			// from a CORS-blocked 502 via fetch alone, so return false and
			// keep polling.  Once polling exhausts retries the panel shows the
			// iframe anyway (see "unavailable" state) so the user isn't stuck.
			return false;
		}
	}, []);

	// Poll the URL to check if the server is actually serving.
	// refreshKey is intentionally in deps to allow re-triggering via Retry button.
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-triggers polling
	useEffect(() => {
		if (!url) return;

		let cancelled = false;
		let attempts = 0;
		const maxAttempts = 8;
		setStatus("checking");

		const poll = async () => {
			const ok = await checkUrl(url);
			if (cancelled) return;

			if (ok) {
				setStatus("ready");
				return;
			}

			attempts++;
			if (attempts >= maxAttempts) {
				setStatus("unavailable");
				return;
			}

			// Exponential backoff: 1s, 2s, 4s, 8s, 10s (capped)
			const delay = Math.min(1000 * 2 ** (attempts - 1), 10000);
			setTimeout(() => {
				if (!cancelled) poll();
			}, delay);
		};

		poll();
		return () => {
			cancelled = true;
		};
	}, [url, checkUrl, refreshKey]);

	// Esc key exits fullscreen
	useEffect(() => {
		if (!isFullscreen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") setIsFullscreen(false);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isFullscreen]);

	const handleRefresh = useCallback(() => {
		setRefreshKey((k) => k + 1);
	}, []);

	const handleCopyUrl = useCallback(() => {
		if (!url) return;
		navigator.clipboard.writeText(url).then(() => {
			toast.success("URL copied");
		});
	}, [url]);

	if (!url) {
		return (
			<PanelShell title="Preview" noPadding>
				<div className={cn("flex items-center justify-center h-full", className)}>
					<div className="text-center space-y-3 px-4">
						<PreviewOfflineIllustration />
						<div>
							<p className="text-sm font-medium">No Preview Available</p>
							<p className="text-xs text-muted-foreground mt-1">
								Start a dev server to see your app here
							</p>
						</div>
					</div>
				</div>
			</PanelShell>
		);
	}

	const toolbar = (
		<>
			<Button
				variant="ghost"
				size="icon"
				className="h-7 w-7"
				onClick={handleRefresh}
				title="Refresh"
			>
				<RefreshCw className={cn("h-4 w-4", status === "checking" && "animate-spin")} />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				className="h-7 w-7"
				onClick={() => setIsFullscreen(!isFullscreen)}
				title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
			>
				{isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
			</Button>
			<Button variant="ghost" size="icon" className="h-7 w-7" asChild title="Open in new tab">
				<a href={url} target="_blank" rel="noopener noreferrer">
					<ExternalLink className="h-4 w-4" />
				</a>
			</Button>
		</>
	);

	return (
		<div
			className={cn(
				"flex flex-col h-full",
				className,
				isFullscreen && "fixed inset-0 z-50 bg-background",
			)}
		>
			<PanelShell title="Preview" noPadding actions={toolbar}>
				{/* URL bar */}
				<div className="flex items-center px-3 py-1.5 border-b bg-muted/20 shrink-0">
					<div className="flex-1 min-w-0" onClick={handleCopyUrl} title="Click to copy URL">
						<Input
							readOnly
							value={url}
							className="h-7 text-xs text-muted-foreground bg-muted/50 border-none cursor-pointer select-all focus-visible:ring-0"
						/>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 relative min-h-0">
					{status === "checking" && (
						<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background">
							<RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
							<p className="text-xs text-muted-foreground">Connecting to preview...</p>
						</div>
					)}

					{status === "unavailable" && (
						<div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background">
							<div className="text-center space-y-3 px-4">
								<PreviewOfflineIllustration />
								<div>
									<p className="text-sm font-medium">Preview Not Ready</p>
									<p className="text-xs text-muted-foreground mt-1">
										No server is running on this port yet
									</p>
								</div>
								<Button variant="outline" size="sm" onClick={handleRefresh} className="mt-2 gap-2">
									<RefreshCw className="h-3.5 w-3.5" />
									Retry
								</Button>
							</div>
						</div>
					)}

					<iframe
						ref={iframeRef}
						src={url}
						className={cn(
							"w-full h-full border-0",
							status !== "ready" && "invisible",
						)}
						sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
						title="Preview"
					/>
				</div>
			</PanelShell>
		</div>
	);
}
```

### vscode-panel.tsx (289 lines)

```tsx
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
```

### right-panel.tsx (225 lines)

```tsx
"use client";

import { usePreviewPanelStore } from "@/stores/preview-panel";
import type {
	ActionApprovalRequestMessage,
	AutoStartOutputMessage,
	GitResultMessage,
	GitState,
} from "@proliferate/shared";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MousePointerClick } from "lucide-react";
import dynamic from "next/dynamic";
import { ArtifactsPanel } from "./artifacts-panel";
import { EnvironmentPanel } from "./environment-panel";
import { GitPanel } from "./git-panel";
import { InvestigationPanel } from "./investigation-panel";
import { PreviewPanel } from "./preview-panel";
import { SettingsPanel } from "./settings-panel";
import { VscodePanel } from "./vscode-panel";

const TerminalPanel = dynamic(() => import("./terminal-panel").then((m) => m.TerminalPanel), {
	ssr: false,
});

const ServicesPanel = dynamic(() => import("./services-panel").then((m) => m.ServicesPanel), {
	ssr: false,
});

// ... (SessionPanelProps interface — 40 lines of props)

interface RightPanelProps {
	isMobileFullScreen?: boolean;
	sessionProps?: SessionPanelProps;
	previewUrl?: string | null;
	runId?: string;
}

export function RightPanel({
	isMobileFullScreen,
	sessionProps,
	previewUrl,
	runId,
}: RightPanelProps) {
	const { mode, close, setMobileView } = usePreviewPanelStore();

	// ... loading state, empty state checks ...

	const panelContent = (() => {
		// ... settings, environment, git, terminal, services, vscode, artifacts, investigation ...

		// URL preview — THE KEY LINE:
		if (mode.type === "url") {
			return <PreviewPanel url={mode.url || previewUrl || null} className="h-full" />;
		}

		return null;
	})();

	return (
		<AnimatePresence mode="wait">
			<motion.div key={mode.type} /* fade animation */ className="h-full w-full">
				{panelContent}
			</motion.div>
		</AnimatePresence>
	);
}
```

### panel-shell.tsx (55 lines)

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePreviewPanelStore } from "@/stores/preview-panel";
import { X } from "lucide-react";

interface PanelShellProps {
	title: string;
	icon?: React.ReactNode;
	actions?: React.ReactNode;
	noPadding?: boolean;
	children: React.ReactNode;
}

export function PanelShell({ title, icon, actions, noPadding, children }: PanelShellProps) {
	const closePanel = usePreviewPanelStore((s) => s.closePanel);

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex flex-col h-full w-full bg-background overflow-hidden">
				<div className="h-10 px-3 border-b border-border bg-muted/30 flex items-center justify-between shrink-0">
					<div className="flex items-center gap-2 min-w-0">
						{icon && <span className="shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
						<span className="text-sm font-medium truncate">{title}</span>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						{actions}
						{actions && <div className="w-px h-4 bg-border mx-0.5" />}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7" onClick={closePanel}>
									<X className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Close panel</TooltipContent>
						</Tooltip>
					</div>
				</div>
				<div className={cn("flex-1 min-h-0 overflow-hidden", !noPadding && "overflow-y-auto")}>
					{children}
				</div>
			</div>
		</TooltipProvider>
	);
}
```

### Gateway: vscode.ts proxy (235 lines)

```ts
/**
 * VS Code Proxy Routes
 *
 * HTTP: /proxy/:proliferateSessionId/:token/devtools/vscode[/*]
 * WS:   /proxy/:proliferateSessionId/:token/devtools/vscode[/*]
 *
 * Proxies HTTP and WebSocket connections from the browser to the
 * openvscode-server instance running in the sandbox.
 *
 * HTTP requests go through Caddy's /_proliferate/vscode/* route which
 * uses forward_auth to validate the Bearer token.
 *
 * WS connections are handled via direct WS-to-WS piping (same as terminal).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";
import { createLogger } from "@proliferate/logger";
import type { Request, Response } from "express";
import { Router, type Router as RouterType } from "express";
import { createProxyMiddleware, fixRequestBody } from "http-proxy-middleware";
import { WebSocket } from "ws";
import type { HubManager } from "../../hub";
import type { GatewayEnv } from "../../lib/env";
import { deriveSandboxMcpToken } from "../../lib/sandbox-mcp-token";
import { ApiError, createEnsureSessionReady, createRequireProxyAuth } from "../../middleware";
import { verifyToken } from "../../middleware/auth";
import type { UpgradeHandler } from "../ws-multiplexer";

const logger = createLogger({ service: "gateway" }).child({ module: "vscode-proxy" });

export function createVscodeProxyRoutes(hubManager: HubManager, env: GatewayEnv): RouterType {
	const router: RouterType = Router();
	const requireProxyAuth = createRequireProxyAuth(env);
	const ensureSessionReady = createEnsureSessionReady(hubManager);

	const proxy = createProxyMiddleware<Request, Response>({
		router: (req: Request) => {
			const previewUrl = req.hub?.getPreviewUrl();
			if (!previewUrl) {
				logger.warn({ sessionId: (req as Request).proliferateSessionId }, "No preview URL for vscode proxy");
				throw new ApiError(503, "Sandbox not ready");
			}
			return previewUrl;
		},
		changeOrigin: true,
		timeout: 30_000,
		proxyTimeout: 30_000,
		pathRewrite: (path: string) => {
			return `/_proliferate/vscode${path || "/"}`;
		},
		on: {
			proxyReq: (proxyReq, req) => {
				proxyReq.removeHeader("origin");
				proxyReq.removeHeader("referer");
				const sessionId = (req as Request).proliferateSessionId;
				if (sessionId) {
					const token = deriveSandboxMcpToken(env.serviceToken, sessionId);
					proxyReq.setHeader("Authorization", `Bearer ${token}`);
				}
				fixRequestBody(proxyReq, req as Request);
			},
			proxyRes: (proxyRes, req) => {
				if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
					logger.warn({ status: proxyRes.statusCode, path: (req as Request).originalUrl }, "VS Code proxy upstream error");
				}
			},
			error: (err: Error, _req, res) => {
				logger.error({ err }, "VS Code proxy error");
				if ("headersSent" in res && !res.headersSent && "writeHead" in res) {
					(res as ServerResponse).writeHead(502, { "Content-Type": "application/json" });
					(res as ServerResponse).end(JSON.stringify({ error: "Proxy error", message: err.message }));
				}
			},
		},
	});

	router.use("/:proliferateSessionId/:token/devtools/vscode", requireProxyAuth, ensureSessionReady, proxy);
	return router;
}

// WebSocket proxy: ~135 lines of WS-to-WS piping (see full file if needed)
```

---

## 4. Questions for Technical Advisor

### A. Preview Panel — Health Check Strategy

**Current approach:** Poll with `fetch(url, { mode: "cors" })`. Always fails for Modal URLs because Modal's 502 responses lack CORS headers. After ~55s of polling, shows "Preview Not Ready".

**Fundamental tension:** We cannot use `fetch()` to reliably check cross-origin URL readiness. `mode: "cors"` fails on CORS-less servers. `mode: "no-cors"` resolves for any response status (can't distinguish 200 from 502). The iframe itself doesn't have CORS restrictions.

**Options we see:**

1. **Skip health check entirely** — Always show the iframe immediately. Let the browser handle loading. Downside: user sees a browser error page or white screen until the server is ready, with no retry UX.

2. **Proxy the health check through our gateway** — Add a gateway endpoint like `GET /proxy/:sessionId/:token/health-check?target=<url>` that the gateway fetches server-side (no CORS). Returns `{ ok: boolean }`. Downside: extra gateway endpoint, extra latency per check.

3. **Use the iframe's `load` event** — Show the iframe with a loading overlay. Listen for the iframe's `load` event. Once it fires, show the iframe. Downside: cross-origin iframes fire `load` even on error pages, so we can't distinguish a 502 error page from the actual app. Also, some browsers fire `load` inconsistently for cross-origin iframes.

4. **Short fixed-delay + iframe** — Show a brief "Connecting..." screen (3-5s fixed delay), then always show the iframe. If the server isn't ready, the iframe will show Modal's error page, which at least gives the user feedback. Include a visible refresh button at all times. Downside: arbitrary delay doesn't match actual server readiness.

5. **Gateway-pushed readiness signal** — The gateway already knows when the sandbox is ready (it tracks `previewUrl`). Could we send a WebSocket event when the dev server port becomes active? The sandbox already reports port-forward events. Downside: requires more gateway plumbing.

**Which approach do you recommend? Is there a better pattern we're not seeing?**

### B. VS Code Panel — EADDRINUSE and Health Check

**EADDRINUSE problem:** When the VS Code panel mounts, it POSTs to the sandbox service manager to start `openvscode-server` on port 3901. If the process is already running (from a previous mount, or React strict mode double-invoke), the POST returns 409 (handled), but the service manager may try to start a second instance, which fails with EADDRINUSE.

**Questions:**
1. The `startVscodeServer` function already checks for an existing running service before POSTing. But the check + start is not atomic. Is there a race condition where two concurrent mounts both see "not running" and both POST?
2. React strict mode double-invokes effects in dev. The cleanup function calls `clearPolling()` but doesn't stop the server process. Should we handle this differently?
3. The health check uses `HEAD` requests which return `405 Method Not Allowed` from the ngrok proxy (`workers.ngrok.dev`). Should we use `GET` instead?

### C. Code Quality / Structure

1. **`PreviewPanel` renders an invisible iframe even during "checking" state** — Is pre-rendering the iframe while polling a good pattern, or does it cause unnecessary network requests to the 502 URL?

2. **`VscodePanel` uses `setInterval` for polling** — The preview panel uses recursive `setTimeout` with exponential backoff. The VS Code panel uses `setInterval` at 1s fixed. Should these be consistent? Is `setInterval` with async callbacks safe (can intervals pile up if the fetch takes longer than 1s)?

3. **Both panels implement their own readiness-polling logic** — Should there be a shared `usePolledReadiness(url, options)` hook?

4. **The `startVscodeServer` callback has many dependencies** (`checkHttpHealth`, `clearPolling`, `failWithDiagnostics`, `sessionId`, `token`) — this means it gets recreated frequently. The `useEffect` that calls it also depends on it, potentially causing unnecessary re-invocations. Is there a better pattern?

5. **Error boundaries** — Neither panel has a React error boundary. A thrown error in rendering will crash the entire right panel. Should we add one?

---

## 5. Environment Context

- **Local dev:** Next.js app at `localhost:3000`, gateway exposed via ngrok (`workers.ngrok.dev`)
- **Sandboxes:** Modal cloud sandboxes with tunnel URLs (`*.modal.host`)
- **Preview URLs:** Direct Modal tunnel URLs (cross-origin from the app)
- **VS Code proxy:** Gateway → Caddy → openvscode-server (port 3901 inside sandbox)
- **Auth:** JWT tokens in URL path segments for proxy auth
