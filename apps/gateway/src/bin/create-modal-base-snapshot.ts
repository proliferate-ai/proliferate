import { createLogger } from "@proliferate/logger";
import { ModalLibmodalProvider } from "@proliferate/shared/providers";

const logger = createLogger({ service: "gateway" }).child({
	module: "create-modal-base-snapshot",
});

async function main(): Promise<void> {
	logger.info("Creating Modal base snapshot...");
	const provider = new ModalLibmodalProvider();
	const { snapshotId } = await provider.createBaseSnapshot();
	logger.info({ snapshotId }, "Modal base snapshot created");
	// Print the snapshot ID for easy piping into env/config.
	console.log(snapshotId);
}

main().catch((err) => {
	logger.error({ err }, "Failed to create Modal base snapshot");
	process.exit(1);
});
