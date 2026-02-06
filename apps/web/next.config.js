import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
	// Enable standalone output for Docker deployments
	output: process.env.NEXT_BUILD_STANDALONE === "true" ? "standalone" : undefined,
	transpilePackages: [
		"@proliferate/shared",
		"@proliferate/gateway-clients",
		"@proliferate/environment",
		"@proliferate/services",
		"@proliferate/queue",
		"@proliferate/db",
	],
	serverExternalPackages: ["bullmq", "ioredis"],
	// Allow ngrok domains for local dev
	allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.dev"],
	async redirects() {
		return [
			{
				source: "/install.sh",
				destination:
					"https://raw.githubusercontent.com/proliferate-ai/cloud/main/scripts/install.sh",
				permanent: false,
			},
		];
	},
};

export default withSentryConfig(nextConfig, {
	// For all available options, see:
	// https://www.npmjs.com/package/@sentry/webpack-plugin#options

	org: process.env.SENTRY_ORG,
	project: process.env.SENTRY_PROJECT,

	// Only print logs when CI is set
	silent: !process.env.CI,

	// Upload source maps for better stack traces
	widenClientFileUpload: true,

	// Hides source maps from generated client bundles
	hideSourceMaps: true,

	// Automatically tree-shake Sentry logger statements
	disableLogger: true,

	// Enables automatic instrumentation of Vercel Cron Monitors
	automaticVercelMonitors: true,
});
