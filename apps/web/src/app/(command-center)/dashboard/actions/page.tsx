"use client";

import {
	ActionInvocationCard,
	type GrantConfig,
} from "@/components/actions/action-invocation-card";
import { useWsToken } from "@/components/coding-session/runtime/use-ws-token";
import { PageShell } from "@/components/dashboard/page-shell";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useApproveAction, useDenyAction, useOrgActions } from "@/hooks/use-actions";
import { useOrgMembersAndInvitations } from "@/hooks/use-orgs";
import { useSession } from "@/lib/auth-client";
import { hasRoleOrHigher } from "@/lib/roles";
import { ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const PAGE_SIZE = 20;

export default function ActionsPage() {
	const { data: authSession } = useSession();
	const { token } = useWsToken();
	const router = useRouter();
	const [statusFilter, setStatusFilter] = useState("pending");
	const [page, setPage] = useState(0);

	const { data, isLoading } = useOrgActions({
		status: statusFilter === "all" ? undefined : statusFilter,
		limit: PAGE_SIZE,
		offset: page * PAGE_SIZE,
	});

	const approveAction = useApproveAction();
	const denyAction = useDenyAction();

	// Role check
	const { data: orgData } = useOrgMembersAndInvitations(
		authSession?.session?.activeOrganizationId ?? "",
	);
	const currentUserRole = orgData?.currentUserRole;
	const canApprove = !!currentUserRole && hasRoleOrHigher(currentUserRole, "admin");

	const handleApprove = async (sessionId: string, invocationId: string) => {
		if (!token) return;
		try {
			await approveAction.mutateAsync({
				sessionId,
				invocationId,
				token,
			});
			toast.success("Action approved");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to approve");
		}
	};

	const handleApproveWithGrant = async (
		sessionId: string,
		invocationId: string,
		config: GrantConfig,
	) => {
		if (!token) return;
		try {
			await approveAction.mutateAsync({
				sessionId,
				invocationId,
				token,
				mode: "grant",
				grant: { scope: config.scope, maxCalls: config.maxCalls },
			});
			toast.success("Action approved with grant created");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to approve");
		}
	};

	const handleDeny = async (sessionId: string, invocationId: string) => {
		if (!token) return;
		try {
			await denyAction.mutateAsync({
				sessionId,
				invocationId,
				token,
			});
			toast.success("Action denied");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to deny");
		}
	};

	const invocations = data?.invocations ?? [];
	const total = data?.total ?? 0;
	const totalPages = Math.ceil(total / PAGE_SIZE);

	const filterSelect = (
		<Select
			value={statusFilter}
			onValueChange={(v) => {
				setStatusFilter(v);
				setPage(0);
			}}
		>
			<SelectTrigger className="w-36 h-8">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="pending">Pending</SelectItem>
				<SelectItem value="completed">Completed</SelectItem>
				<SelectItem value="denied">Denied</SelectItem>
				<SelectItem value="failed">Failed</SelectItem>
				<SelectItem value="expired">Expired</SelectItem>
				<SelectItem value="all">All</SelectItem>
			</SelectContent>
		</Select>
	);

	if (isLoading) {
		return (
			<PageShell title="Actions" actions={filterSelect}>
				<div className="flex items-center justify-center py-20">
					<div className="space-y-3 w-full">
						{[1, 2, 3].map((i) => (
							<div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
						))}
					</div>
				</div>
			</PageShell>
		);
	}

	return (
		<PageShell title="Actions" actions={filterSelect}>
			{invocations.length > 0 ? (
				<div className="rounded-xl border border-border overflow-hidden">
					{/* Column headers */}
					<div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
						<div className="flex-1 min-w-0">Action</div>
						<div className="hidden sm:block w-24 shrink-0">Status</div>
						<div className="hidden md:block w-40 shrink-0">Session</div>
						<div className="hidden sm:block w-16 shrink-0 text-right">Time</div>
						<div className="w-36 shrink-0" />
					</div>
					{invocations.map((inv) => (
						<div key={inv.id} className="border-b border-border/50 last:border-0">
							<ActionInvocationCard
								invocation={inv}
								showSession
								canApprove={canApprove && inv.status === "pending"}
								onApprove={() => handleApprove(inv.sessionId, inv.id)}
								onApproveWithGrant={(config) =>
									handleApproveWithGrant(inv.sessionId, inv.id, config)
								}
								onDeny={() => handleDeny(inv.sessionId, inv.id)}
								onSessionClick={() => router.push(`/workspace/${inv.sessionId}`)}
							/>
						</div>
					))}
				</div>
			) : (
				<div className="flex flex-col items-center justify-center py-20 text-center">
					<Zap className="h-12 w-12 text-muted-foreground/30 mb-4" />
					<p className="text-muted-foreground">
						No {statusFilter !== "all" ? statusFilter : ""} actions
					</p>
					<p className="text-sm text-muted-foreground/70 mt-1">
						Action invocations from your sessions will appear here.
					</p>
				</div>
			)}

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-between mt-4 pt-4 border-t">
					<span className="text-sm text-muted-foreground">{total} total</span>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={page === 0}
							onClick={() => setPage((p) => p - 1)}
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<span className="text-sm">
							{page + 1} / {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={page >= totalPages - 1}
							onClick={() => setPage((p) => p + 1)}
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</div>
			)}
		</PageShell>
	);
}
