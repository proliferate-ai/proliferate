import { initContract } from "@ts-rest/core";
import { adminContract } from "./admin";
import { automationsContract } from "./automations";
import { cliContract } from "./cli";
import { configurationsContract } from "./configurations";
import { integrationsContract } from "./integrations";
import { miscContract } from "./misc";
import { onboardingContract } from "./onboarding";
import { orgsContract } from "./orgs";
import { reposContract } from "./repos";
import { schedulesContract } from "./schedules";
import { secretsContract } from "./secrets";
import { sessionsContract } from "./sessions";
import { triggersContract } from "./triggers";

const c = initContract();

/**
 * Combined API contract for all endpoints.
 * Each domain has its own contract file that is merged here.
 */
export const contract = c.router({
	admin: adminContract,
	automations: automationsContract,
	cli: cliContract,
	configurations: configurationsContract,
	integrations: integrationsContract,
	misc: miscContract,
	onboarding: onboardingContract,
	orgs: orgsContract,
	repos: reposContract,
	schedules: schedulesContract,
	secrets: secretsContract,
	sessions: sessionsContract,
	triggers: triggersContract,
});

// Re-export individual contracts for direct access
export { adminContract } from "./admin";
export { automationsContract } from "./automations";
export { cliContract } from "./cli";
export { configurationsContract } from "./configurations";
export { integrationsContract } from "./integrations";
export { miscContract } from "./misc";
export { onboardingContract } from "./onboarding";
export { orgsContract } from "./orgs";
export { reposContract } from "./repos";
export { schedulesContract } from "./schedules";
export { secretsContract } from "./secrets";
export { sessionsContract } from "./sessions";
export { triggersContract } from "./triggers";

// Re-export common types
export type { ErrorResponse, Pagination } from "./common";
export { ErrorResponseSchema, PaginationSchema } from "./common";

// Re-export admin types
export {
	AdminUserOrgSchema,
	AdminUserSchema,
	AdminOrganizationSchema,
	ImpersonatingUserSchema,
	ImpersonatingOrgSchema,
	UserOrgSchema,
	ImpersonatingSchema,
} from "./admin";

// Re-export repo types
export type {
	Repo,
	CreateRepoInput,
	GitHubRepo,
	SearchRepo,
	FinalizeSetupInput,
} from "./repos";
export {
	RepoSchema,
	CreateRepoInputSchema,
	GitHubRepoSchema,
	SearchRepoSchema,
	FinalizeSetupInputSchema,
	FinalizeSetupResponseSchema,
} from "./repos";

// Re-export session types
export type { Session, CreateSessionInput } from "./sessions";
export {
	SessionSchema,
	SessionStatusSchema,
	CreateSessionInputSchema,
	CreateSessionResponseSchema,
} from "./sessions";

// Re-export org types
export type { Organization, OrganizationWithRole, Member, Invitation, OrgRole } from "./orgs";
export {
	OrganizationSchema,
	OrganizationWithRoleSchema,
	MemberSchema,
	InvitationSchema,
	OrgRoleSchema,
	DomainSuggestionSchema,
} from "./orgs";

// Re-export configuration types
export type { Configuration } from "./configurations";
export {
	ConfigurationSchema,
	CreateConfigurationInputSchema,
	UpdateConfigurationInputSchema,
} from "./configurations";

// Re-export onboarding types
export type {
	OnboardingRepo,
	OnboardingStatus,
	FinalizeOnboardingInput,
	FinalizeOnboardingResponse,
	SaveToolSelectionsInput,
	SaveQuestionnaireInput,
} from "./onboarding";
export {
	OnboardingRepoSchema,
	OnboardingStatusSchema,
	FinalizeOnboardingInputSchema,
	FinalizeOnboardingResponseSchema,
	SaveToolSelectionsInputSchema,
	SaveQuestionnaireInputSchema,
} from "./onboarding";

// Re-export CLI types
export {
	CliRepoSchema,
	CliRepoConnectionSchema,
	DeviceCodeResponseSchema,
	DevicePollResponseSchema,
	SshKeySchema,
	CliSessionSchema,
	CliConfigurationSchema,
} from "./cli";

// Re-export integration types
export type {
	Integration,
	IntegrationWithCreator,
	SentryMetadata,
	LinearMetadata,
} from "./integrations";
export {
	IntegrationSchema,
	IntegrationWithCreatorSchema,
	ProviderStatusSchema,
	GitHubStatusSchema,
	SlackStatusSchema,
	SentryMetadataSchema,
	LinearMetadataSchema,
} from "./integrations";

// Re-export schedule types
export type { Schedule, UpdateScheduleInput } from "./schedules";
export { ScheduleSchema, UpdateScheduleInputSchema } from "./schedules";

// Re-export secret types
export type { Secret, CreateSecretInput, CheckSecretsInput, BulkImportInput } from "./secrets";
export {
	SecretSchema,
	CreateSecretInputSchema,
	CheckSecretsInputSchema,
	CheckSecretsResultSchema,
	BulkImportInputSchema,
	BulkImportResultSchema,
} from "./secrets";

// Re-export trigger types
export type {
	Trigger,
	TriggerWithIntegration,
	TriggerEvent,
	TriggerEventWithRelations,
	CreateTriggerInput,
	UpdateTriggerInput,
} from "./triggers";
export {
	TriggerSchema,
	TriggerWithIntegrationSchema,
	TriggerEventSchema,
	TriggerEventWithRelationsSchema,
	CreateTriggerInputSchema,
	UpdateTriggerInputSchema,
	TriggerTypeSchema,
	ExecutionModeSchema,
	TriggerProviderSchema,
} from "./triggers";

// Re-export automation types
export type {
	Automation,
	AutomationListItem,
	AutomationWithTriggers,
	AutomationTrigger,
	AutomationEvent,
	AutomationEventDetail,
	AutomationEventAction,
	AutomationConnection,
	AutomationRun,
	AutomationRunStatus,
	AutomationRunEvent,
	PendingRunSummary,
	CreateAutomationInput,
	UpdateAutomationInput,
	CreateAutomationTriggerInput,
	CreateAutomationScheduleInput,
} from "./automations";
export {
	AutomationSchema,
	AutomationListItemSchema,
	AutomationWithTriggersSchema,
	AutomationTriggerSchema,
	AutomationEventSchema,
	AutomationEventDetailSchema,
	AutomationEventActionSchema,
	AutomationEventStatusSchema,
	AutomationRunSchema,
	AutomationRunStatusSchema,
	AutomationRunEventSchema,
	AutomationConnectionSchema,
	PendingRunSummarySchema,
	CreateAutomationInputSchema,
	UpdateAutomationInputSchema,
	CreateAutomationTriggerInputSchema,
	CreateAutomationScheduleInputSchema,
} from "./automations";
