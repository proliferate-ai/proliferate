import { createLogger, type Logger } from "@proliferate/logger";

let _logger: Logger = createLogger({ service: "shared" });

export function setSharedLogger(logger: Logger): void {
	_logger = logger;
}

export function getSharedLogger(): Logger {
	return _logger;
}
