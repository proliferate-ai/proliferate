"use client";

import "xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import { useServiceLogs } from "./runtime/use-services";

/** Resolve a CSS custom property to its computed HSL value. */
function getCssColor(property: string): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue(property).trim();
	return value ? `hsl(${value})` : "";
}

interface ServiceLogViewerProps {
	sessionId: string;
	serviceName: string;
}

export function ServiceLogViewer({ sessionId, serviceName }: ServiceLogViewerProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<Terminal | null>(null);

	// Mount xterm Terminal
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const bg = getCssColor("--background");
		const fg = getCssColor("--foreground");

		const term = new Terminal({
			disableStdin: true,
			convertEol: true,
			cursorBlink: false,
			scrollback: 5000,
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
		termRef.current = term;

		// Initial fit
		try {
			const dims = fit.proposeDimensions();
			if (dims) fit.fit();
		} catch {
			// Container not ready — ResizeObserver handles it
		}

		const observer = new ResizeObserver(() => {
			try {
				const dims = fit.proposeDimensions();
				if (dims) fit.fit();
			} catch {
				// Terminal not ready
			}
		});
		observer.observe(container);

		return () => {
			observer.disconnect();
			term.dispose();
			termRef.current = null;
		};
	}, []);

	// SSE log streaming into xterm
	useServiceLogs(sessionId, serviceName, termRef);

	return <div ref={containerRef} className="h-full min-h-0 bg-background" />;
}
