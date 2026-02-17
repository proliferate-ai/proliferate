"use client";

import {
	ActionInvocationCard,
	type GrantConfig,
} from "@/components/actions/action-invocation-card";
import { useApproveAction, useDenyAction, useSessionActions } from "@/hooks/use-actions";
import { useOrgMembersAndInvitations } from "@/hooks/use-orgs";
import { useSession } from "@/lib/auth-client";
import { hasRoleOrHigher } from "@/lib/roles";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useWsToken } from "./runtime/use-ws-token";

export interface ActionsContentProps {
	sessionId: string;
	activityTick: number;
}

export function ActionsContent({ sessionId, activityTick }: ActionsContentProps) {
	const { token } = useWsToken();
	const queryClient = useQueryClient();
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const { data: invocations, isLoading, error } = useSessionActions(sessionId, token);
	const approveAction = useApproveAction();
	const denyAction = useDenyAction();

	// Check if user can approve/deny
	const { data: authSession } = useSession();
	const { data: orgData } = useOrgMembersAndInvitations(
		authSession?.session?.activeOrganizationId ?? "",
	);
	const currentUserRole = orgData?.currentUserRole;
	const canApprove = !!currentUserRole && hasRoleOrHigher(currentUserRole, "admin");

	// Debounced invalidation on activity tick
	useEffect(() => {
		if (activityTick === 0) return;
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			queryClient.invalidateQueries({
				queryKey: ["session-actions", sessionId],
			});
		}, 500);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [activityTick, queryClient, sessionId]);

	const handleApprove = async (invocationId: string) => {
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

	const handleApproveWithGrant = async (invocationId: string, config: GrantConfig) => {
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

	const handleDeny = async (invocationId: string) => {
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

	return (
		<>
			{/* Content */}
			<div className="flex-1 min-h-0 overflow-auto">
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
					</div>
				) : error ? (
					<div className="px-3 py-4 text-sm text-destructive">Failed to load actions</div>
				) : !invocations || invocations.length === 0 ? (
					<div className="px-3 py-8 text-center text-sm text-muted-foreground">No actions yet</div>
				) : (
					<div className="divide-y">
						{invocations.map((inv) => (
							<ActionInvocationCard
								key={inv.id}
								invocation={inv}
								canApprove={canApprove && inv.status === "pending"}
								onApprove={() => handleApprove(inv.id)}
								onApproveWithGrant={(config) => handleApproveWithGrant(inv.id, config)}
								onDeny={() => handleDeny(inv.id)}
							/>
						))}
					</div>
				)}
			</div>

			{/* Footer */}
			{invocations && invocations.length > 0 && (
				<div className="px-3 py-1.5 border-t text-xs text-muted-foreground shrink-0">
					{invocations.filter((i) => i.status === "pending").length} pending
				</div>
			)}
		</>
	);
}
