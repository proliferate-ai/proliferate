"use client";

import "xterm/css/xterm.css";
import { GATEWAY_URL } from "@/lib/gateway";
import { Loader2 } from "lucide-react";
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

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const [status, setStatus] = useState<"connecting" | "connected" | "error" | "closed">(
		"connecting",
	);
	const { token } = useWsToken();

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !token || !GATEWAY_URL) return;

		let isActive = true;
		setStatus("connecting");

		// Resolve theme colors from CSS custom properties
		const bg = getCssColor("--background");
		const fg = getCssColor("--foreground");

		const term = new Terminal({
			convertEol: true,
			cursorBlink: true,
			cursorStyle: "bar",
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
			fontSize: 13,
			lineHeight: 1.4,
			letterSpacing: 0,
			scrollback: 5000,
			theme:
				bg && fg
					? {
							background: bg,
							foreground: fg,
							cursor: fg,
							selectionBackground: `${fg}33`,
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
	}, [sessionId, token]);

	return (
		<div className="relative flex-1 min-h-0 h-full bg-background">
			<div ref={containerRef} className="absolute inset-2" />
			{status !== "connected" && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background">
					{status === "connecting" && (
						<>
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
							<p className="text-xs text-muted-foreground">Connecting...</p>
						</>
					)}
					{status === "error" && (
						<p className="text-xs text-destructive">Terminal connection failed</p>
					)}
					{status === "closed" && (
						<p className="text-xs text-muted-foreground">Connection closed</p>
					)}
				</div>
			)}
		</div>
	);
}
