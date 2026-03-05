"use client";

import { orpc } from "@/lib/infra/orpc";
import type { FinalizeSetupInput } from "@proliferate/shared/contracts/repos";
import type { CreateSessionInput } from "@proliferate/shared/contracts/sessions";
import type { Session } from "@proliferate/shared/contracts/sessions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

export function useSessions(params?: {
	status?: string;
	kinds?: Array<"manager" | "task" | "setup">;
	repoId?: string;
	limit?: number;
	excludeSetup?: boolean;
	excludeCli?: boolean;
	excludeAutomation?: boolean;
	createdBy?: string;
	enabled?: boolean;
	refetchInterval?: number | false;
}) {
	const { enabled = true, refetchInterval, ...queryParams } = params ?? {};
	return useQuery({
		...orpc.sessions.list.queryOptions({
			input: queryParams,
		}),
		enabled,
		refetchInterval:
			refetchInterval ??
			((query) => {
				// Auto-refetch while any session title is being generated
				const sessions = query.state.data?.sessions;
				if (sessions?.some((s: Session) => s.titleStatus === "generating")) {
					return 3000;
				}
				return false;
			}),
		refetchIntervalInBackground: false,
		select: (data) => data.sessions,
	});
}

export function useSessionData(id: string) {
	return useQuery({
		...orpc.sessions.get.queryOptions({
			input: { id },
		}),
		enabled: !!id,
		select: (data) => data.session,
	});
}

export function usePrefetchSession() {
	const queryClient = useQueryClient();

	return useCallback(
		(sessionId: string) => {
			queryClient.prefetchQuery(orpc.sessions.get.queryOptions({ input: { id: sessionId } }));
		},
		[queryClient],
	);
}

export function useCreateSession() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.sessions.create.mutationOptions(),
		onSuccess: (result, variables) => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });

			// Seed the session cache so the detail page renders instantly.
			// This is partial — TanStack Query will background-refetch the full data.
			const partialSession: Session = {
				id: result.sessionId,
				repoId: null,
				organizationId: "",
				createdBy: null,
				sessionType: variables.sessionType ?? null,
				status: {
					sandboxState: "provisioning",
					agentState: "iterating",
					terminalState: null,
					reason: null,
					isTerminal: false,
					agentFinishedIterating: false,
					requiresHumanReview: false,
					updatedAt: new Date().toISOString(),
				},
				sandboxId: result.sandboxId ?? null,
				snapshotId: null,
				configurationId: variables.configurationId ?? null,
				configurationName: null,
				branchName: null,
				parentSessionId: null,
				title: null,
				titleStatus: variables.initialPrompt ? "generating" : null,
				startedAt: new Date().toISOString(),
				lastActivityAt: new Date().toISOString(),
				pausedAt: null,
				origin: "web",
				clientType: null,
				hasUnreadUpdate: false,
				repo: undefined,
			};

			queryClient.setQueryData(
				orpc.sessions.get.queryOptions({ input: { id: result.sessionId } }).queryKey,
				{ session: partialSession },
			);
		},
	});

	// Wrap mutateAsync to maintain the same API
	const mutateAsync = async (data: CreateSessionInput) => {
		const result = await mutation.mutateAsync(data);
		return result;
	};

	return {
		...mutation,
		mutateAsync,
	};
}

export function usePauseSession() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.sessions.pause.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
		},
	});

	// Wrap mutateAsync to accept session id directly
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

export function useSnapshotSession() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.sessions.snapshot.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
		},
	});

	// Wrap mutateAsync to accept session id directly
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

export function useRenameSession() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.sessions.rename.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
		},
	});

	const mutateAsync = async (id: string, title: string) => {
		const result = await mutation.mutateAsync({ id, title });
		return result.session;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (id: string, title: string) => {
			mutation.mutate({ id, title });
		},
	};
}

export function useDeleteSession() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.sessions.delete.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
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

export function useSessionStatus(id: string, enabled = true) {
	return useQuery({
		...orpc.sessions.status.queryOptions({ input: { id } }),
		enabled: enabled && !!id,
	});
}

export function useSessionNotificationSubscription(sessionId: string, enabled = true) {
	return useQuery({
		...orpc.sessions.getNotificationSubscription.queryOptions({
			input: { sessionId },
		}),
		enabled: enabled && !!sessionId,
		select: (data) => data.subscribed,
	});
}

export function useSubscribeNotifications() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.sessions.subscribeNotifications.mutationOptions(),
		onSuccess: (_data, input) => {
			queryClient.setQueryData(
				orpc.sessions.getNotificationSubscription.queryOptions({
					input: { sessionId: input.sessionId },
				}).queryKey,
				{ subscribed: true },
			);
		},
	});
}

export function useUnsubscribeNotifications() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.sessions.unsubscribeNotifications.mutationOptions(),
		onSuccess: (_data, input) => {
			queryClient.setQueryData(
				orpc.sessions.getNotificationSubscription.queryOptions({
					input: { sessionId: input.sessionId },
				}).queryKey,
				{ subscribed: false },
			);
		},
	});
}

export function useMarkSessionViewed(sessionId: string | undefined) {
	const queryClient = useQueryClient();
	const markedRef = useRef<string | null>(null);

	const mutation = useMutation({
		...orpc.sessions.markViewed.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
		},
	});

	useEffect(() => {
		if (!sessionId || markedRef.current === sessionId) return;
		markedRef.current = sessionId;
		mutation.mutate({ id: sessionId });
	}, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useFinalizeSetup() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.configurations.finalizeSetup.mutationOptions(),
		onSuccess: () => {
			// Invalidate all relevant queries
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.configurations.list.key() });
		},
	});

	// Wrap mutateAsync to accept repoId (optional) + session fields
	const mutateAsync = async ({
		repoId,
		...body
	}: {
		repoId?: string;
	} & FinalizeSetupInput) => {
		const result = await mutation.mutateAsync({
			id: repoId,
			...body,
		});
		return result;
	};

	return {
		...mutation,
		mutateAsync,
	};
}
