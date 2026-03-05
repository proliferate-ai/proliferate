"use client";

import { useCreateBaseline } from "@/hooks/sessions/use-baselines";
import { useCreateConfiguration } from "@/hooks/sessions/use-configurations";
import { useCreateSession } from "@/hooks/sessions/use-sessions";
import { orpc } from "@/lib/infra/orpc";
import { getSetupInitialPrompt } from "@proliferate/shared/prompts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseSetupSessionOptions {
	repoId: string;
	modelId: string | undefined;
}

interface UseSetupSessionResult {
	/** The session id once creation succeeds. */
	sessionId: string | null;
	/** Whether the invariant check is still loading. */
	isLoading: boolean;
	/** An existing non-terminal setup session was found for this repo. */
	existingSessionId: string | null;
	/** Whether any creation step failed. */
	isError: boolean;
	/** Human-readable error message. */
	errorMessage: string;
	/** Reset all mutations so the user can retry. */
	retry: () => void;
}

export function useSetupSession({
	repoId,
	modelId,
}: UseSetupSessionOptions): UseSetupSessionResult {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const creationStartedRef = useRef(false);

	// Check setup session invariant: at most one non-terminal setup session per repo
	const {
		data: invariantData,
		isLoading: invariantLoading,
		isError: invariantError,
	} = useQuery({
		...orpc.baselines.checkSetupInvariant.queryOptions({ input: { repoId } }),
		enabled: !!repoId && !sessionId,
	});

	const existingSessionId = invariantData?.existingSessionId ?? null;

	const createBaseline = useCreateBaseline();
	const createConfiguration = useCreateConfiguration();
	const createSession = useCreateSession();

	const isError = createBaseline.isError || createConfiguration.isError || createSession.isError;
	const errorMessage =
		createBaseline.error?.message ||
		createConfiguration.error?.message ||
		createSession.error?.message ||
		"Failed to create session";

	const retry = useCallback(() => {
		creationStartedRef.current = false;
		createBaseline.reset();
		createConfiguration.reset();
		createSession.reset();
	}, [createBaseline, createConfiguration, createSession]);

	// Orchestrate creation: baseline -> configuration -> session
	useEffect(() => {
		if (!repoId || sessionId) return;
		if (creationStartedRef.current) return;
		if (invariantLoading || invariantError) return;
		if (existingSessionId) return;

		creationStartedRef.current = true;

		const create = async () => {
			try {
				await createBaseline.mutateAsync({ repoId });

				const configurationResult = await createConfiguration.mutateAsync({
					repoIds: [repoId],
				});

				const sessionResult = await createSession.mutateAsync({
					configurationId: configurationResult.configurationId,
					sessionType: "setup",
					modelId,
					initialPrompt: getSetupInitialPrompt(),
				});

				setSessionId(sessionResult.sessionId);
			} catch {
				creationStartedRef.current = false;
			}
		};

		create();
	}, [
		repoId,
		sessionId,
		modelId,
		invariantLoading,
		invariantError,
		existingSessionId,
		createBaseline,
		createConfiguration,
		createSession,
	]);

	return {
		sessionId,
		isLoading: invariantLoading,
		existingSessionId,
		isError,
		errorMessage,
		retry,
	};
}
