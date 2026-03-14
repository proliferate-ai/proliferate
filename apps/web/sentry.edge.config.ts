import * as Sentry from "@sentry/nextjs";
import { runtimeConfig } from "./src/lib/config/runtime";

const { sentryDsn, nodeEnv } = runtimeConfig;

Sentry.init({
	dsn: sentryDsn,

	// Set sample rate for production
	tracesSampleRate: nodeEnv === "production" ? 0.1 : 1.0,

	// Enable debug in development
	debug: false,
});
