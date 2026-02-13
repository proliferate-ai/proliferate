"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAttentionInbox } from "@/hooks/use-attention-inbox";
import { GATEWAY_URL } from "@/lib/gateway";
import type { PendingRunSummary } from "@proliferate/shared";
import type { ActionApprovalRequestMessage } from "@proliferate/shared";
import {
	AlertCircle,
	Check,
	ExternalLink,
	Hand,
	Loader2,
	Shield,
	Timer,
	X,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ActionApproval = ActionApprovalRequestMessage["payload"];

const MAX_VISIBLE_CARDS = 3;

interface InboxTrayProps {
	sessionId: string;
	token: string | null;
	pendingApprovals: ActionApproval[];
}

export function InboxTray({ sessionId, token, pendingApprovals }: InboxTrayProps) {
	const items = useAttentionInbox({
		wsApprovals: pendingApprovals,
		sessionId,
	});

	if (items.length === 0) return null;

	const visible = items.slice(0, MAX_VISIBLE_CARDS);
	const overflow = items.length - MAX_VISIBLE_CARDS;

	return (
		<div className="shrink-0 px-3 pb-2">
			<div className="max-w-2xl mx-auto flex flex-col gap-1.5">
				{visible.map((item) =>
					item.type === "approval" ? (
						<ApprovalCard
							key={item.data.approval.invocationId}
							sessionId={item.data.sessionId}
							token={token}
							approval={item.data.approval}
						/>
					) : (
						<RunCard key={item.data.id} run={item.data} />
					),
				)}
				{overflow > 0 && (
					<p className="text-xs text-muted-foreground text-center py-0.5">
						+{overflow} more {overflow === 1 ? "item" : "items"} needing attention
					</p>
				)}
			</div>
		</div>
	);
}

// ============================================
// Approval Card
// ============================================

function ApprovalCard({
	sessionId,
	token,
	approval,
}: {
	sessionId: string;
	token: string | null;
	approval: ActionApproval;
}) {
	const [loading, setLoading] = useState<"approve" | "deny" | "grant" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [timeLeft, setTimeLeft] = useState<string>("");

	useEffect(() => {
		if (!approval.expiresAt) return;
		const update = () => {
			const ms = new Date(approval.expiresAt).getTime() - Date.now();
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
	}, [approval.expiresAt]);

	const respond = useCallback(
		async (action: "approve" | "deny", mode?: "once" | "grant") => {
			if (!token || !GATEWAY_URL) return;
			setLoading(mode === "grant" ? "grant" : action);
			setError(null);
			try {
				const url = `${GATEWAY_URL}/proliferate/${sessionId}/actions/invocations/${approval.invocationId}/${action}`;
				const body: Record<string, unknown> = {};
				if (mode) body.mode = mode;
				if (mode === "grant") body.grant = { scope: "session", maxCalls: null };

				const res = await fetch(url, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					...(Object.keys(body).length > 0 ? { body: JSON.stringify(body) } : {}),
				});
				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as {
						error?: string;
					};
					throw new Error(data.error || `HTTP ${res.status}`);
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed");
			} finally {
				setLoading(null);
			}
		},
		[sessionId, token, approval.invocationId],
	);

	const paramsPreview = formatParams(approval.params);
	const expired = timeLeft === "expired";

	return (
		<div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
			<Shield className="h-4 w-4 shrink-0 text-accent-foreground" />
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium truncate">
						{approval.integration}/{approval.action}
					</span>
					<Badge variant="outline" className="text-xs shrink-0">
						{approval.riskLevel}
					</Badge>
					{timeLeft && <span className="text-xs text-muted-foreground shrink-0">{timeLeft}</span>}
				</div>
				{paramsPreview && (
					<p className="text-xs text-muted-foreground truncate mt-0.5">{paramsPreview}</p>
				)}
				{error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
			</div>
			<div className="flex items-center gap-1 shrink-0">
				<Button
					size="sm"
					variant="outline"
					className="h-7 px-2"
					disabled={loading !== null || expired}
					onClick={() => respond("deny")}
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
					disabled={loading !== null || expired}
					onClick={() => respond("approve", "once")}
				>
					{loading === "approve" ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<Check className="h-3 w-3" />
					)}
					<span className="ml-1">Approve</span>
				</Button>
				<Button
					size="sm"
					variant="secondary"
					className="h-7 px-2"
					disabled={loading !== null || expired}
					onClick={() => respond("approve", "grant")}
					title="Approve and grant for this session"
				>
					{loading === "grant" ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<Shield className="h-3 w-3" />
					)}
					<span className="ml-1">Grant</span>
				</Button>
			</div>
		</div>
	);
}

// ============================================
// Run Card
// ============================================

function getRunStatusInfo(status: string) {
	switch (status) {
		case "failed":
			return {
				icon: XCircle,
				label: "Failed",
				className: "text-red-500",
			};
		case "needs_human":
			return {
				icon: Hand,
				label: "Needs Human",
				className: "text-amber-500",
			};
		case "timed_out":
			return {
				icon: Timer,
				label: "Timed Out",
				className: "text-orange-500",
			};
		default:
			return {
				icon: AlertCircle,
				label: status,
				className: "text-muted-foreground",
			};
	}
}

function RunCard({ run }: { run: PendingRunSummary }) {
	const statusInfo = getRunStatusInfo(run.status);
	const StatusIcon = statusInfo.icon;
	const viewHref = `/dashboard/automations/${run.automation_id}/events?runId=${run.id}`;

	return (
		<div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
			<StatusIcon className={`h-4 w-4 shrink-0 ${statusInfo.className}`} />
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium truncate">{run.automation_name}</span>
					<Badge variant="outline" className="text-xs shrink-0">
						{statusInfo.label}
					</Badge>
				</div>
				{run.error_message && (
					<p className="text-xs text-muted-foreground truncate mt-0.5">{run.error_message}</p>
				)}
			</div>
			<Link href={viewHref}>
				<Button size="sm" variant="outline" className="h-7 px-2 shrink-0">
					<ExternalLink className="h-3 w-3" />
					<span className="ml-1">View</span>
				</Button>
			</Link>
		</div>
	);
}

function formatParams(params: unknown): string {
	if (!params || typeof params !== "object") return "";
	const entries = Object.entries(params as Record<string, unknown>);
	if (entries.length === 0) return "";
	return entries
		.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
		.join(", ");
}
