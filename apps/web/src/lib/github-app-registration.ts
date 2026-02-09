export function isLocalhostUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			parsed.hostname === "localhost" ||
			parsed.hostname === "127.0.0.1" ||
			parsed.hostname === "::1"
		);
	} catch {
		return false;
	}
}

export function getGitHubAppSetupUrl(appUrl: string): string {
	return `${appUrl.replace(/\/$/, "")}/api/integrations/github/callback`;
}

export function getGitHubAppWebhookUrl(appUrl: string): string {
	return `${appUrl.replace(/\/$/, "")}/api/webhooks/github-app`;
}

export function buildSuggestedGitHubAppName(): string {
	const suffix =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID().slice(0, 8)
			: Math.random().toString(16).slice(2, 10);

	return `proliferate-self-host-${suffix}`;
}

/**
 * Build a prefilled "Register a new GitHub App" URL.
 *
 * GitHub docs: https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-using-url-parameters
 */
export function buildGitHubAppRegistrationUrl(input: {
	appUrl: string;
	organization?: string;
	webhooksEnabled?: boolean;
	appName?: string;
}): string {
	const baseUrl = input.organization?.trim()
		? `https://github.com/organizations/${encodeURIComponent(
				input.organization.trim(),
			)}/settings/apps/new`
		: "https://github.com/settings/apps/new";

	const appUrl = input.appUrl.replace(/\/$/, "");
	const setupUrl = getGitHubAppSetupUrl(appUrl);
	const webhookUrl = getGitHubAppWebhookUrl(appUrl);
	const webhooksEnabled = input.webhooksEnabled ?? !isLocalhostUrl(appUrl);
	const appName = input.appName?.trim() ? input.appName.trim() : buildSuggestedGitHubAppName();

	const url = new URL(baseUrl);
	url.searchParams.set("name", appName);
	url.searchParams.set("description", "Proliferate self-hosted GitHub App");
	url.searchParams.set("url", appUrl);
	url.searchParams.set("public", "false");

	// Installation redirect.
	url.searchParams.set("setup_url", setupUrl);

	// Recommended repo permissions for core product functionality.
	url.searchParams.set("metadata", "read");
	url.searchParams.set("contents", "write");
	url.searchParams.set("pull_requests", "write");
	url.searchParams.set("issues", "read");

	// Optional webhooks. GitHub can't deliver to localhost without a tunnel or public domain.
	url.searchParams.set("webhook_active", webhooksEnabled ? "true" : "false");
	if (webhooksEnabled) {
		url.searchParams.set("webhook_url", webhookUrl);
		url.searchParams.append("events[]", "issues");
		url.searchParams.append("events[]", "pull_request");
		url.searchParams.append("events[]", "push");
	}

	return url.toString();
}
