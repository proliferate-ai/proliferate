"use client";

import { useWsToken } from "@/components/coding-session/runtime/use-ws-token";
import { Button } from "@/components/ui/button";
import { useSetActionMode } from "@/hooks/use-action-modes";
import { useApproveAction, useDenyAction } from "@/hooks/use-actions";
import type { ApprovalWithSession, AttentionItem } from "@/hooks/use-attention-inbox";
import { formatRelativeTime } from "@/lib/utils";
import type { PendingRunSummary } from "@proliferate/shared";
import {
	AlertCircle,
	Check,
	ExternalLink,
	Hand,
	Loader2,
	Shield,
	ShieldCheck,
	Timer,
	X,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// ============================================
// Button state machine for micro-interactions
// ============================================

type ButtonState = "idle" | "pending" | "success";

function useButtonState() {
	const [state, setState] = useState<ButtonState>("idle");
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
		};
	}, []);

	const trigger = useCallback(async (action: () => Promise<unknown>) => {
		setState("pending");
		try {
			await action();
			setState("success");
			if (timeoutRef.current) clearTimeout(timeoutRef.current);
			timeoutRef.current = setTimeout(() => {
				setState("idle");
			}, 1500);
		} catch {
			setState("idle");
		}
	}, []);

	return { state, trigger };
}

// ============================================
// InboxItem (dispatcher)
// ============================================

export function InboxItem({ item }: { item: AttentionItem }) {
	if (item.type === "approval") {
		return <ApprovalItem data={item.data} />;
	}
	return <RunItem data={item.data} />;
}

// ============================================
// Approval Item
// ============================================

function ApprovalItem({ data }: { data: ApprovalWithSession }) {
	const { approval, sessionId, sessionTitle } = data;
	const { token } = useWsToken();

	const approveAction = useApproveAction();
	const denyAction = useDenyAction();
	const setActionMode = useSetActionMode();

	const approveBtn = useButtonState();
	const denyBtn = useButtonState();
	const alwaysAllowBtn = useButtonState();

	const anyPending =
		approveBtn.state !== "idle" || denyBtn.state !== "idle" || alwaysAllowBtn.state !== "idle";

	const handleApprove = () => {
		if (!token) return;
		approveBtn.trigger(async () => {
			await approveAction.mutateAsync({
				sessionId,
				invocationId: approval.invocationId,
				token,
			});
		});
	};

	const handleDeny = () => {
		if (!token) return;
		denyBtn.trigger(async () => {
			await denyAction.mutateAsync({
				sessionId,
				invocationId: approval.invocationId,
				token,
			});
		});
	};

	const handleAlwaysAllow = () => {
		if (!token) return;
		alwaysAllowBtn.trigger(async () => {
			await approveAction.mutateAsync({
				sessionId,
				invocationId: approval.invocationId,
				token,
			});
			await setActionMode.mutateAsync({
				key: `${approval.integration}/${approval.action}`,
				mode: "allow",
			});
		});
	};

	const timeAgo = approval.expiresAt ? formatRelativeTime(approval.expiresAt) : null;

	return (
		<div className="rounded-xl border border-border bg-card p-3 hover:bg-muted/30 transition-colors">
			<div className="flex items-start gap-3">
				<Shield className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium text-foreground">
						Run <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{approval.action}</code> on{" "}
						<span className="capitalize">{approval.integration}</span>
					</p>
					<p className="text-xs text-muted-foreground mt-0.5 truncate">
						{sessionTitle || "View session"}
						{timeAgo && ` · ${timeAgo}`}
					</p>
				</div>
				{sessionId && (
					<Link
						href={`/workspace/${sessionId}`}
						className="text-xs text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
					>
						<ExternalLink className="h-3.5 w-3.5" />
					</Link>
				)}
			</div>

			<div className="flex items-center gap-1.5 mt-2.5 ml-7">
				<Button
					size="sm"
					variant="default"
					className="h-7 text-xs px-2.5"
					disabled={anyPending}
					onClick={handleApprove}
				>
					<MicroIcon state={approveBtn.state} idle={Check} />
					<span className="ml-1">Approve</span>
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="h-7 text-xs px-2.5"
					disabled={anyPending}
					onClick={handleDeny}
				>
					<MicroIcon state={denyBtn.state} idle={X} />
					<span className="ml-1">Deny</span>
				</Button>
				<Button
					size="sm"
					variant="secondary"
					className="h-7 text-xs px-2.5"
					disabled={anyPending}
					onClick={handleAlwaysAllow}
					title="Approve this action and set org-level mode to always allow"
				>
					<MicroIcon state={alwaysAllowBtn.state} idle={ShieldCheck} />
					<span className="ml-1">Always Allow</span>
				</Button>
			</div>
		</div>
	);
}

// ============================================
// Run Item
// ============================================

function getRunStatusInfo(status: string) {
	switch (status) {
		case "failed":
			return { icon: XCircle, label: "Failed", className: "text-red-500" };
		case "needs_human":
			return { icon: Hand, label: "Needs attention", className: "text-amber-500" };
		case "timed_out":
			return { icon: Timer, label: "Timed out", className: "text-orange-500" };
		default:
			return { icon: AlertCircle, label: status, className: "text-muted-foreground" };
	}
}

function RunItem({ data }: { data: PendingRunSummary }) {
	const statusInfo = getRunStatusInfo(data.status);
	const StatusIcon = statusInfo.icon;

	const title =
		data.status === "failed"
			? `${data.automation_name} failed`
			: data.status === "timed_out"
				? `${data.automation_name} timed out`
				: `${data.automation_name} needs attention`;

	const timeAgo = data.completed_at
		? formatRelativeTime(data.completed_at)
		: formatRelativeTime(data.queued_at);

	return (
		<div className="rounded-xl border border-border bg-card p-3 hover:bg-muted/30 transition-colors">
			<div className="flex items-start gap-3">
				<StatusIcon className={`h-4 w-4 shrink-0 mt-0.5 ${statusInfo.className}`} />
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium text-foreground">{title}</p>
					<p className="text-xs text-muted-foreground mt-0.5 truncate">
						{data.error_message ? `${data.error_message} · ` : ""}
						{timeAgo}
					</p>
				</div>
				{data.session_id && (
					<Link href={`/workspace/${data.session_id}`} className="shrink-0 mt-0.5">
						<Button size="sm" variant="outline" className="h-7 text-xs px-2.5">
							<ExternalLink className="h-3 w-3" />
							<span className="ml-1">View Session</span>
						</Button>
					</Link>
				)}
			</div>
		</div>
	);
}

// ============================================
// Micro-interaction icon helper
// ============================================

function MicroIcon({
	state,
	idle: IdleIcon,
}: {
	state: ButtonState;
	idle: React.ComponentType<{ className?: string }>;
}) {
	if (state === "pending") {
		return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
	}
	if (state === "success") {
		return <Check className="h-3.5 w-3.5" />;
	}
	return <IdleIcon className="h-3.5 w-3.5" />;
}
