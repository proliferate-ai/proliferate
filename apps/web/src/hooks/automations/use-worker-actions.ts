"use client";

import {
	useDeleteWorker,
	usePauseWorker,
	useResumeWorker,
	useRunWorkerNow,
	useSendDirective,
	useUpdateWorker,
} from "@/hooks/automations/use-workers";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

export function useWorkerActions(workerId: string) {
	const router = useRouter();
	const pauseWorker = usePauseWorker();
	const resumeWorker = useResumeWorker();
	const runNow = useRunWorkerNow();
	const sendDirective = useSendDirective(workerId);
	const updateWorker = useUpdateWorker(workerId);
	const deleteWorker = useDeleteWorker();

	const handlePause = useCallback(() => {
		pauseWorker.mutate(
			{ workerId },
			{
				onSuccess: () => toast.success("Coworker paused"),
				onError: (err) => toast.error(err.message || "Failed to pause"),
			},
		);
	}, [workerId, pauseWorker]);

	const handleResume = useCallback(() => {
		resumeWorker.mutate(
			{ workerId },
			{
				onSuccess: () => toast.success("Coworker resumed"),
				onError: (err) => toast.error(err.message || "Failed to resume"),
			},
		);
	}, [workerId, resumeWorker]);

	const handleRunNow = useCallback(() => {
		runNow.mutate(
			{ workerId },
			{
				onSuccess: () => toast.success("Wake event queued"),
				onError: (err) => toast.error(err.message || "Failed to run"),
			},
		);
	}, [workerId, runNow]);

	const handleDelete = useCallback(() => {
		deleteWorker.mutate(
			{ id: workerId },
			{
				onSuccess: () => {
					toast.success("Coworker deleted");
					router.push("/coworkers");
				},
				onError: (err) => toast.error(err.message || "Failed to delete"),
			},
		);
	}, [workerId, deleteWorker, router]);

	const handleRestart = useCallback(() => {
		resumeWorker.mutate(
			{ workerId },
			{
				onSuccess: () => toast.success("Manager restarted"),
				onError: (err) => toast.error(err.message || "Failed to restart"),
			},
		);
	}, [workerId, resumeWorker]);

	const handleSendDirective = useCallback(
		async (content: string) => {
			try {
				await sendDirective.mutateAsync({ workerId, content });
				toast.success("Directive sent");
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Failed to send directive");
			}
		},
		[workerId, sendDirective],
	);

	return {
		handlePause,
		handleResume,
		handleRunNow,
		handleDelete,
		handleRestart,
		handleSendDirective,
		handleUpdate: (fields: Parameters<typeof updateWorker.mutate>[0]) =>
			updateWorker.mutate(fields),
		isPausing: pauseWorker.isPending,
		isResuming: resumeWorker.isPending,
		isRunningNow: runNow.isPending,
		isSendingDirective: sendDirective.isPending,
		isUpdating: updateWorker.isPending,
	};
}
