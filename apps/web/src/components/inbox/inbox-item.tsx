"use client";

import { useWsToken } from "@/components/coding-session/runtime/use-ws-token";
import { Button } from "@/components/ui/button";
import { useSetActionMode } from "@/hooks/use-action-modes";
import { useApproveAction, useDenyAction } from "@/hooks/use-actions";
import type { ApprovalWithSession, AttentionItem } from "@/hooks/use-attention-inbox";
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

	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="flex items-start gap-3">
				<Shield className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
				<div className="flex-1 min-w-0">
					<p className="text-sm">
						Agent wants to run{" "}
						<code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
							{approval.action}
						</code>{" "}
						on <span className="font-medium capitalize">{approval.integration}</span>
					</p>
					{sessionTitle && (
						<Link
							href={`/workspace/${sessionId}`}
							className="text-xs text-muted-foreground hover:text-foreground hover:underline mt-1 inline-block"
						>
							{sessionTitle}
						</Link>
					)}
					{!sessionTitle && sessionId && (
						<Link
							href={`/workspace/${sessionId}`}
							className="text-xs text-muted-foreground hover:text-foreground hover:underline mt-1 inline-block"
						>
							View session
						</Link>
					)}
				</div>
			</div>

			<div className="flex items-center gap-2 mt-3 ml-8">
				<Button
					size="sm"
					variant="default"
					className="h-8"
					disabled={anyPending}
					onClick={handleApprove}
				>
					<MicroIcon state={approveBtn.state} idle={Check} />
					<span className="ml-1.5">Approve</span>
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="h-8"
					disabled={anyPending}
					onClick={handleDeny}
				>
					<MicroIcon state={denyBtn.state} idle={X} />
					<span className="ml-1.5">Deny</span>
				</Button>
				<Button
					size="sm"
					variant="secondary"
					className="h-8"
					disabled={anyPending}
					onClick={handleAlwaysAllow}
					title="Approve this action and set org-level mode to always allow"
				>
					<MicroIcon state={alwaysAllowBtn.state} idle={ShieldCheck} />
					<span className="ml-1.5">Always Allow</span>
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
			return { icon: XCircle, label: "failed", className: "text-red-500" };
		case "needs_human":
			return { icon: Hand, label: "needs attention", className: "text-amber-500" };
		case "timed_out":
			return { icon: Timer, label: "timed out", className: "text-orange-500" };
		default:
			return { icon: AlertCircle, label: status, className: "text-muted-foreground" };
	}
}

function RunItem({ data }: { data: PendingRunSummary }) {
	const statusInfo = getRunStatusInfo(data.status);
	const StatusIcon = statusInfo.icon;

	const statement =
		data.status === "failed"
			? `Automation "${data.automation_name}" failed`
			: `Automation "${data.automation_name}" needs attention`;

	return (
		<div className="rounded-lg border bg-card p-4">
			<div className="flex items-start gap-3">
				<StatusIcon className={`h-5 w-5 shrink-0 mt-0.5 ${statusInfo.className}`} />
				<div className="flex-1 min-w-0">
					<p className="text-sm">{statement}</p>
					{data.error_message && (
						<p className="text-xs text-muted-foreground mt-1 truncate">{data.error_message}</p>
					)}
				</div>
			</div>

			<div className="mt-3 ml-8 flex items-center gap-2">
				<Link href={`/dashboard/automations/runs/${data.id}`}>
					<Button size="sm" variant="default" className="h-8">
						<ExternalLink className="h-3.5 w-3.5" />
						<span className="ml-1.5">Inspect Run</span>
					</Button>
				</Link>
				{data.session_id && (
					<Link href={`/workspace/${data.session_id}`}>
						<Button size="sm" variant="outline" className="h-8">
							<span>Take Over in Studio</span>
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
