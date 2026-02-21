import type { Logger } from "@proliferate/logger";
import { configurations } from "@proliferate/services";
import type { SandboxProvider } from "@proliferate/shared/providers";

type SnapshotScrubFailureMode = "throw" | "log";

export interface PrepareForSnapshotOptions {
	provider: SandboxProvider;
	sandboxId: string;
	configurationId: string | null;
	logger: Logger;
	logContext: string;
	failureMode?: SnapshotScrubFailureMode;
	reapplyAfterCapture?: boolean;
}

type SnapshotCleanup = () => Promise<void>;

const ENV_SNAPSHOT_TIMEOUT_MS = 15_000;
const NOOP_SNAPSHOT_CLEANUP: SnapshotCleanup = async () => {
	// Intentionally no-op when scrub/re-apply does not apply to this path.
};

function toError(message: string, err: unknown): Error {
	if (err instanceof Error) {
		return err;
	}
	return new Error(`${message}: ${String(err)}`);
}

function handleFailure(
	mode: SnapshotScrubFailureMode,
	logger: Logger,
	message: string,
	err: unknown,
): void {
	if (mode === "throw") {
		throw toError(message, err);
	}
	logger.error({ err }, message);
}

/**
 * Best-effort env-file scrub before snapshot capture.
 * Returns a post-capture cleanup function that optionally re-applies env files.
 */
export async function prepareForSnapshot(
	options: PrepareForSnapshotOptions,
): Promise<SnapshotCleanup> {
	const {
		provider,
		sandboxId,
		configurationId,
		logger,
		logContext,
		failureMode = "log",
		reapplyAfterCapture = true,
	} = options;
	const execCommand = provider.execCommand;

	if (!configurationId || !execCommand) {
		return NOOP_SNAPSHOT_CLEANUP;
	}

	let envFilesSpec: unknown;
	try {
		envFilesSpec = await configurations.getConfigurationEnvFiles(configurationId);
	} catch (err) {
		handleFailure(
			failureMode,
			logger,
			`${logContext}: failed to load env file spec before snapshot`,
			err,
		);
		return NOOP_SNAPSHOT_CLEANUP;
	}

	if (!envFilesSpec) {
		return NOOP_SNAPSHOT_CLEANUP;
	}

	const specJson = JSON.stringify(envFilesSpec);

	try {
		const scrubResult = await execCommand(
			sandboxId,
			["proliferate", "env", "scrub", "--spec", specJson],
			{ timeoutMs: ENV_SNAPSHOT_TIMEOUT_MS },
		);
		if (scrubResult.exitCode !== 0) {
			handleFailure(
				failureMode,
				logger,
				`${logContext}: env scrub failed before snapshot`,
				new Error(`env scrub failed: exit code ${scrubResult.exitCode}`),
			);
		} else {
			logger.info(`${logContext}: env files scrubbed before snapshot`);
		}
	} catch (err) {
		handleFailure(failureMode, logger, `${logContext}: env scrub failed before snapshot`, err);
	}

	if (!reapplyAfterCapture) {
		return NOOP_SNAPSHOT_CLEANUP;
	}

	return async () => {
		try {
			const applyResult = await execCommand(
				sandboxId,
				["proliferate", "env", "apply", "--spec", specJson],
				{ timeoutMs: ENV_SNAPSHOT_TIMEOUT_MS },
			);
			if (applyResult.exitCode !== 0) {
				const applyErr = new Error(`env re-apply failed: exit code ${applyResult.exitCode}`);
				logger.error({ err: applyErr }, `${logContext}: env re-apply after snapshot failed`);
				return;
			}
			logger.info(`${logContext}: env files re-applied after snapshot`);
		} catch (err) {
			logger.error({ err }, `${logContext}: env re-apply after snapshot failed`);
		}
	};
}
