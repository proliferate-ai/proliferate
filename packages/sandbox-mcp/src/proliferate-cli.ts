import { CliError } from "./cli/errors.js";
import { runCli } from "./cli/main.js";
import { writeStderr } from "./cli/output.js";

runCli(process.argv.slice(2)).catch((error: unknown) => {
	if (error instanceof CliError) {
		writeStderr(`Error: ${error.message}`);
		process.exit(error.exitCode);
	}
	const err = error instanceof Error ? error : new Error(String(error));
	writeStderr(`Error: ${err.message}`);
	process.exit(1);
});
