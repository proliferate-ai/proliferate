"use client";

import {
	ActionInvocationCard,
	type GrantConfig,
} from "@/components/actions/action-invocation-card";
import { useWsToken } from "@/components/coding-session/runtime/use-ws-token";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/loading-dots";
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

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="h-full overflow-y-auto">
			<div className="max-w-4xl mx-auto px-6 py-8">
				{/* Header */}
				<div className="flex items-center justify-between mb-6">
					<div className="flex items-center gap-3">
						<h1 className="text-xl font-semibold">Actions</h1>
						{statusFilter === "pending" && total > 0 && <Badge variant="secondary">{total}</Badge>}
					</div>
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
				</div>

				{/* Content */}
				{invocations.length > 0 ? (
					<div className="border rounded-lg divide-y">
						{invocations.map((inv) => (
							<ActionInvocationCard
								key={inv.id}
								invocation={inv}
								showSession
								canApprove={canApprove && inv.status === "pending"}
								onApprove={() => handleApprove(inv.sessionId, inv.id)}
								onApproveWithGrant={(config) =>
									handleApproveWithGrant(inv.sessionId, inv.id, config)
								}
								onDeny={() => handleDeny(inv.sessionId, inv.id)}
								onSessionClick={() => router.push(`/dashboard/sessions/${inv.sessionId}`)}
							/>
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
			</div>
		</div>
	);
}
