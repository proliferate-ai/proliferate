"use client";

import "xterm/css/xterm.css";
import { GATEWAY_URL } from "@/lib/gateway";
import { cn } from "@/lib/utils";
import { SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { PanelShell } from "./panel-shell";
import { useWsToken } from "./runtime/use-ws-token";

interface TerminalPanelProps {
	sessionId: string;
}

function buildTerminalWsUrl(sessionId: string, token: string): string {
	const base = GATEWAY_URL.replace(/^http/, "ws");
	return `${base}/proxy/${sessionId}/${token}/devtools/terminal`;
}

/** Resolve a CSS custom property to its computed HSL value. */
function getCssColor(property: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
	return value ? `hsl(${value})` : "";
}

type ConnectionStatus = "connecting" | "connected" | "error" | "closed";

function StatusDot({ status }: { status: ConnectionStatus }) {
	return (
		<div
			className={cn(
				"h-2 w-2 rounded-full shrink-0",
				status === "connected" && "bg-green-500",
				status === "connecting" && "bg-yellow-500 animate-pulse",
				(status === "error" || status === "closed") && "bg-red-500",
			)}
			title={status}
		/>
	);
}

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [status, setStatus] = useState<ConnectionStatus>("connecting");
	const { token } = useWsToken();
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isActiveRef = useRef(true);

	const initTerminal = useCallback(() => {
		const container = containerRef.current;
		if (!container || !token || !GATEWAY_URL) return;

		isActiveRef.current = true;
		setStatus("connecting");

		// Resolve theme colors from CSS custom properties
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

		// Initial fit
		try {
			const dims = fit.proposeDimensions();
			if (dims) fit.fit();
		} catch {
			// Container not ready yet — ResizeObserver will handle it
		}

		const wsUrl = buildTerminalWsUrl(sessionId, token);
		const ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			if (!isActiveRef.current) return;
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
			if (!isActiveRef.current) return;
			setStatus("closed");
			// Auto-reconnect after 3 seconds
			reconnectTimeoutRef.current = setTimeout(() => {
				if (isActiveRef.current) {
					term.dispose();
					initTerminal();
				}
			}, 3000);
		};

		ws.onerror = () => {
			if (!isActiveRef.current) return;
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
			isActiveRef.current = false;
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
			observer.disconnect();
			try {
				ws.close();
			} catch {
				// Ignore close errors
			}
			term.dispose();
		};
	}, [sessionId, token]);

	useEffect(() => {
		const cleanup = initTerminal();
		return () => {
			isActiveRef.current = false;
			cleanup?.();
		};
	}, [initTerminal]);

	return (
		<PanelShell
			title="Terminal"
			icon={<SquareTerminal className="h-4 w-4 text-muted-foreground" />}
			actions={<StatusDot status={status} />}
			noPadding
		>
			<div ref={containerRef} className="h-full min-h-0 bg-background" />
		</PanelShell>
	);
}
