"use client";

import type {
	ChildSession,
	PendingDirective,
	WorkerRunWithEvents,
} from "@/hooks/automations/types";
import {
	useDeleteWorker,
	usePauseWorker,
	usePendingDirectives,
	useResumeWorker,
	useRunWorkerNow,
	useSendDirective,
	useUpdateWorker,
	useWorkerRuns,
	useWorkerSessions,
} from "@/hooks/automations/use-workers";
import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

export function useCoworkerActions(id: string) {
	const router = useRouter();

	const pauseWorker = usePauseWorker();
	const resumeWorker = useResumeWorker();
	const runNow = useRunWorkerNow();
	const sendDirective = useSendDirective(id);
	const updateWorker = useUpdateWorker(id);
	const deleteWorker = useDeleteWorker();

	const handleSendDirective = useCallback(
		async (content: string) => {
			try {
				await sendDirective.mutateAsync({ workerId: id, content });
				toast.success("Directive sent");
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Failed to send directive");
			}
		},
		[id, sendDirective],
	);

	const handlePause = useCallback(() => {
		pauseWorker.mutate(
			{ workerId: id },
			{
				onSuccess: () => toast.success("Coworker paused"),
				onError: (err) => toast.error(err.message || "Failed to pause"),
			},
		);
	}, [id, pauseWorker]);

	const handleResume = useCallback(() => {
		resumeWorker.mutate(
			{ workerId: id },
			{
				onSuccess: () => toast.success("Coworker resumed"),
				onError: (err) => toast.error(err.message || "Failed to resume"),
			},
		);
	}, [id, resumeWorker]);

	const handleRunNow = useCallback(() => {
		runNow.mutate(
			{ workerId: id },
			{
				onSuccess: () => toast.success("Wake event queued"),
				onError: (err) => toast.error(err.message || "Failed to run"),
			},
		);
	}, [id, runNow]);

	const handleDelete = useCallback(() => {
		deleteWorker.mutate(
			{ id },
			{
				onSuccess: () => {
					toast.success("Coworker deleted");
					router.push("/coworkers");
				},
				onError: (err) => toast.error(err.message || "Failed to delete"),
			},
		);
	}, [id, deleteWorker, router]);

	const handleRestart = useCallback(() => {
		resumeWorker.mutate(
			{ workerId: id },
			{
				onSuccess: () => toast.success("Manager restarted"),
				onError: (err) => toast.error(err.message || "Failed to restart"),
			},
		);
	}, [id, resumeWorker]);

	return {
		handleSendDirective,
		handlePause,
		handleResume,
		handleRunNow,
		handleDelete,
		handleRestart,
		updateWorker,
		sendDirective,
		pauseWorker,
		resumeWorker,
		runNow,
	};
}

export function useCoworkerDetailData(id: string, isWorkerActive: boolean) {
	const { data: runs = [], isLoading: isLoadingRuns } = useWorkerRuns(id, {
		limit: 10,
		pollingEnabled: isWorkerActive,
	});
	const { data: workerSessions = [], isLoading: isLoadingSessions } = useWorkerSessions(id, {
		pollingEnabled: isWorkerActive,
	});
	const { data: pendingDirectives = [] } = usePendingDirectives(id);

	const activeTaskCount = useMemo(
		() =>
			workerSessions.filter(
				(s) => s.status !== "completed" && s.status !== "failed" && s.status !== "cancelled",
			).length,
		[workerSessions],
	);

	const mappedRuns: WorkerRunWithEvents[] = useMemo(
		() =>
			runs.map((run) => ({
				id: run.id,
				workerId: run.workerId,
				status: run.status,
				summary: run.summary,
				wakeEventId: run.wakeEventId,
				createdAt: run.createdAt.toISOString(),
				startedAt: run.startedAt?.toISOString() ?? null,
				completedAt: run.completedAt?.toISOString() ?? null,
				events: run.events.map((e) => ({
					id: e.id,
					eventIndex: e.eventIndex,
					eventType: e.eventType,
					summaryText: e.summaryText,
					payloadJson: e.payloadJson,
					sessionId: e.sessionId,
					actionInvocationId: e.actionInvocationId,
					createdAt: e.createdAt.toISOString(),
				})),
				childSessions: [] as ChildSession[],
			})),
		[runs],
	);

	const mappedDirectives: PendingDirective[] = useMemo(
		() =>
			pendingDirectives.map((d) => ({
				id: d.id,
				messageType: d.messageType,
				payloadJson: d.payloadJson,
				queuedAt: d.queuedAt.toISOString(),
				senderUserId: d.senderUserId,
			})),
		[pendingDirectives],
	);

	return {
		runs,
		workerSessions,
		pendingDirectives,
		activeTaskCount,
		mappedRuns,
		mappedDirectives,
		isLoadingRuns,
		isLoadingSessions,
	};
}
