"use client";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SelectableItem } from "@/components/ui/selectable-item";
import { useSessionData } from "@/hooks/use-sessions";
import { getSessionGatewayUrl } from "@/lib/gateway";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { TerminalView } from "./terminal-view";

interface HttpService {
	port: number;
	process?: string | null;
	pid?: number | null;
	type: "http";
	url: string;
}

interface TcpService {
	port: number;
	process?: string | null;
	pid?: number | null;
	type: "tcp";
}

interface TerminalEntry {
	socket: string;
	session: string;
	window: string;
	pane: string;
	pane_id?: string | null;
	pane_pid?: number | null;
	pane_tty?: string | null;
	command?: string | null;
	title?: string | null;
	active?: boolean;
	window_name?: string | null;
	target?: string | null;
}

interface ServicesResponse {
	services: HttpService[];
	tcp: TcpService[];
	terminals: TerminalEntry[];
	tmux?: { sockets: string[] };
}

interface PreviewSessionProps {
	sessionId: string;
}

export function PreviewSession({ sessionId }: PreviewSessionProps) {
	const { data: sessionData } = useSessionData(sessionId);
	const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
	const [activeServicePort, setActiveServicePort] = useState<number | null>(null);

	const doUrl = getSessionGatewayUrl(sessionId);
	const doWsBase = doUrl.replace("https://", "wss://");

	const { data, isLoading, error, refetch } = useQuery({
		queryKey: ["preview-services", doUrl],
		queryFn: async () => {
			const res = await fetch(`${doUrl}/api/services`);
			if (!res.ok) throw new Error(`Failed: ${res.status}`);
			return (await res.json()) as ServicesResponse;
		},
		enabled: !!doUrl,
		refetchInterval: 5000,
	});

	const terminals = data?.terminals || [];
	const services = data?.services || [];
	const tcpServices = data?.tcp || [];

	const terminalWsUrl = useMemo(() => {
		if (!activeTerminalId || !doWsBase) return null;
		const selected = terminals.find((t) => terminalId(t) === activeTerminalId);
		const url = new URL(`${doWsBase}/terminal`);
		if (selected) {
			url.searchParams.set("socket", selected.socket);
			if (selected.pane_id) {
				url.searchParams.set("pane_id", selected.pane_id);
			} else if (selected.target) {
				url.searchParams.set("target", selected.target);
			}
		}
		return url.toString();
	}, [activeTerminalId, terminals, doWsBase]);

	const userTerminalUrl = useMemo(() => {
		if (!doWsBase) return null;
		const url = new URL(`${doWsBase}/terminal`);
		url.searchParams.set("mode", "user");
		return url.toString();
	}, [doWsBase]);

	const activePreviewUrl = useMemo(() => {
		if (!activeServicePort || !doUrl) return null;
		return `${doUrl}/preview/${activeServicePort}`;
	}, [activeServicePort, doUrl]);

	return (
		<div className="h-screen flex flex-col">
			<div className="border-b p-3 flex items-center justify-between bg-muted/30">
				<div className="flex items-center gap-3">
					<h1 className="font-semibold">Preview Session</h1>
					{doUrl && (
						<code className="text-xs text-muted-foreground truncate max-w-md">{doUrl}</code>
					)}
				</div>
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
						{isLoading ? "..." : "Refresh"}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => {
							setActiveServicePort(null);
							setActiveTerminalId("user");
						}}
						disabled={!userTerminalUrl}
					>
						New Terminal
					</Button>
				</div>
			</div>

			{error && (
				<div className="p-3 bg-destructive/10 text-destructive text-sm">
					{error instanceof Error ? error.message : "Failed to load services"}
				</div>
			)}

			<div className="flex-1 flex min-h-0">
				<div className="w-72 border-r overflow-hidden flex flex-col">
					<ScrollArea className="flex-1">
						<div className="px-3 py-2 text-xs uppercase text-muted-foreground">Terminals</div>
						{terminals.length === 0 ? (
							<div className="px-3 py-2 text-sm text-muted-foreground">No tmux panes found</div>
						) : (
							terminals.map((t) => {
								const id = terminalId(t);
								return (
									<SelectableItem
										key={id}
										selected={activeTerminalId === id}
										onClick={() => {
											setActiveServicePort(null);
											setActiveTerminalId(id);
										}}
										className="rounded-none border-b"
									>
										<div>
											<div className="text-sm font-medium">
												{t.session}:{t.window}.{t.pane}
											</div>
											<div className="text-xs text-muted-foreground truncate">
												{t.title || t.command || t.window_name || "tmux pane"}
											</div>
										</div>
									</SelectableItem>
								);
							})
						)}

						<div className="px-3 py-2 text-xs uppercase text-muted-foreground">HTTP Services</div>
						{services.length === 0 ? (
							<div className="px-3 py-2 text-sm text-muted-foreground">No HTTP services</div>
						) : (
							services.map((s) => (
								<SelectableItem
									key={s.port}
									selected={activeServicePort === s.port}
									onClick={() => {
										setActiveTerminalId(null);
										setActiveServicePort(s.port);
									}}
									className="rounded-none border-b"
								>
									<div>
										<div className="text-sm font-medium">:{s.port}</div>
										<div className="text-xs text-muted-foreground truncate">
											{s.process || "http service"}
										</div>
									</div>
								</SelectableItem>
							))
						)}

						<div className="px-3 py-2 text-xs uppercase text-muted-foreground">TCP Services</div>
						{tcpServices.length === 0 ? (
							<div className="px-3 py-2 text-sm text-muted-foreground">No TCP services</div>
						) : (
							tcpServices.map((s) => (
								<div key={`tcp-${s.port}`} className="px-3 py-2 border-b">
									<div className="text-sm font-medium">:{s.port}</div>
									<div className="text-xs text-muted-foreground truncate">
										{s.process || "tcp service"}
									</div>
								</div>
							))
						)}
					</ScrollArea>
				</div>

				<div className="flex-1 min-w-0">
					{activeServicePort && activePreviewUrl ? (
						<div className="flex flex-col h-full">
							<div className="border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
								Preview :{activeServicePort}
							</div>
							<iframe
								src={activePreviewUrl}
								className="w-full h-full border-0"
								title={`Preview ${activeServicePort}`}
								sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
							/>
						</div>
					) : (
						<TerminalView wsUrl={activeTerminalId === "user" ? userTerminalUrl : terminalWsUrl} />
					)}
				</div>
			</div>
		</div>
	);
}

function terminalId(entry: TerminalEntry): string {
	return `${entry.socket}|${entry.target || `${entry.session}:${entry.window}.${entry.pane}`}`;
}
