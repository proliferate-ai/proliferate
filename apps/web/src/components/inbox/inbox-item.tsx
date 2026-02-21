"use client";

import { useWsToken } from "@/components/coding-session/runtime/use-ws-token";
import { Button } from "@/components/ui/button";
import { SanitizedMarkdown } from "@/components/ui/sanitized-markdown";
import { useSetActionMode } from "@/hooks/use-action-modes";
import { useApproveAction, useDenyAction } from "@/hooks/use-actions";
import type { ApprovalWithSession, AttentionItem, BlockedGroup } from "@/hooks/use-attention-inbox";
import { useOrgMembersAndInvitations } from "@/hooks/use-orgs";
import { useSessionData } from "@/hooks/use-sessions";
import { useSession } from "@/lib/auth-client";
import { type OrgRole, hasRoleOrHigher } from "@/lib/roles";
import { getRunStatusDisplay } from "@/lib/run-status";
import { formatCompactMetrics } from "@/lib/session-display";
import { formatRelativeTime } from "@/lib/utils";
import type { PendingRunSummary } from "@proliferate/shared";
import {
	AlertOctagon,
	Check,
	ExternalLink,
	GitPullRequest,
	Loader2,
	Shield,
	ShieldCheck,
	X,
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
	if (item.type === "blocked") {
		return <BlockedGroupItem data={item.data} />;
	}
	return <RunItem data={item.data} />;
}

// ============================================
// Approval Item
// ============================================

function ApprovalItem({ data }: { data: ApprovalWithSession }) {
	const { approval, sessionId, sessionTitle } = data;
	const { token } = useWsToken();
	const { data: session } = useSessionData(sessionId);

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
				key: `${approval.integration}:${approval.action}`,
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
					{(session?.latestTask || session?.promptSnippet) && (
						<p className="text-xs text-muted-foreground mt-1 truncate">
							{session?.latestTask ?? session?.promptSnippet}
						</p>
					)}
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

function RunItem({ data }: { data: PendingRunSummary }) {
	const statusInfo = getRunStatusDisplay(data.status);
	const StatusIcon = statusInfo.icon;
	const { data: session } = useSessionData(data.session_id ?? "");

	const title =
		data.status === "failed"
			? `${data.automation_name} failed`
			: data.status === "timed_out"
				? `${data.automation_name} timed out`
				: `${data.automation_name} needs attention`;

	const timeAgo = data.completed_at
		? formatRelativeTime(data.completed_at)
		: formatRelativeTime(data.queued_at);

	const contextLine = session?.latestTask ?? session?.promptSnippet;
	const metricsStr = session?.metrics ? formatCompactMetrics(session.metrics) : null;
	const prCount = session?.prUrls?.length ?? 0;

	return (
		<div className="rounded-xl border border-border bg-card p-3 hover:bg-muted/30 transition-colors">
			<div className="flex items-start gap-3">
				<StatusIcon
					className={`h-4 w-4 shrink-0 mt-0.5 ${statusInfo.className}`}
					aria-hidden="true"
				/>
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium text-foreground">{title}</p>
					<p className="text-xs text-muted-foreground mt-0.5 truncate">
						{data.error_message ? `${data.error_message} · ` : ""}
						{timeAgo}
					</p>
					{contextLine && (
						<p className="text-xs text-muted-foreground mt-1 truncate">{contextLine}</p>
					)}
					{session?.summary && (
						<SanitizedMarkdown
							content={session.summary}
							maxLength={2000}
							className="mt-2 text-xs text-muted-foreground"
						/>
					)}
					{(metricsStr || prCount > 0) && (
						<p className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
							{metricsStr && <span>{metricsStr}</span>}
							{prCount > 0 && (
								<span className="inline-flex items-center gap-1">
									<GitPullRequest className="h-3 w-3" aria-hidden="true" />
									{prCount} PR{prCount > 1 ? "s" : ""}
								</span>
							)}
						</p>
					)}
				</div>
				{data.session_id && (
					<Link href={`/workspace/${data.session_id}?runId=${data.id}`} className="shrink-0 mt-0.5">
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
// Blocked Group Item
// ============================================

function BlockedGroupItem({ data }: { data: BlockedGroup }) {
	const { data: authSession } = useSession();
	const { data: orgData } = useOrgMembersAndInvitations(
		authSession?.session?.activeOrganizationId ?? "",
	);
	const currentUserRole = orgData?.currentUserRole as OrgRole | undefined;
	const isAdmin = !!currentUserRole && hasRoleOrHigher(currentUserRole, "admin");

	return (
		<div className="rounded-xl border border-border bg-card p-3">
			<div className="flex items-start gap-3">
				<AlertOctagon className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium text-foreground">
						{data.count} session{data.count !== 1 ? "s" : ""} blocked
					</p>
					<p className="text-xs text-muted-foreground mt-0.5">{data.reason}</p>
				</div>
			</div>

			{data.previewSessions.length > 0 && (
				<div className="mt-3 ml-7 space-y-2">
					{data.previewSessions.map((session) => (
						<div key={session.id} className="flex items-center justify-between text-xs gap-2">
							<span className="text-foreground truncate">
								{session.title || session.promptSnippet || "Untitled session"}
							</span>
							<Link
								href={`/workspace/${session.id}`}
								className="text-muted-foreground hover:text-foreground shrink-0"
							>
								<ExternalLink className="h-3 w-3" />
							</Link>
						</div>
					))}
				</div>
			)}

			<div className="mt-3 ml-7">
				{isAdmin ? (
					<Button size="sm" variant="default" className="h-7 text-xs px-2.5" asChild>
						<Link href="/settings/billing">Update Billing</Link>
					</Button>
				) : (
					<p className="text-xs text-muted-foreground">
						Contact your organization administrator to resolve this billing issue.
					</p>
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
