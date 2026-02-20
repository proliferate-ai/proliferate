"use client";

import { orpc } from "@/lib/orpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// ============================================
// Integrations List Hook
// ============================================

export function useIntegrations() {
	return useQuery({
		...orpc.integrations.list.queryOptions({ input: undefined }),
		select: (data) => ({
			github: data.github,
			sentry: data.sentry,
			linear: data.linear,
			integrations: data.integrations,
			byProvider: data.byProvider,
		}),
	});
}

// ============================================
// Integration Mutation Hooks
// ============================================

export function useUpdateIntegration() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
		},
	});
}

export function useDisconnectIntegration() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.integrations.disconnect.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.integrations.githubStatus.key() });
			queryClient.invalidateQueries({ queryKey: orpc.integrations.sentryStatus.key() });
			queryClient.invalidateQueries({ queryKey: orpc.integrations.linearStatus.key() });
			queryClient.invalidateQueries({ queryKey: orpc.integrations.slackStatus.key() });
		},
	});

	const mutateAsync = async (integrationId: string) => {
		const result = await mutation.mutateAsync({ integrationId });
		return result;
	};

	return {
		...mutation,
		mutateAsync,
		mutate: (integrationId: string) => {
			mutation.mutate({ integrationId });
		},
	};
}

export function useIntegrationCallback() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.callback.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
		},
	});
}

// ============================================
// GitHub Hooks
// ============================================

export function useGitHubStatus() {
	return useQuery({
		...orpc.integrations.githubStatus.queryOptions({ input: undefined }),
	});
}

export function useGitHubSession() {
	return useMutation(orpc.integrations.githubSession.mutationOptions());
}

// ============================================
// Sentry Hooks
// ============================================

export function useSentryStatus() {
	return useQuery({
		...orpc.integrations.sentryStatus.queryOptions({ input: undefined }),
	});
}

export function useSentrySession() {
	return useMutation(orpc.integrations.sentrySession.mutationOptions());
}

export function useSentryMetadata(connectionId: string, projectSlug?: string) {
	return useQuery({
		...orpc.integrations.sentryMetadata.queryOptions({
			input: { connectionId, projectSlug },
		}),
		enabled: !!connectionId,
	});
}

// ============================================
// Linear Hooks
// ============================================

export function useLinearStatus() {
	return useQuery({
		...orpc.integrations.linearStatus.queryOptions({ input: undefined }),
	});
}

export function useLinearSession() {
	return useMutation(orpc.integrations.linearSession.mutationOptions());
}

export function useLinearMetadata(connectionId: string, teamId?: string) {
	return useQuery({
		...orpc.integrations.linearMetadata.queryOptions({
			input: { connectionId, teamId },
		}),
		enabled: !!connectionId,
	});
}

// ============================================
// Slack Hooks
// ============================================

export function useSlackStatus() {
	return useQuery({
		...orpc.integrations.slackStatus.queryOptions({ input: undefined }),
	});
}

export function useSlackInstallations() {
	return useQuery({
		...orpc.integrations.slackInstallations.queryOptions({ input: undefined }),
		select: (data) => data.installations,
	});
}

export function useSlackConnect() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.slackConnect.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.slackStatus.key() });
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
		},
	});
}

export function useSlackMembers(installationId: string | null) {
	return useQuery({
		...orpc.integrations.slackMembers.queryOptions({
			input: { installationId: installationId ?? "" },
		}),
		enabled: !!installationId,
		staleTime: 5 * 60 * 1000,
	});
}

export function useSlackChannels(installationId: string | null) {
	return useQuery({
		...orpc.integrations.slackChannels.queryOptions({
			input: { installationId: installationId ?? "" },
		}),
		enabled: !!installationId,
		staleTime: 5 * 60 * 1000,
	});
}

export function useSlackDisconnect() {
	const queryClient = useQueryClient();

	return useMutation({
		...orpc.integrations.slackDisconnect.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.integrations.slackStatus.key() });
			queryClient.invalidateQueries({ queryKey: orpc.integrations.list.key() });
		},
	});
}
