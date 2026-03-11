"use client";

import { useRepo } from "@/hooks/org/use-repos";
import { useCreateConfiguration } from "@/hooks/sessions/use-configurations";
import { useCreateSession as useCreateSessionMutation } from "@/hooks/sessions/use-sessions";
import { useCallback, useEffect, useRef } from "react";

interface UseCreateSessionFromRepoOptions {
	repoId: string | null;
	sessionType: "setup" | "coding";
	modelId: string | undefined;
}

interface UseCreateSessionFromRepoResult {
	isPending: boolean;
	isSuccess: boolean;
	isError: boolean;
	errorMessage: string | undefined;
	stage: "preparing" | "provisioning";
	/** True when repo data is loaded and creation can proceed. */
	isReady: boolean;
	retry: () => void;
	/** Kicks off creation; returns sessionId on success, undefined on failure. */
	create: () => Promise<string | undefined>;
}

export function useCreateSessionFromRepo({
	repoId,
	sessionType,
	modelId,
}: UseCreateSessionFromRepoOptions): UseCreateSessionFromRepoResult {
	const creationStartedRef = useRef(false);

	const { data: repo, isLoading: isRepoLoading } = useRepo(repoId || "");
	const createConfiguration = useCreateConfiguration();
	const createSession = useCreateSessionMutation();

	// For coding sessions, wait for repo data so we can check for ready configurations
	const isReady = sessionType === "setup" || !isRepoLoading;

	const isPending = createConfiguration.isPending || createSession.isPending;
	const isSuccess = createSession.isSuccess;
	const isError = createConfiguration.isError || createSession.isError;
	const errorMessage =
		(createConfiguration.error ?? createSession.error)?.message ??
		(isError ? "Failed to create session" : undefined);

	const stage: "preparing" | "provisioning" = createSession.isPending
		? "provisioning"
		: "preparing";

	const retry = useCallback(() => {
		creationStartedRef.current = false;
		createConfiguration.reset();
		createSession.reset();
	}, [createConfiguration, createSession]);

	// Reset guard on error so retry works
	useEffect(() => {
		if (isError) {
			creationStartedRef.current = false;
		}
	}, [isError]);

	const create = useCallback(async (): Promise<string | undefined> => {
		if (!repoId || creationStartedRef.current || isPending || isSuccess) {
			return undefined;
		}

		creationStartedRef.current = true;
		try {
			// Reuse existing ready configuration if available (has snapshot + service commands)
			let configurationId: string;
			if (
				sessionType === "coding" &&
				repo?.configurationId &&
				repo.configurationStatus === "ready"
			) {
				configurationId = repo.configurationId;
			} else {
				const configurationResult = await createConfiguration.mutateAsync({
					repoIds: [repoId],
				});
				configurationId = configurationResult.configurationId;
			}

			const sessionResult = await createSession.mutateAsync({
				configurationId,
				sessionType,
				modelId,
			});

			return sessionResult.sessionId;
		} catch {
			creationStartedRef.current = false;
			return undefined;
		}
	}, [
		repoId,
		sessionType,
		modelId,
		isPending,
		isSuccess,
		repo,
		createConfiguration,
		createSession,
	]);

	return { isPending, isSuccess, isError, errorMessage, stage, isReady, retry, create };
}
