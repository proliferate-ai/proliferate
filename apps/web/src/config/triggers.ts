import type { Provider } from "@/components/integrations/provider-icon";

export const LINEAR_PRIORITIES = [
	{ value: 1, label: "Urgent" },
	{ value: 2, label: "High" },
	{ value: 3, label: "Medium" },
	{ value: 4, label: "Low" },
];

export const GITHUB_EVENT_TYPES = [
	{ value: "issues" as const, label: "Issues" },
	{ value: "pull_request" as const, label: "Pull Requests" },
	{ value: "push" as const, label: "Push" },
	{ value: "check_run" as const, label: "Check Run" },
	{ value: "check_suite" as const, label: "Check Suite" },
	{ value: "workflow_run" as const, label: "Workflow Run" },
];

export const GITHUB_ISSUE_ACTIONS = [
	{ value: "opened", label: "Opened" },
	{ value: "closed", label: "Closed" },
	{ value: "labeled", label: "Labeled" },
	{ value: "assigned", label: "Assigned" },
];

export const GITHUB_PR_ACTIONS = [
	{ value: "opened", label: "Opened" },
	{ value: "closed", label: "Closed" },
	{ value: "merged", label: "Merged" },
	{ value: "ready_for_review", label: "Ready for Review" },
];

export const GITHUB_CONCLUSIONS = [
	{ value: "failure" as const, label: "Failure" },
	{ value: "success" as const, label: "Success" },
	{ value: "cancelled" as const, label: "Cancelled" },
	{ value: "timed_out" as const, label: "Timed Out" },
];

export const INTEGRATION_PROVIDERS: Provider[] = ["github", "linear", "sentry"];
export const STANDALONE_PROVIDERS: Provider[] = ["posthog", "webhook", "scheduled"];
export const ALL_PROVIDERS_LIST: Provider[] = [...INTEGRATION_PROVIDERS, ...STANDALONE_PROVIDERS];

/** Default configs per provider for immediate trigger creation */
export const DEFAULT_TRIGGER_CONFIGS: Record<string, Record<string, unknown>> = {
	linear: { actionFilters: ["create"] },
	sentry: {},
	github: { eventTypes: ["issues"], actionFilters: ["opened"] },
	posthog: {},
	webhook: {},
};
