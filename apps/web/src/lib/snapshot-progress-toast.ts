import { toast } from "sonner";

interface SnapshotProgressStage {
	delayMs: number;
	message: string;
	description?: string;
}

interface SnapshotProgressToastOptions {
	initialMessage?: string;
	waitHint?: string;
	stages?: SnapshotProgressStage[];
}

interface SnapshotProgressToast {
	success: (message?: string, description?: string) => void;
	error: (message?: string, description?: string) => void;
	dispose: () => void;
}

const DEFAULT_WAIT_HINT = "This can take around a minute.";
const DEFAULT_STAGES: SnapshotProgressStage[] = [
	{ delayMs: 3000, message: "Capturing filesystem..." },
	{ delayMs: 10000, message: "Compressing data..." },
	{ delayMs: 25000, message: "Finalizing snapshot..." },
];

export function startSnapshotProgressToast(
	options: SnapshotProgressToastOptions = {},
): SnapshotProgressToast {
	const waitHint = options.waitHint ?? DEFAULT_WAIT_HINT;
	const toastId = toast.loading(options.initialMessage ?? "Preparing snapshot...", {
		description: waitHint,
	});

	const timers = (options.stages ?? DEFAULT_STAGES).map((stage) =>
		setTimeout(() => {
			toast.loading(stage.message, {
				id: toastId,
				description: stage.description ?? waitHint,
			});
		}, stage.delayMs),
	);

	const dispose = () => {
		for (const timer of timers) {
			clearTimeout(timer);
		}
	};

	return {
		success: (message, description) => {
			dispose();
			toast.success(message ?? "Snapshot saved", { id: toastId, description });
		},
		error: (message, description) => {
			dispose();
			toast.error(message ?? "Failed to save snapshot", { id: toastId, description });
		},
		dispose,
	};
}
