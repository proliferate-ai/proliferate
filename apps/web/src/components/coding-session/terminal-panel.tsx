"use client";

import "xterm/css/xterm.css";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GATEWAY_URL } from "@/lib/gateway";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { useWsToken } from "./runtime/use-ws-token";

interface TerminalPanelProps {
	sessionId: string;
	onClose: () => void;
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

export function TerminalPanel({ sessionId, onClose }: TerminalPanelProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const observerRef = useRef<ResizeObserver | null>(null);
	const [status, setStatus] = useState<"connecting" | "connected" | "error" | "closed">(
		"connecting",
	);
	const { token } = useWsToken();

	useEffect(() => {
		if (!containerRef.current || !token || !GATEWAY_URL) return;

		setStatus("connecting");

		// Resolve theme colors from CSS custom properties
		const bg = getCssColor("--background") || "#1a1a1a";
		const fg = getCssColor("--foreground") || "#e5e7eb";

		const term = new Terminal({
			convertEol: true,
			cursorBlink: true,
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
			fontSize: 12,
			theme: {
				background: bg,
				foreground: fg,
				cursor: fg,
			},
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(containerRef.current);

		// Initial fit
		try {
			const dims = fit.proposeDimensions();
			if (dims) fit.fit();
		} catch {
			// Container not ready yet — ResizeObserver will handle it
		}

		const wsUrl = buildTerminalWsUrl(sessionId, token);
		const ws = new WebSocket(wsUrl);
		wsRef.current = ws;

		ws.onopen = () => {
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
			setStatus("closed");
		};

		ws.onerror = () => {
			setStatus("error");
		};

		ws.onmessage = (event) => {
			term.write(event.data);
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
		observer.observe(containerRef.current);
		observerRef.current = observer;

		terminalRef.current = term;
		fitRef.current = fit;

		return () => {
			observer.disconnect();
			try {
				ws.close();
			} catch {
				// Ignore close errors
			}
			term.dispose();
			terminalRef.current = null;
			fitRef.current = null;
			wsRef.current = null;
		};
	}, [sessionId, token]);

	return (
		<TooltipProvider delayDuration={150}>
			<div className="flex flex-col h-full">
				<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
					<span className="text-sm font-medium">Terminal</span>
					<div className="flex items-center gap-1">
						<span className="text-xs text-muted-foreground">{status}</span>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
									<X className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Close panel</TooltipContent>
						</Tooltip>
					</div>
				</div>
				<div ref={containerRef} className="flex-1 min-h-0 bg-background" />
			</div>
		</TooltipProvider>
	);
}
