"use client";

import "xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

interface TerminalViewProps {
	wsUrl: string | null;
}

export function TerminalView({ wsUrl }: TerminalViewProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const resizeObserverRef = useRef<ResizeObserver | null>(null);
	const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");

	useEffect(() => {
		if (!containerRef.current || !wsUrl) return;

		setStatus("connecting");

		const term = new Terminal({
			convertEol: true,
			cursorBlink: true,
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
			fontSize: 12,
			theme: {
				background: "#0b0d10",
				foreground: "#e5e7eb",
			},
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(containerRef.current);

		// Only fit if container has dimensions
		try {
			const dims = fit.proposeDimensions();
			if (dims) {
				fit.fit();
			}
		} catch {
			// Container not ready yet, ResizeObserver will handle it
		}

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
			setStatus("idle");
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
		resizeObserverRef.current = observer;

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
	}, [wsUrl]);

	if (!wsUrl) {
		return (
			<div className="flex h-full items-center justify-center text-muted-foreground">
				No terminal selected
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
				<span>Terminal</span>
				<span>{status}</span>
			</div>
			<div ref={containerRef} className="flex-1 bg-[#0b0d10]" />
		</div>
	);
}
