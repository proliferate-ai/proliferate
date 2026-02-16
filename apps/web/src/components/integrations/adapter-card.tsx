"use client";

import { ProviderIcon } from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import type { AdapterMeta } from "@/lib/action-adapters";
import { cn } from "@/lib/utils";
import { ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

export interface AdapterCardProps {
	adapter: AdapterMeta;
	isConnected: boolean;
	isLoading: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
}

export function AdapterCard({
	adapter,
	isConnected,
	isLoading,
	onConnect,
	onDisconnect,
}: AdapterCardProps) {
	const [expanded, setExpanded] = useState(false);
	const [confirmDisconnect, setConfirmDisconnect] = useState(false);
	const readCount = adapter.actions.filter((a) => a.riskLevel === "read").length;
	const writeCount = adapter.actions.filter((a) => a.riskLevel === "write").length;

	return (
		<div className="rounded-lg border border-border/80 bg-background">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3">
				<div className="flex items-center gap-3 min-w-0">
					<div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted shrink-0">
						<ProviderIcon provider={adapter.integration} size="sm" />
					</div>
					<div className="min-w-0">
						<p className="text-sm font-medium">{adapter.displayName}</p>
						<p className="text-xs text-muted-foreground">{adapter.description}</p>
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{isConnected ? (
						<>
							<span className="text-xs text-green-600">Connected</span>
							{confirmDisconnect ? (
								<div className="flex items-center gap-1">
									<Button
										variant="destructive"
										size="sm"
										className="h-7 px-2 text-xs"
										onClick={() => {
											onDisconnect();
											setConfirmDisconnect(false);
										}}
										disabled={isLoading}
									>
										Confirm
									</Button>
									<Button
										variant="ghost"
										size="sm"
										className="h-7 px-2 text-xs"
										onClick={() => setConfirmDisconnect(false)}
									>
										Cancel
									</Button>
								</div>
							) : (
								<Button
									variant="ghost"
									size="sm"
									className="h-7 px-2 text-xs text-muted-foreground"
									onClick={() => setConfirmDisconnect(true)}
									disabled={isLoading}
								>
									Disconnect
								</Button>
							)}
						</>
					) : (
						<Button
							variant="outline"
							size="sm"
							className="h-7 px-3 text-xs"
							onClick={onConnect}
							disabled={isLoading}
						>
							{isLoading && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
							Connect
						</Button>
					)}
				</div>
			</div>

			{/* Action summary + expand toggle */}
			<button
				type="button"
				className="flex items-center gap-2 px-4 py-2 w-full border-t border-border/60 text-xs text-muted-foreground hover:text-foreground transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				<ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
				<span>
					{adapter.actions.length} actions ({readCount} read, {writeCount} write)
				</span>
			</button>

			{/* Expanded action list */}
			{expanded && (
				<div className="border-t border-border/60 px-4 py-2 space-y-1">
					{adapter.actions.map((action) => (
						<div key={action.name} className="flex items-center justify-between py-1">
							<div className="flex items-center gap-2 min-w-0">
								<span className="text-xs font-mono text-foreground">{action.name}</span>
								<span className="text-xs text-muted-foreground truncate">{action.description}</span>
							</div>
							<span
								className={cn(
									"text-[10px] px-1.5 py-0.5 rounded border shrink-0",
									action.riskLevel === "read"
										? "text-green-600 border-green-600/30"
										: "text-amber-600 border-amber-600/30",
								)}
							>
								{action.riskLevel}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
