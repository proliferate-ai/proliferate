import { initContract } from "@ts-rest/core";
import { adminContract } from "./admin";
import { automationsContract } from "./automations";
import { cliContract } from "./cli";
import { integrationsContract } from "./integrations";
import { miscContract } from "./misc";
import { onboardingContract } from "./onboarding";
import { orgsContract } from "./orgs";
import { prebuildsContract } from "./prebuilds";
import { reposContract } from "./repos";
import { schedulesContract } from "./schedules";
import { secretsContract } from "./secrets";
import { sessionsContract } from "./sessions";
import { triggersContract } from "./triggers";
import { verificationContract } from "./verification";

const c = initContract();

/**
 * Combined API contract for all endpoints.
 * Each domain has its own contract file that is merged here.
 */
export const contract = c.router({
	admin: adminContract,
	automations: automationsContract,
	cli: cliContract,
	integrations: integrationsContract,
	misc: miscContract,
	onboarding: onboardingContract,
	orgs: orgsContract,
	prebuilds: prebuildsContract,
	repos: reposContract,
	schedules: schedulesContract,
	secrets: secretsContract,
	sessions: sessionsContract,
	triggers: triggersContract,
	verification: verificationContract,
});

// Re-export individual contracts for direct access
export { adminContract } from "./admin";
export { automationsContract } from "./automations";
export { cliContract } from "./cli";
export { integrationsContract } from "./integrations";
export { miscContract } from "./misc";
export { onboardingContract } from "./onboarding";
export { orgsContract } from "./orgs";
export { prebuildsContract } from "./prebuilds";
export { reposContract } from "./repos";
export { schedulesContract } from "./schedules";
export { secretsContract } from "./secrets";
export { sessionsContract } from "./sessions";
export { triggersContract } from "./triggers";
export { verificationContract } from "./verification";

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
	RepoPrebuild,
	RepoSnapshot,
	FinalizeSetupInput,
} from "./repos";
export {
	RepoSchema,
	CreateRepoInputSchema,
	GitHubRepoSchema,
	SearchRepoSchema,
	RepoPrebuildSchema,
	RepoSnapshotSchema,
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

// Re-export prebuild types
export type { Prebuild } from "./prebuilds";
export { PrebuildSchema, CreatePrebuildInputSchema, UpdatePrebuildInputSchema } from "./prebuilds";

// Re-export onboarding types
export type {
	OnboardingRepo,
	OnboardingStatus,
	FinalizeOnboardingInput,
	FinalizeOnboardingResponse,
} from "./onboarding";
export {
	OnboardingRepoSchema,
	OnboardingStatusSchema,
	FinalizeOnboardingInputSchema,
	FinalizeOnboardingResponseSchema,
} from "./onboarding";

// Re-export CLI types
export {
	CliRepoSchema,
	CliRepoConnectionSchema,
	DeviceCodeResponseSchema,
	DevicePollResponseSchema,
	SshKeySchema,
	CliSessionSchema,
	CreateCliSessionInputSchema,
	CreateCliSessionResponseSchema,
	CliPrebuildSchema,
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

// Re-export verification types
export type { VerificationFile } from "./verification";
export {
	VerificationFileSchema,
	VerificationMediaQuerySchema,
	PresignedUrlResponseSchema,
	TextContentResponseSchema,
	FileListResponseSchema,
} from "./verification";

// Re-export schedule types
export type { Schedule, UpdateScheduleInput } from "./schedules";
export { ScheduleSchema, UpdateScheduleInputSchema } from "./schedules";

// Re-export secret types
export type {
	Secret,
	CreateSecretInput,
	CheckSecretsInput,
	SecretBundle,
	CreateBundleInput,
	UpdateBundleInput,
	UpdateSecretBundleInput,
} from "./secrets";
export {
	SecretSchema,
	CreateSecretInputSchema,
	CheckSecretsInputSchema,
	CheckSecretsResultSchema,
	SecretBundleSchema,
	CreateBundleInputSchema,
	UpdateBundleInputSchema,
	UpdateSecretBundleInputSchema,
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
	AutomationConnectionSchema,
	CreateAutomationInputSchema,
	UpdateAutomationInputSchema,
	CreateAutomationTriggerInputSchema,
	CreateAutomationScheduleInputSchema,
} from "./automations";
