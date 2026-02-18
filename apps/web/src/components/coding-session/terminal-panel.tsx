"use client";

import "xterm/css/xterm.css";
import { GATEWAY_URL } from "@/lib/gateway";
import { cn } from "@/lib/utils";
import { Circle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { PanelShell } from "./panel-shell";
import { useWsToken } from "./runtime/use-ws-token";

interface TerminalPanelProps {
	sessionId: string;
}

type ConnectionStatus = "connecting" | "connected" | "error" | "closed";

function buildTerminalWsUrl(sessionId: string, token: string): string {
	const base = GATEWAY_URL.replace(/^http/, "ws");
	return `${base}/proxy/${sessionId}/${token}/devtools/terminal`;
}

/** Resolve a CSS custom property to its computed HSL value. */
function getCssColor(property: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
	return value ? `hsl(${value})` : "";
}

const STATUS_LABELS: Record<ConnectionStatus, string> = {
	connecting: "Connecting",
	connected: "Connected",
	error: "Error",
	closed: "Disconnected",
};

function TerminalStatus({ status }: { status: ConnectionStatus }) {
	return (
		<span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
			<Circle
				className={cn(
					"h-2 w-2 fill-current",
					status === "connected" && "text-green-500",
					status === "connecting" && "text-yellow-500 animate-pulse",
					(status === "error" || status === "closed") && "text-muted-foreground/50",
				)}
			/>
			{STATUS_LABELS[status]}
		</span>
	);
}

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [status, setStatus] = useState<ConnectionStatus>("connecting");
	const { token } = useWsToken();

	const connect = useCallback(
		(container: HTMLDivElement, tkn: string) => {
			let isActive = true;
			setStatus("connecting");

			const bg = getCssColor("--background");
			const fg = getCssColor("--foreground");

			const term = new Terminal({
				convertEol: true,
				cursorBlink: true,
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
				fontSize: 12,
				theme:
					bg && fg
						? {
								background: bg,
								foreground: fg,
								cursor: fg,
							}
						: undefined,
			});
			const fit = new FitAddon();
			term.loadAddon(fit);
			term.open(container);

			try {
				const dims = fit.proposeDimensions();
				if (dims) fit.fit();
			} catch {
				// Container not ready yet — ResizeObserver will handle it
			}

			const wsUrl = buildTerminalWsUrl(sessionId, tkn);
			const ws = new WebSocket(wsUrl);

			ws.onopen = () => {
				if (!isActive) return;
				setStatus("connected");
				try {
					const dims = fit.proposeDimensions();
					if (dims) {
						ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
					}
				} catch {
					// Terminal not ready
				}
			};

			ws.onclose = () => {
				if (!isActive) return;
				setStatus("closed");
				// Auto-reconnect after 2s
				setTimeout(() => {
					if (isActive && containerRef.current) {
						term.dispose();
						observer.disconnect();
						const cleanup = connect(containerRef.current, tkn);
						cleanupRef.current = cleanup;
					}
				}, 2000);
			};

			ws.onerror = () => {
				if (!isActive) return;
				setStatus("error");
			};

			ws.onmessage = (event) => {
				if (typeof event.data === "string") {
					term.write(event.data);
					return;
				}
				if (event.data instanceof ArrayBuffer) {
					term.write(new Uint8Array(event.data));
					return;
				}
				if (event.data instanceof Blob) {
					void event.data
						.arrayBuffer()
						.then((buf) => term.write(new Uint8Array(buf)))
						.catch(() => {
							// Ignore parse errors
						});
				}
			};

			term.onData((data) => {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(data);
				}
			});

			const observer = new ResizeObserver(() => {
				try {
					const dims = fit.proposeDimensions();
					if (dims) {
						fit.fit();
						if (ws.readyState === WebSocket.OPEN) {
							ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
						}
					}
				} catch {
					// Terminal not ready
				}
			});
			observer.observe(container);

			return () => {
				isActive = false;
				observer.disconnect();
				try {
					ws.close();
				} catch {
					// Ignore close errors
				}
				term.dispose();
			};
		},
		[sessionId],
	);

	const cleanupRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !token || !GATEWAY_URL) return;

		const cleanup = connect(container, token);
		cleanupRef.current = cleanup;

		return () => {
			cleanupRef.current = null;
			cleanup();
		};
	}, [connect, token]);

	return (
		<PanelShell title="Terminal" noPadding actions={<TerminalStatus status={status} />}>
			<div ref={containerRef} className="h-full min-h-0 bg-background" />
		</PanelShell>
	);
}
