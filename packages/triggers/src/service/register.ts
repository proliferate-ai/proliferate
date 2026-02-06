import { GitHubNangoTrigger } from "./adapters/github-nango";
import { GmailPollingTrigger } from "./adapters/gmail";
import { LinearNangoTrigger } from "./adapters/linear-nango";
import { SentryNangoTrigger } from "./adapters/sentry-nango";
import { registry } from "./registry";

export interface RegisterTriggersOptions {
	nangoSecret?: string;
	nangoGitHubIntegrationId?: string;
	nangoLinearIntegrationId?: string;
	nangoSentryIntegrationId?: string;
	composioApiKey?: string;
	composioBaseUrl?: string;
}

export function registerDefaultTriggers(options: RegisterTriggersOptions = {}): void {
	registry.registerWebhook(
		new GitHubNangoTrigger({
			nangoSecret: options.nangoSecret,
			allowedIntegrationIds: ["github", options.nangoGitHubIntegrationId].filter(
				Boolean,
			) as string[],
		}),
	);

	registry.registerWebhook(
		new LinearNangoTrigger({
			nangoSecret: options.nangoSecret,
			allowedIntegrationIds: ["linear", options.nangoLinearIntegrationId].filter(
				Boolean,
			) as string[],
		}),
	);

	registry.registerWebhook(
		new SentryNangoTrigger({
			nangoSecret: options.nangoSecret,
			allowedIntegrationIds: ["sentry", options.nangoSentryIntegrationId].filter(
				Boolean,
			) as string[],
		}),
	);

	if (options.composioApiKey) {
		registry.registerPolling(
			new GmailPollingTrigger({
				apiKey: options.composioApiKey,
				baseUrl: options.composioBaseUrl,
			}),
		);
	}
}
