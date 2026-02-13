import pino, { type LevelWithSilent, type Logger, type LoggerOptions } from "pino";
import pinoHttp, { type Options as PinoHttpOptions } from "pino-http";

export type { LevelWithSilent, Logger };

export interface CreateLoggerOptions {
	service: string;
	level?: LevelWithSilent;
	pretty?: boolean;
	base?: Record<string, unknown>;
}

export function createLogger(options: CreateLoggerOptions): Logger {
	const prettyEnabled =
		options.pretty ??
		(process.env.NODE_ENV !== "production" &&
			(process.env.LOG_PRETTY === undefined || process.env.LOG_PRETTY === "true"));
	const level = options.level ?? parseLogLevel(process.env.LOG_LEVEL) ?? "info";

	const loggerOptions: LoggerOptions = {
		level,
		base: {
			service: options.service,
			...options.base,
		},
		timestamp: pino.stdTimeFunctions.isoTime,
		serializers: {
			err: pino.stdSerializers.err,
			req: pino.stdSerializers.req,
			res: pino.stdSerializers.res,
		},
		redact: {
			paths: DEFAULT_REDACT_PATHS,
			censor: "[Redacted]",
		},
	};

	if (prettyEnabled) {
		loggerOptions.transport = {
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
				ignore: "pid,hostname",
				messageFormat:
					"{msg}{if err} — {err.message}{end}{if durationMs} ({durationMs}ms){end}{if count} (count: {count}){end}",
				hideObject: true,
			},
		};
	}

	return pino(loggerOptions);
}

export interface CreateHttpLoggerOptions extends Omit<PinoHttpOptions, "logger"> {
	logger: Logger;
}

export function createHttpLogger({ logger, ...options }: CreateHttpLoggerOptions) {
	return pinoHttp({
		logger,
		// Put everything in the message so it's a clean one-liner
		customSuccessMessage(req, res, responseTime) {
			return `${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms`;
		},
		customErrorMessage(req, res, err) {
			return `${req.method} ${req.url} ${res.statusCode} ${err.message}`;
		},
		// Suppress req/res objects — the message has method/url/status/time
		serializers: {
			req: () => undefined as never,
			res: () => undefined as never,
		},
		...options,
	});
}

const DEFAULT_REDACT_PATHS = [
	"req.headers.authorization",
	"req.headers.cookie",
	"req.headers['x-api-key']",
	"req.headers['x-auth-token']",
	"res.headers['set-cookie']",
	"headers.authorization",
	"headers.cookie",
	"authorization",
	"cookie",
	"password",
	"token",
	"accessToken",
	"refreshToken",
	"apiKey",
	"secret",
	"privateKey",
	"DATABASE_URL",
];

function parseLogLevel(value: string | undefined): LevelWithSilent | null {
	if (!value) return null;
	const normalized = value.toLowerCase();
	if (
		normalized === "fatal" ||
		normalized === "error" ||
		normalized === "warn" ||
		normalized === "info" ||
		normalized === "debug" ||
		normalized === "trace" ||
		normalized === "silent"
	) {
		return normalized;
	}
	return null;
}
