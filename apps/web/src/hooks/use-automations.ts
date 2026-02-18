"use client";

import { orpc } from "@/lib/orpc";
import type {
	AutomationRunStatus,
	CreateAutomationInput,
	CreateAutomationScheduleInput,
	CreateAutomationTriggerInput,
	UpdateAutomationInput,
} from "@proliferate/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ============================================
// Automation Hooks
// ============================================

export function useAutomations() {
	return useQuery({
		...orpc.automations.list.queryOptions({ input: undefined }),
		select: (data) => data.automations,
	});
}

export function useAutomation(id: string) {
	return useQuery({
		...orpc.automations.get.queryOptions({ input: { id } }),
		enabled: !!id,
		select: (data) => data.automation,
	});
}

export function useCreateAutomation() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.automations.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.automations.list.key() });
		},
	});

	const mutateAsync = async (data: CreateAutomationInput) => {
		const result = await mutation.mutateAsync(data);
		return result.automation;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: CreateAutomationInput) => {
			mutation.mutate(data);
		},
	};
}

export function useUpdateAutomation(id: string) {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.automations.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.automations.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.automations.get.key({ input: { id } }) });
		},
	});

	const mutateAsync = async (data: UpdateAutomationInput) => {
		const result = await mutation.mutateAsync({ id, ...data });
		return result.automation;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: UpdateAutomationInput) => {
			mutation.mutate({ id, ...data });
		},
	};
}

export function useDeleteAutomation() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.automations.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.automations.list.key() });
		},
	});

	const mutateAsync = async (id: string) => {
		const result = await mutation.mutateAsync({ id });
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string) => {
			mutation.mutate({ id });
		},
	};
}

// ============================================
// Manual Run
// ============================================

export function useTriggerManualRun(automationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.triggerManualRun.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listRuns.queryOptions({ input: { id: automationId } }).queryKey,
			});
		},
	});
}

// ============================================
// Integration Actions
// ============================================

export function useAutomationIntegrationActions(automationId: string) {
	return useQuery({
		...orpc.automations.getIntegrationActions.queryOptions({
			input: { id: automationId },
		}),
		enabled: !!automationId,
		select: (data) => data.integrations,
	});
}

// ============================================
// Event Hooks
// ============================================

export function useAutomationEvents(
	automationId: string,
	options?: {
		status?: "queued" | "processing" | "completed" | "failed" | "skipped" | "filtered";
		limit?: number;
		offset?: number;
	},
) {
	return useQuery({
		...orpc.automations.listEvents.queryOptions({
			input: { id: automationId, ...options },
		}),
		enabled: !!automationId,
		select: (data) => ({
			events: data.events,
			total: data.total,
			limit: data.limit,
			offset: data.offset,
		}),
	});
}

export function useAutomationEvent(automationId: string, eventId: string) {
	return useQuery({
		...orpc.automations.getEvent.queryOptions({
			input: { id: automationId, eventId },
		}),
		enabled: !!automationId && !!eventId,
		select: (data) => ({
			event: data.event,
			automation: data.automation,
		}),
	});
}

// ============================================
// Run Hooks
// ============================================

export function useAutomationRuns(
	automationId: string,
	options?: {
		status?: AutomationRunStatus;
		limit?: number;
		offset?: number;
	},
) {
	return useQuery({
		...orpc.automations.listRuns.queryOptions({
			input: { id: automationId, ...options },
		}),
		enabled: !!automationId,
	});
}

export function useAssignRun(automationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.assignRun.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listRuns.key({ input: { id: automationId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.myClaimedRuns.key(),
			});
		},
	});
}

export function useUnassignRun(automationId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.unassignRun.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listRuns.key({ input: { id: automationId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.myClaimedRuns.key(),
			});
		},
	});
}

export function useMyClaimedRuns() {
	return useQuery({
		...orpc.automations.myClaimedRuns.queryOptions({ input: undefined }),
		select: (data) => data.runs,
	});
}

export function useOrgPendingRuns(options?: { limit?: number; maxAgeDays?: number }) {
	return useQuery({
		...orpc.automations.listOrgPendingRuns.queryOptions({
			input: options ?? {},
		}),
		refetchInterval: 30_000,
		select: (data) => data.runs,
	});
}

export function useRun(runId: string | undefined) {
	return useQuery({
		...orpc.automations.getRun.queryOptions({
			input: { runId: runId! },
		}),
		enabled: !!runId,
		refetchInterval: 30_000,
		select: (data) => data.run,
	});
}

export function useRunEvents(runId: string | undefined) {
	return useQuery({
		...orpc.automations.listRunEvents.queryOptions({
			input: { runId: runId! },
		}),
		enabled: !!runId,
		select: (data) => data.events,
	});
}

export function useResolveRun() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.automations.resolveRun.mutationOptions(),
		onSuccess: (_data, variables) => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.getRun.key({ input: { runId: variables.runId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listOrgPendingRuns.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.myClaimedRuns.key(),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listRuns.key({ input: { id: variables.id } }),
			});
		},
	});
}

export function useOrgRuns(options?: {
	status?: AutomationRunStatus;
	limit?: number;
	offset?: number;
}) {
	return useQuery({
		...orpc.automations.listOrgRuns.queryOptions({
			input: options ?? {},
		}),
		refetchInterval: 30_000,
	});
}

// ============================================
// Trigger Hooks
// ============================================

export function useAutomationTriggers(automationId: string) {
	return useQuery({
		...orpc.automations.listTriggers.queryOptions({
			input: { id: automationId },
		}),
		enabled: !!automationId,
		select: (data) => data.triggers,
	});
}

export function useCreateAutomationTrigger(automationId: string) {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.automations.createTrigger.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listTriggers.key({ input: { id: automationId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.get.key({ input: { id: automationId } }),
			});
			queryClient.invalidateQueries({ queryKey: orpc.automations.list.key() });
			// Also invalidate connections since trigger creation auto-adds the connection
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listConnections.key({ input: { id: automationId } }),
			});
		},
	});

	const mutateAsync = async (data: CreateAutomationTriggerInput) => {
		const result = await mutation.mutateAsync({ id: automationId, ...data });
		return result.trigger;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: CreateAutomationTriggerInput) => {
			mutation.mutate({ id: automationId, ...data });
		},
	};
}

// ============================================
// Schedule Hooks
// ============================================

export function useAutomationSchedules(automationId: string) {
	return useQuery({
		...orpc.automations.listSchedules.queryOptions({
			input: { id: automationId },
		}),
		enabled: !!automationId,
		select: (data) => data.schedules,
	});
}

export function useCreateAutomationSchedule(automationId: string) {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.automations.createSchedule.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listSchedules.key({ input: { id: automationId } }),
			});
			queryClient.invalidateQueries({
				queryKey: orpc.automations.get.key({ input: { id: automationId } }),
			});
			queryClient.invalidateQueries({ queryKey: orpc.automations.list.key() });
		},
	});

	const mutateAsync = async (data: CreateAutomationScheduleInput) => {
		const result = await mutation.mutateAsync({ id: automationId, ...data });
		return result.schedule;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (data: CreateAutomationScheduleInput) => {
			mutation.mutate({ id: automationId, ...data });
		},
	};
}

// ============================================
// Connection Hooks
// ============================================

export function useAutomationConnections(automationId: string) {
	return useQuery({
		...orpc.automations.listConnections.queryOptions({
			input: { id: automationId },
		}),
		enabled: !!automationId,
		select: (data) => data.connections,
	});
}

export function useAddAutomationConnection(automationId: string) {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.automations.addConnection.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listConnections.key({ input: { id: automationId } }),
			});
		},
	});

	const mutateAsync = async (integrationId: string) => {
		const result = await mutation.mutateAsync({ id: automationId, integrationId });
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (integrationId: string) => {
			mutation.mutate({ id: automationId, integrationId });
		},
	};
}

export function useRemoveAutomationConnection(automationId: string) {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.automations.removeConnection.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.automations.listConnections.key({ input: { id: automationId } }),
			});
		},
	});

	const mutateAsync = async (integrationId: string) => {
		const result = await mutation.mutateAsync({ id: automationId, integrationId });
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (integrationId: string) => {
			mutation.mutate({ id: automationId, integrationId });
		},
	};
}
