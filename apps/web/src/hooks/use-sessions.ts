"use client";

import { orpc } from "@/lib/orpc";
import type { CreateSessionInput, FinalizeSetupInput } from "@proliferate/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useSessions(params?: { status?: string; repoId?: string }) {
	return useQuery({
		...orpc.sessions.list.queryOptions({
			input: params ?? {},
		}),
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

export function useCreateSession() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.sessions.create.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
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

export function useFinalizeSetup() {
	const queryClient = useQueryClient();

	const mutation = useMutation({
		...orpc.repos.finalizeSetup.mutationOptions(),
		onSuccess: () => {
			// Invalidate all relevant queries
			queryClient.invalidateQueries({ queryKey: orpc.sessions.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.list.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listPrebuilds.key() });
			queryClient.invalidateQueries({ queryKey: orpc.repos.listSnapshots.key() });
		},
	});

	// Wrap mutateAsync to accept the old API format
	const mutateAsync = async ({
		repoId,
		...body
	}: {
		repoId: string;
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
