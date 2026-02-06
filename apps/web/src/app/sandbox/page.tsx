"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

interface ServiceInfo {
	name: string;
	command: string;
	pid: number;
	status: "running" | "stopped" | "error";
	startedAt: number;
	logFile: string;
}

function SandboxContent() {
	const searchParams = useSearchParams();
	const previewUrl = searchParams.get("url");

	const [services, setServices] = useState<ServiceInfo[]>([]);
	const [selectedService, setSelectedService] = useState<string | null>(null);
	const [logs, setLogs] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const eventSourceRef = useRef<EventSource | null>(null);
	const logsEndRef = useRef<HTMLDivElement>(null);

	const fetchServices = useCallback(async () => {
		if (!previewUrl) return;
		setLoading(true);
		try {
			// Use URL constructor to avoid double-slash issues
			const servicesUrl = new URL("/api/services", previewUrl).toString();
			const res = await fetch(servicesUrl);
			if (!res.ok) throw new Error(`Failed: ${res.status}`);
			const data = await res.json();
			setServices(data.services || []);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch services");
		} finally {
			setLoading(false);
		}
	}, [previewUrl]);

	useEffect(() => {
		fetchServices();
		const interval = setInterval(fetchServices, 5000);
		return () => clearInterval(interval);
	}, [fetchServices]);

	useEffect(() => {
		if (eventSourceRef.current) {
			eventSourceRef.current.close();
			eventSourceRef.current = null;
		}

		if (!previewUrl || !selectedService) {
			setLogs("");
			return;
		}

		// Use URL constructor to avoid double-slash issues
		const logsUrl = new URL(
			`/api/logs/${encodeURIComponent(selectedService)}`,
			previewUrl,
		).toString();
		const es = new EventSource(logsUrl);
		eventSourceRef.current = es;

		es.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				if (data.type === "initial") {
					setLogs(data.content || "");
				} else if (data.type === "append") {
					setLogs((prev) => prev + (data.content || ""));
				}
			} catch {
				setLogs((prev) => prev + event.data);
			}
		};

		es.onerror = () => {
			es.close();
		};

		return () => es.close();
	}, [previewUrl, selectedService]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: we want to scroll when logs changes
	useEffect(() => {
		logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [logs]);

	if (!previewUrl) {
		return (
			<div className="p-8 max-w-2xl mx-auto">
				<h1 className="text-2xl font-bold mb-4">Sandbox Services</h1>
				<p className="text-muted-foreground mb-4">
					Add <code className="bg-muted px-1 rounded">?url=YOUR_PREVIEW_URL</code> to view services
				</p>
				<Input
					type="text"
					placeholder="Paste preview URL..."
					className="font-mono"
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							const url = (e.target as HTMLInputElement).value;
							if (url) window.location.href = `/sandbox?url=${encodeURIComponent(url)}`;
						}
					}}
				/>
			</div>
		);
	}

	return (
		<div className="h-screen flex flex-col">
			<div className="border-b p-3 flex items-center justify-between bg-muted/30">
				<div className="flex items-center gap-3">
					<h1 className="font-semibold">Services</h1>
					<code className="text-xs text-muted-foreground truncate max-w-md">{previewUrl}</code>
				</div>
				<Button variant="outline" size="sm" onClick={fetchServices} disabled={loading}>
					{loading ? "..." : "Refresh"}
				</Button>
			</div>

			{error && <div className="p-3 bg-destructive/10 text-destructive text-sm">{error}</div>}

			<div className="flex-1 flex min-h-0">
				{/* Services list */}
				<div className="w-64 border-r overflow-auto">
					{services.length === 0 ? (
						<div className="p-4 text-sm text-muted-foreground">No services running</div>
					) : (
						services.map((s) => (
							<div
								key={s.name}
								className={`p-3 border-b cursor-pointer hover:bg-muted/50 ${selectedService === s.name ? "bg-muted" : ""}`}
								onClick={() => setSelectedService(s.name)}
							>
								<div className="flex items-center gap-2">
									<span
										className={`w-2 h-2 rounded-full ${s.status === "running" ? "bg-green-500" : "bg-gray-400"}`}
									/>
									<span className="font-medium text-sm">{s.name}</span>
								</div>
								<div className="text-xs text-muted-foreground truncate mt-1">{s.command}</div>
								<div className="text-xs text-muted-foreground">PID: {s.pid}</div>
							</div>
						))
					)}
				</div>

				{/* Logs panel */}
				<div className="flex-1 flex flex-col min-w-0">
					{selectedService ? (
						<>
							<div className="p-2 border-b bg-muted/20 flex items-center justify-between">
								<span className="font-medium text-sm">{selectedService} logs</span>
								<Button variant="ghost" size="sm" onClick={() => setLogs("")}>
									Clear
								</Button>
							</div>
							<ScrollArea className="flex-1">
								<pre className="p-3 text-xs font-mono whitespace-pre-wrap">
									{logs || "No logs yet..."}
								</pre>
								<div ref={logsEndRef} />
							</ScrollArea>
						</>
					) : (
						<div className="flex-1 flex items-center justify-center text-muted-foreground">
							Select a service to view logs
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export default function SandboxPage() {
	return (
		<Suspense fallback={<div className="p-8">Loading...</div>}>
			<SandboxContent />
		</Suspense>
	);
}
