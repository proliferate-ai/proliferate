"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GATEWAY_URL } from "@/lib/gateway";
import type { ActionApprovalRequestMessage } from "@proliferate/shared";
import { Check, Loader2, Shield, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type ActionApproval = ActionApprovalRequestMessage["payload"];

interface ActionApprovalBannerProps {
	sessionId: string;
	token: string | null;
	pendingApprovals: ActionApproval[];
}

/**
 * Floating banner that shows pending action approval requests.
 * Users approve/deny via HTTP calls to the gateway.
 */
export function ActionApprovalBanner({
	sessionId,
	token,
	pendingApprovals,
}: ActionApprovalBannerProps) {
	if (pendingApprovals.length === 0) return null;

	return (
		<div className="flex flex-col gap-2 px-4 py-2">
			{pendingApprovals.map((approval) => (
				<ApprovalCard
					key={approval.invocationId}
					sessionId={sessionId}
					token={token}
					approval={approval}
				/>
			))}
		</div>
	);
}

function ApprovalCard({
	sessionId,
	token,
	approval,
}: {
	sessionId: string;
	token: string | null;
	approval: ActionApproval;
}) {
	const [loading, setLoading] = useState<"approve" | "deny" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [timeLeft, setTimeLeft] = useState<string>("");

	// Countdown timer
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
		async (action: "approve" | "deny") => {
			if (!token || !GATEWAY_URL) return;
			setLoading(action);
			setError(null);
			try {
				const url = `${GATEWAY_URL}/proliferate/${sessionId}/actions/invocations/${approval.invocationId}/${action}`;
				const res = await fetch(url, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
				});
				if (!res.ok) {
					const data = (await res.json().catch(() => ({}))) as { error?: string };
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

	return (
		<div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
			<Shield className="h-4 w-4 shrink-0 text-accent-foreground" />
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium">
						{approval.integration}/{approval.action}
					</span>
					<Badge variant="outline" className="text-xs">
						{approval.riskLevel}
					</Badge>
					{timeLeft && <span className="text-xs text-muted-foreground">{timeLeft}</span>}
				</div>
				{paramsPreview && (
					<p className="text-xs text-muted-foreground truncate mt-0.5">{paramsPreview}</p>
				)}
				{error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
			</div>
			<div className="flex items-center gap-1.5 shrink-0">
				<Button
					size="sm"
					variant="outline"
					className="h-7 px-2"
					disabled={loading !== null || timeLeft === "expired"}
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
					disabled={loading !== null || timeLeft === "expired"}
					onClick={() => respond("approve")}
				>
					{loading === "approve" ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<Check className="h-3 w-3" />
					)}
					<span className="ml-1">Approve</span>
				</Button>
			</div>
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
