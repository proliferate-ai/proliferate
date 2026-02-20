// Admin hooks
export { useAdmin, useAdminUsers, useAdminOrganizations } from "./use-admin";

// Auth provider hooks
export { useAuthProviders } from "./use-auth-providers";

// Automation hooks
export {
	useAutomations,
	useAutomation,
	useCreateAutomation,
	useUpdateAutomation,
	useDeleteAutomation,
	useAutomationEvents,
	useAutomationEvent,
	useAutomationTriggers,
	useCreateAutomationTrigger,
	useAutomationSchedules,
	useCreateAutomationSchedule,
	useRun,
	useRunEvents,
	useResolveRun,
	useOrgRuns,
} from "./use-automations";

// Billing hooks
export {
	useBilling,
	useBillingState,
	useBuyCredits,
	useUpdateBillingSettings,
} from "./use-billing";
export type { BillingState } from "./use-billing";

// Utility hooks
export { useCopyToClipboard } from "./use-copy-to-clipboard";
export { useMediaQuery } from "./use-media-query";
export { usePolledReadiness } from "./use-polled-readiness";
export { useSignOut } from "./use-sign-out";

// GitHub hooks
export { useGitHubAppConnect } from "./use-github-app-connect";

// Nango/OAuth hooks and utilities
export {
	useNangoConnect,
	USE_NANGO_GITHUB,
	NANGO_INTEGRATION_IDS,
	getProviderFromIntegrationId,
	shouldUseNangoForProvider,
} from "./use-nango-connect";
export type { NangoManagedProvider, NangoProvider, NangoAuthFlow } from "./use-nango-connect";

// Onboarding hooks
export { useOnboarding } from "./use-onboarding";
export type { Repo, OnboardingState } from "./use-onboarding";

// Organization hooks
export {
	useOrgs,
	useOrg,
	useOrgMembers,
	useOrgInvitations,
	useOrgMembersAndInvitations,
	useOrgDomainSuggestions,
} from "./use-orgs";

// Repo hooks
export { useRepos, useRepo, useCreateRepo } from "./use-repos";

// Schedule hooks
export { useSchedule, useUpdateSchedule, useDeleteSchedule } from "./use-schedules";

// Secret hooks
export { useSecrets, useCreateSecret, useDeleteSecret, useCheckSecrets } from "./use-secrets";

// Session hooks
export {
	useSessions,
	useSessionData,
	useCreateSession,
	usePauseSession,
	useSnapshotSession,
	useRenameSession,
	useDeleteSession,
	useSessionStatus,
	useFinalizeSetup,
} from "./use-sessions";

// Trigger hooks
export {
	useTriggers,
	useTrigger,
	useCreateTrigger,
	useUpdateTrigger,
	useDeleteTrigger,
	useTriggerEvents,
	useSkipTriggerEvent,
} from "./use-triggers";

// Integration hooks
export {
	useIntegrations,
	useUpdateIntegration,
	useDisconnectIntegration,
	useIntegrationCallback,
	useGitHubStatus,
	useGitHubSession,
	useSentryStatus,
	useSentrySession,
	useSentryMetadata,
	useLinearStatus,
	useLinearSession,
	useLinearMetadata,
	useSlackStatus,
	useSlackConnect,
	useSlackDisconnect,
} from "./use-integrations";

// My Work hooks
export { useMyWork } from "./use-my-work";

// Org Activity hooks
export { useOrgActivity } from "./use-org-activity";

// Configuration hooks
export {
	useConfigurations,
	useCreateConfiguration,
	useUpdateConfiguration,
	useDeleteConfiguration,
	useConfigurationEnvFiles,
	useConfigurationServiceCommands,
	useEffectiveServiceCommands,
	useUpdateConfigurationServiceCommands,
	useAttachRepo,
	useDetachRepo,
} from "./use-configurations";
