import { type Logger, createLogger } from "@proliferate/logger";

let _logger: Logger = createLogger({ service: "services" });

export function setServicesLogger(logger: Logger): void {
	_logger = logger;
}

export function getServicesLogger(): Logger {
	return _logger;
}
