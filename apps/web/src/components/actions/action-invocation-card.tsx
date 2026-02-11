"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ActionInvocation } from "@/hooks/use-actions";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, CheckCircle, Clock, Loader2, Timer, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ActionInvocationCardProps {
	invocation: ActionInvocation;
	showSession?: boolean;
	canApprove?: boolean;
	onApprove?: () => Promise<void>;
	onDeny?: () => Promise<void>;
	onSessionClick?: () => void;
}

const statusConfig: Record<
	string,
	{
		label: string;
		variant: "default" | "secondary" | "destructive" | "outline";
		icon: typeof Check;
	}
> = {
	pending: { label: "Pending", variant: "outline", icon: Clock },
	approved: { label: "Approved", variant: "secondary", icon: Check },
	executing: { label: "Executing", variant: "secondary", icon: Loader2 },
	completed: { label: "Completed", variant: "default", icon: CheckCircle },
	denied: { label: "Denied", variant: "destructive", icon: XCircle },
	failed: { label: "Failed", variant: "destructive", icon: AlertTriangle },
	expired: { label: "Expired", variant: "outline", icon: Timer },
};

const riskColors: Record<string, string> = {
	read: "text-muted-foreground border-muted-foreground/30",
	write: "text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
	danger: "text-destructive border-destructive/30",
};

export function ActionInvocationCard({
	invocation,
	showSession,
	canApprove,
	onApprove,
	onDeny,
	onSessionClick,
}: ActionInvocationCardProps) {
	const [loading, setLoading] = useState<"approve" | "deny" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const isPending = invocation.status === "pending";
	const config = statusConfig[invocation.status] ?? statusConfig.pending;
	const StatusIcon = config.icon;

	const handleAction = useCallback(
		async (action: "approve" | "deny") => {
			const handler = action === "approve" ? onApprove : onDeny;
			if (!handler) return;
			setLoading(action);
			setError(null);
			try {
				await handler();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed");
			} finally {
				setLoading(null);
			}
		},
		[onApprove, onDeny],
	);

	return (
		<div className="flex items-start gap-3 px-3 py-2.5 text-sm">
			<StatusIcon
				className={cn(
					"h-4 w-4 shrink-0 mt-0.5",
					invocation.status === "executing" && "animate-spin",
					invocation.status === "completed" && "text-green-600 dark:text-green-400",
					invocation.status === "failed" && "text-destructive",
					invocation.status === "denied" && "text-destructive",
					invocation.status === "pending" && "text-yellow-600 dark:text-yellow-400",
					invocation.status === "expired" && "text-muted-foreground",
					(invocation.status === "approved" || invocation.status === "executing") &&
						"text-blue-600 dark:text-blue-400",
				)}
			/>

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2 flex-wrap">
					<span className="font-medium">
						{invocation.integration}/{invocation.action}
					</span>
					<Badge variant="outline" className={cn("text-xs h-5", riskColors[invocation.riskLevel])}>
						{invocation.riskLevel}
					</Badge>
					<Badge variant={config.variant} className="text-xs h-5">
						{config.label}
					</Badge>
				</div>

				{showSession && (
					<button
						type="button"
						className="text-xs text-muted-foreground hover:text-foreground transition-colors truncate block mt-0.5"
						onClick={onSessionClick}
					>
						{invocation.sessionTitle || `Session ${invocation.sessionId.slice(0, 8)}...`}
					</button>
				)}

				{formatParams(invocation.params) && (
					<p className="text-xs text-muted-foreground truncate mt-0.5">
						{formatParams(invocation.params)}
					</p>
				)}

				{invocation.error && (
					<p className="text-xs text-destructive truncate mt-0.5">{invocation.error}</p>
				)}

				{error && <p className="text-xs text-destructive mt-0.5">{error}</p>}

				<div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
					{invocation.createdAt && (
						<Tooltip>
							<TooltipTrigger asChild>
								<span>{relativeTime(invocation.createdAt)}</span>
							</TooltipTrigger>
							<TooltipContent>{new Date(invocation.createdAt).toLocaleString()}</TooltipContent>
						</Tooltip>
					)}
					{invocation.durationMs != null && <span>{invocation.durationMs}ms</span>}
					{isPending && invocation.expiresAt && <CountdownTimer expiresAt={invocation.expiresAt} />}
				</div>
			</div>

			{isPending && canApprove && (
				<div className="flex items-center gap-1.5 shrink-0">
					<Button
						size="sm"
						variant="outline"
						className="h-7 px-2"
						disabled={loading !== null}
						onClick={() => handleAction("deny")}
					>
						{loading === "deny" ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<X className="h-3 w-3" />
						)}
						<span className="ml-1">Deny</span>
					</Button>
					<Button
						size="sm"
						className="h-7 px-2"
						disabled={loading !== null}
						onClick={() => handleAction("approve")}
					>
						{loading === "approve" ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<Check className="h-3 w-3" />
						)}
						<span className="ml-1">Approve</span>
					</Button>
				</div>
			)}
		</div>
	);
}

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
	const [timeLeft, setTimeLeft] = useState("");

	useEffect(() => {
		const update = () => {
			const ms = new Date(expiresAt).getTime() - Date.now();
			if (ms <= 0) {
				setTimeLeft("expired");
				return;
			}
			const mins = Math.floor(ms / 60000);
			const secs = Math.floor((ms % 60000) / 1000);
			setTimeLeft(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
		};
		update();
		const interval = setInterval(update, 1000);
		return () => clearInterval(interval);
	}, [expiresAt]);

	return <span className="text-yellow-600 dark:text-yellow-400">{timeLeft}</span>;
}

export function formatParams(params: unknown): string {
	if (!params || typeof params !== "object") return "";
	const entries = Object.entries(params as Record<string, unknown>);
	if (entries.length === 0) return "";
	return entries
		.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
		.join(", ");
}

function relativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const secs = Math.floor(diff / 1000);
	if (secs < 60) return "just now";
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
