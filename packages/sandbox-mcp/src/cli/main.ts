import { actionsGuide, actionsList, actionsRun } from "./commands/actions.js";
import { envApply, envScrub } from "./commands/env.js";
import {
	servicesExpose,
	servicesList,
	servicesLogs,
	servicesRestart,
	servicesStart,
	servicesStop,
} from "./commands/services.js";
import { CliError } from "./errors.js";
import { parseFlags } from "./flags.js";
import { writeStderr } from "./output.js";

function usage(): never {
	writeStderr(`Usage: proliferate <command>

Commands:
  services list                                    List all services
  services start --name <n> --command <cmd> [--cwd <dir>]  Start a service
  services stop --name <n>                         Stop a service
  services restart --name <n>                      Restart a service
  services expose --port <port>                    Expose a port for preview
  services logs --name <n> [--follow]              View service logs

  env apply --spec <json>                          Generate env files from spec
  env scrub --spec <json>                          Delete secret env files

  actions list                                     List available integrations and actions
  actions guide --integration <i>                  Show provider usage guide
  actions run --integration <i> --action <a> [--params <json>]  Run an action`);
	throw new CliError("Invalid command", 2);
}

export async function runCli(argv: string[]): Promise<void> {
	if (argv.length === 0) usage();

	const group = argv[0];
	const action = argv[1];
	const flags = parseFlags(argv.slice(2));

	if (group === "services") {
		switch (action) {
			case "list":
				await servicesList();
				return;
			case "start":
				await servicesStart(flags);
				return;
			case "stop":
				await servicesStop(flags);
				return;
			case "restart":
				await servicesRestart(flags);
				return;
			case "expose":
				await servicesExpose(flags);
				return;
			case "logs":
				await servicesLogs(flags);
				return;
			default:
				usage();
		}
	}

	if (group === "env") {
		switch (action) {
			case "apply":
				await envApply(flags);
				return;
			case "scrub":
				await envScrub(flags);
				return;
			default:
				usage();
		}
	}

	if (group === "actions") {
		switch (action) {
			case "list":
				await actionsList();
				return;
			case "guide":
				await actionsGuide(flags);
				return;
			case "run":
				await actionsRun(flags);
				return;
			default:
				usage();
		}
	}

	usage();
}
