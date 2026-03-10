import "server-only";

import { requireAuth } from "@/lib/auth/server/session";
import { sanitizeOAuthReturnUrl } from "@/lib/integrations/oauth-state";
import { env } from "@proliferate/environment/server";
import { orgs } from "@proliferate/services";
import { NextResponse } from "next/server";

interface OAuthCallbackStateActor {
	orgId: string;
	userId: string;
	timestamp: number;
}

interface VerifyOAuthCallbackContextInput {
	provider: OAuthCallbackProvider;
	state: OAuthCallbackStateActor;
	returnUrl: string | undefined;
}

export type OAuthCallbackProvider = "linear" | "jira" | "sentry" | "slack" | "composio";

export interface OAuthCallbackErrorKeys {
	denied: string;
	missingParams: string;
	invalidState: string;
	expired: string;
	unauthorized: string;
	forbidden: string;
	notConfigured?: string;
	tokenFailed?: string;
	profileFailed?: string;
	resourcesFailed?: string;
	noSite?: string;
	dbError?: string;
	success: string;
}

interface OAuthCallbackPolicy {
	initialRedirectPath: string;
	defaultReturnUrl: string;
	maxAgeMs: number;
	errors: OAuthCallbackErrorKeys;
}

export const OAUTH_CALLBACK_POLICIES: Record<OAuthCallbackProvider, OAuthCallbackPolicy> = {
	linear: {
		initialRedirectPath: "/dashboard/integrations",
		defaultReturnUrl: "/dashboard/integrations",
		maxAgeMs: 10 * 60 * 1000,
		errors: {
			denied: "linear_oauth_denied",
			missingParams: "linear_oauth_missing_params",
			invalidState: "linear_oauth_invalid_state",
			expired: "linear_oauth_expired",
			unauthorized: "linear_oauth_unauthorized",
			forbidden: "linear_oauth_forbidden",
			notConfigured: "linear_not_configured",
			tokenFailed: "linear_oauth_token_failed",
			profileFailed: "linear_oauth_profile_failed",
			success: "linear",
		},
	},
	jira: {
		initialRedirectPath: "/dashboard/integrations",
		defaultReturnUrl: "/dashboard/integrations",
		maxAgeMs: 10 * 60 * 1000,
		errors: {
			denied: "jira_oauth_denied",
			missingParams: "jira_oauth_missing_params",
			invalidState: "jira_oauth_invalid_state",
			expired: "jira_oauth_expired",
			unauthorized: "jira_oauth_unauthorized",
			forbidden: "jira_oauth_forbidden",
			notConfigured: "jira_not_configured",
			tokenFailed: "jira_oauth_token_failed",
			resourcesFailed: "jira_oauth_resources_failed",
			noSite: "jira_oauth_no_site",
			success: "jira",
		},
	},
	sentry: {
		initialRedirectPath: "/dashboard/integrations",
		defaultReturnUrl: "/dashboard/integrations",
		maxAgeMs: 10 * 60 * 1000,
		errors: {
			denied: "sentry_oauth_denied",
			missingParams: "sentry_oauth_missing_params",
			invalidState: "sentry_oauth_invalid_state",
			expired: "sentry_oauth_expired",
			unauthorized: "sentry_oauth_unauthorized",
			forbidden: "sentry_oauth_forbidden",
			notConfigured: "sentry_not_configured",
			tokenFailed: "sentry_oauth_token_failed",
			success: "sentry",
		},
	},
	slack: {
		initialRedirectPath: "",
		defaultReturnUrl: "",
		maxAgeMs: 5 * 60 * 1000,
		errors: {
			denied: "slack_oauth_denied",
			missingParams: "slack_oauth_missing_params",
			invalidState: "slack_oauth_invalid_state",
			expired: "slack_oauth_expired",
			unauthorized: "slack_oauth_unauthorized",
			forbidden: "slack_oauth_forbidden",
			tokenFailed: "slack_oauth_token_failed",
			dbError: "slack_db_error",
			success: "slack",
		},
	},
	composio: {
		initialRedirectPath: "/dashboard/integrations",
		defaultReturnUrl: "/dashboard/integrations",
		maxAgeMs: 10 * 60 * 1000,
		errors: {
			denied: "composio_oauth_denied",
			missingParams: "composio_oauth_missing_params",
			invalidState: "composio_oauth_invalid_state",
			expired: "composio_oauth_expired",
			unauthorized: "composio_oauth_unauthorized",
			forbidden: "composio_oauth_forbidden",
			notConfigured: "composio_not_configured",
			tokenFailed: "composio_oauth_token_failed",
			success: "composio",
		},
	},
};

export function redirectForOAuthCallbackError(
	provider: OAuthCallbackProvider,
	error: string,
): NextResponse {
	const policy = OAUTH_CALLBACK_POLICIES[provider];
	return NextResponse.redirect(
		`${env.NEXT_PUBLIC_APP_URL}${policy.initialRedirectPath}?error=${error}`,
	);
}

export function parseOAuthCallbackPreflight(
	request: Request,
	provider: OAuthCallbackProvider,
): { code: string; state: string } | { response: NextResponse } {
	const policy = OAUTH_CALLBACK_POLICIES[provider];
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const oauthError = url.searchParams.get("error");

	if (oauthError) {
		return { response: redirectForOAuthCallbackError(provider, policy.errors.denied) };
	}

	if (!code || !state) {
		return { response: redirectForOAuthCallbackError(provider, policy.errors.missingParams) };
	}

	return { code, state };
}

export async function verifyOAuthCallbackContext({
	provider,
	state,
	returnUrl,
}: VerifyOAuthCallbackContextInput): Promise<
	{ context: { userId: string; orgId: string; redirectBase: string } } | { response: NextResponse }
> {
	const policy = OAUTH_CALLBACK_POLICIES[provider];
	const sanitizedReturnUrl = sanitizeOAuthReturnUrl(returnUrl, policy.defaultReturnUrl);
	const redirectBase = `${env.NEXT_PUBLIC_APP_URL}${sanitizedReturnUrl}`;

	if (state.timestamp < Date.now() - policy.maxAgeMs) {
		return {
			response: NextResponse.redirect(`${redirectBase}?error=${policy.errors.expired}`),
		};
	}

	const authResult = await requireAuth();
	if ("error" in authResult) {
		return {
			response: NextResponse.redirect(`${redirectBase}?error=${policy.errors.unauthorized}`),
		};
	}

	const authUserId = authResult.session.user.id;
	if (authUserId !== state.userId) {
		return {
			response: NextResponse.redirect(`${redirectBase}?error=${policy.errors.forbidden}`),
		};
	}

	const role = await orgs.getUserRole(authUserId, state.orgId);
	if (role !== "owner" && role !== "admin") {
		return {
			response: NextResponse.redirect(`${redirectBase}?error=${policy.errors.forbidden}`),
		};
	}

	return {
		context: {
			userId: authUserId,
			orgId: state.orgId,
			redirectBase,
		},
	};
}
