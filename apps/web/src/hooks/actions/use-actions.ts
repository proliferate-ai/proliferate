"use client";

import { GATEWAY_URL } from "@/lib/infra/gateway";
import { orpc } from "@/lib/infra/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ============================================
// Types
// ============================================

export interface ActionInvocation {
	id: string;
	sessionId: string;
	organizationId: string;
	integrationId: string | null;
	integration: string;
	action: string;
	riskLevel: string;
	params: unknown;
	status: string;
	result: unknown;
	error: string | null;
	durationMs: number | null;
	approvedBy: string | null;
	approvedAt: string | null;
	completedAt: string | null;
	expiresAt: string | null;
	createdAt: string | null;
	sessionTitle?: string | null;
}

export interface AvailableSessionAction {
	name: string;
	description: string;
	riskLevel: "read" | "write" | "danger";
}

export interface AvailableSessionIntegration {
	integrationId: string;
	integration: string;
	displayName: string;
	actions: AvailableSessionAction[];
}

// ============================================
// Org-Level Queries (oRPC, for dashboard inbox)
// ============================================

export function useOrgActions(options?: {
	status?: string;
	limit?: number;
	offset?: number;
}) {
	return useQuery({
		...orpc.actions.list.queryOptions({ input: options ?? {} }),
		refetchInterval: 30_000,
	});
}

// ============================================
// Session-Level Query (Gateway HTTP, for timeline panel)
// ============================================

export function useSessionActions(sessionId: string, token: string | null) {
	return useQuery({
		queryKey: ["session-actions", sessionId],
		queryFn: async (): Promise<ActionInvocation[]> => {
			if (!GATEWAY_URL || !token) throw new Error("Not ready");
			const res = await fetch(`${GATEWAY_URL}/proliferate/${sessionId}/actions/invocations`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			return data.invocations;
		},
		enabled: !!token && !!GATEWAY_URL && !!sessionId,
		staleTime: 10_000,
	});
}

export function useSessionAvailableActions(sessionId: string, token: string | null) {
	return useQuery({
		queryKey: ["session-available-actions", sessionId],
		queryFn: async (): Promise<AvailableSessionIntegration[]> => {
			if (!GATEWAY_URL || !token) {
				throw new Error("Not ready");
			}
			const response = await fetch(`${GATEWAY_URL}/proliferate/${sessionId}/actions/available`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const payload = (await response.json()) as {
				integrations?: AvailableSessionIntegration[];
			};
			return payload.integrations ?? [];
		},
		enabled: !!token && !!GATEWAY_URL && !!sessionId,
		staleTime: 30_000,
	});
}

// ============================================
// Org-Level Available Actions (oRPC, for create dialog)
// ============================================

export function useOrgAvailableActions() {
	return useQuery({
		...orpc.automations.getOrgAvailableActions.queryOptions({ input: {} }),
		staleTime: 60_000,
	});
}

// ============================================
// Approve/Deny via Gateway HTTP
// ============================================

export function useApproveAction() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			sessionId,
			invocationId,
			token,
			mode,
			grant,
		}: {
			sessionId: string;
			invocationId: string;
			token: string;
			mode?: "once" | "grant";
			grant?: { scope?: "session" | "org"; maxCalls?: number | null };
		}) => {
			const res = await fetch(
				`${GATEWAY_URL}/proliferate/${sessionId}/actions/invocations/${invocationId}/approve`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					...(mode ? { body: JSON.stringify({ mode, grant }) } : {}),
				},
			);
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				throw new Error(data.error || `HTTP ${res.status}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.actions.list.key(),
			});
			queryClient.invalidateQueries({ queryKey: ["session-actions"] });
		},
	});
}

export function useDenyAction() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			sessionId,
			invocationId,
			token,
		}: {
			sessionId: string;
			invocationId: string;
			token: string;
		}) => {
			const res = await fetch(
				`${GATEWAY_URL}/proliferate/${sessionId}/actions/invocations/${invocationId}/deny`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
				},
			);
			if (!res.ok) {
				const data = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				throw new Error(data.error || `HTTP ${res.status}`);
			}
			return res.json();
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.actions.list.key(),
			});
			queryClient.invalidateQueries({ queryKey: ["session-actions"] });
		},
	});
}
