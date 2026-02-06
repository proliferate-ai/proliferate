import * as Sentry from "@sentry/nextjs";

const nodeEnv = process.env.NODE_ENV ?? "development";
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

Sentry.init({
	dsn: sentryDsn,

	// Set sample rate for production
	tracesSampleRate: nodeEnv === "production" ? 0.1 : 1.0,

	// Enable debug in development
	debug: false,

	// Filter out non-critical errors
	beforeSend(event, hint) {
		// Don't send errors in development
		if (nodeEnv !== "production") {
			return null;
		}

		return event;
	},
});
