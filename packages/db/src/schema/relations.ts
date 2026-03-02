import { relations } from "drizzle-orm/relations";
import {
	account,
	actionInvocationEvents,
	actionInvocations,
	apikey,
	automationConnections,
	automationRunEvents,
	automationRuns,
	automationSideEffects,
	automations,
	billingEvents,
	cliDeviceCodes,
	cliGithubSelections,
	configurationRepos,
	configurationSecrets,
	configurations,
	integrations,
	invitation,
	member,
	orgConnectors,
	organization,
	outbox,
	repoBaselineTargets,
	repoBaselines,
	repoConnections,
	repos,
	resumeIntents,
	sandboxBaseSnapshots,
	schedules,
	secretFiles,
	secrets,
	session,
	sessionAcl,
	sessionCapabilities,
	sessionConnections,
	sessionEvents,
	sessionMessages,
	sessionNotificationSubscriptions,
	sessionPullRequests,
	sessionSkills,
	sessionUserState,
	sessions,
	slackConversations,
	slackInstallations,
	triggerEvents,
	triggerPollGroups,
	triggers,
	user,
	userActionPreferences,
	userSshKeys,
	wakeEvents,
	webhookInbox,
	workerRunEvents,
	workerRuns,
	workers,
} from "./schema";

export const sessionRelations = relations(session, ({ one }) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id],
	}),
}));

export const userRelations = relations(user, ({ many }) => ({
	sessions_userId: many(session),
	accounts: many(account),
	invitations: many(invitation),
	members: many(member),
	repos: many(repos),
	configurations_createdBy: many(configurations, {
		relationName: "configurations_createdBy_user_id",
	}),
	configurations_userId: many(configurations, {
		relationName: "configurations_userId_user_id",
	}),
	integrations: many(integrations),
	secrets: many(secrets),
	triggers: many(triggers),
	automations: many(automations),
	schedules: many(schedules),
	userSshKeys: many(userSshKeys),
	cliDeviceCodes: many(cliDeviceCodes),
	apikeys: many(apikey),
	slackInstallations: many(slackInstallations),
	sessions_createdBy: many(sessions),
	cliGithubSelections: many(cliGithubSelections),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id],
	}),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [invitation.inviterId],
		references: [user.id],
	}),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
	invitations: many(invitation),
	members: many(member),
	repos: many(repos),
	integrations: many(integrations),
	secrets: many(secrets),
	triggers: many(triggers),
	automations: many(automations),
	schedules: many(schedules),
	triggerEvents: many(triggerEvents),
	automationRuns: many(automationRuns),
	outbox: many(outbox),
	cliDeviceCodes: many(cliDeviceCodes),
	slackInstallations: many(slackInstallations),
	sessions: many(sessions),
	billingEvents: many(billingEvents),
	cliGithubSelections: many(cliGithubSelections),
	orgConnectors: many(orgConnectors),
}));

export const orgConnectorsRelations = relations(orgConnectors, ({ one }) => ({
	organization: one(organization, {
		fields: [orgConnectors.organizationId],
		references: [organization.id],
	}),
	createdByUser: one(user, {
		fields: [orgConnectors.createdBy],
		references: [user.id],
	}),
}));

export const memberRelations = relations(member, ({ one }) => ({
	organization: one(organization, {
		fields: [member.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [member.userId],
		references: [user.id],
	}),
}));

export const reposRelations = relations(repos, ({ one, many }) => ({
	organization: one(organization, {
		fields: [repos.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [repos.addedBy],
		references: [user.id],
	}),
	repoConnections: many(repoConnections),
	secrets: many(secrets),
	slackConversations: many(slackConversations),
	sessions: many(sessions),
	configurationRepos: many(configurationRepos),
	repoBaselines: many(repoBaselines),
}));

export const configurationsRelations = relations(configurations, ({ one, many }) => ({
	user_createdBy: one(user, {
		fields: [configurations.createdBy],
		references: [user.id],
		relationName: "configurations_createdBy_user_id",
	}),
	user_userId: one(user, {
		fields: [configurations.userId],
		references: [user.id],
		relationName: "configurations_userId_user_id",
	}),
	secrets: many(secrets),
	automations: many(automations),
	sessions: many(sessions),
	configurationRepos: many(configurationRepos),
	configurationSecrets: many(configurationSecrets),
	secretFiles: many(secretFiles),
}));

export const repoConnectionsRelations = relations(repoConnections, ({ one }) => ({
	repo: one(repos, {
		fields: [repoConnections.repoId],
		references: [repos.id],
	}),
	integration: one(integrations, {
		fields: [repoConnections.integrationId],
		references: [integrations.id],
	}),
}));

export const automationConnectionsRelations = relations(automationConnections, ({ one }) => ({
	automation: one(automations, {
		fields: [automationConnections.automationId],
		references: [automations.id],
	}),
	integration: one(integrations, {
		fields: [automationConnections.integrationId],
		references: [integrations.id],
	}),
}));

export const sessionConnectionsRelations = relations(sessionConnections, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionConnections.sessionId],
		references: [sessions.id],
	}),
	integration: one(integrations, {
		fields: [sessionConnections.integrationId],
		references: [integrations.id],
	}),
}));

export const integrationsRelations = relations(integrations, ({ one, many }) => ({
	automationConnections: many(automationConnections),
	sessionConnections: many(sessionConnections),
	repoConnections: many(repoConnections),
	organization: one(organization, {
		fields: [integrations.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [integrations.createdBy],
		references: [user.id],
	}),
	triggers: many(triggers),
}));

export const secretsRelations = relations(secrets, ({ one }) => ({
	organization: one(organization, {
		fields: [secrets.organizationId],
		references: [organization.id],
	}),
	repo: one(repos, {
		fields: [secrets.repoId],
		references: [repos.id],
	}),
	user: one(user, {
		fields: [secrets.createdBy],
		references: [user.id],
	}),
	configuration: one(configurations, {
		fields: [secrets.configurationId],
		references: [configurations.id],
	}),
}));

export const triggersRelations = relations(triggers, ({ one, many }) => ({
	organization: one(organization, {
		fields: [triggers.organizationId],
		references: [organization.id],
	}),
	automation: one(automations, {
		fields: [triggers.automationId],
		references: [automations.id],
	}),
	integration: one(integrations, {
		fields: [triggers.integrationId],
		references: [integrations.id],
	}),
	user: one(user, {
		fields: [triggers.createdBy],
		references: [user.id],
	}),
	triggerEvents: many(triggerEvents),
	sessions: many(sessions),
}));

export const automationsRelations = relations(automations, ({ one, many }) => ({
	automationConnections: many(automationConnections),
	triggers: many(triggers),
	organization: one(organization, {
		fields: [automations.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [automations.createdBy],
		references: [user.id],
	}),
	configuration: one(configurations, {
		fields: [automations.defaultConfigurationId],
		references: [configurations.id],
	}),
	schedules: many(schedules),
	sessions: many(sessions),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
	automation: one(automations, {
		fields: [schedules.automationId],
		references: [automations.id],
	}),
	organization: one(organization, {
		fields: [schedules.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [schedules.createdBy],
		references: [user.id],
	}),
}));

export const triggerEventsRelations = relations(triggerEvents, ({ one, many }) => ({
	trigger: one(triggers, {
		fields: [triggerEvents.triggerId],
		references: [triggers.id],
	}),
	organization: one(organization, {
		fields: [triggerEvents.organizationId],
		references: [organization.id],
	}),
	session: one(sessions, {
		fields: [triggerEvents.sessionId],
		references: [sessions.id],
		relationName: "triggerEvents_sessionId_sessions_id",
	}),
	sessions: many(sessions, {
		relationName: "sessions_triggerEventId_triggerEvents_id",
	}),
	automationRuns: many(automationRuns),
}));

export const automationRunsRelations = relations(automationRuns, ({ one, many }) => ({
	organization: one(organization, {
		fields: [automationRuns.organizationId],
		references: [organization.id],
	}),
	automation: one(automations, {
		fields: [automationRuns.automationId],
		references: [automations.id],
	}),
	triggerEvent: one(triggerEvents, {
		fields: [automationRuns.triggerEventId],
		references: [triggerEvents.id],
	}),
	trigger: one(triggers, {
		fields: [automationRuns.triggerId],
		references: [triggers.id],
	}),
	session: one(sessions, {
		fields: [automationRuns.sessionId],
		references: [sessions.id],
	}),
	assignee: one(user, {
		fields: [automationRuns.assignedTo],
		references: [user.id],
	}),
	events: many(automationRunEvents),
	sideEffects: many(automationSideEffects),
}));

export const automationRunEventsRelations = relations(automationRunEvents, ({ one }) => ({
	run: one(automationRuns, {
		fields: [automationRunEvents.runId],
		references: [automationRuns.id],
	}),
}));

export const automationSideEffectsRelations = relations(automationSideEffects, ({ one }) => ({
	run: one(automationRuns, {
		fields: [automationSideEffects.runId],
		references: [automationRuns.id],
	}),
	organization: one(organization, {
		fields: [automationSideEffects.organizationId],
		references: [organization.id],
	}),
}));

export const outboxRelations = relations(outbox, ({ one }) => ({
	organization: one(organization, {
		fields: [outbox.organizationId],
		references: [organization.id],
	}),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
	triggerEvents: many(triggerEvents, {
		relationName: "triggerEvents_sessionId_sessions_id",
	}),
	slackConversations: many(slackConversations),
	sessionConnections: many(sessionConnections),
	repo: one(repos, {
		fields: [sessions.repoId],
		references: [repos.id],
	}),
	organization: one(organization, {
		fields: [sessions.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [sessions.createdBy],
		references: [user.id],
	}),
	session: one(sessions, {
		fields: [sessions.parentSessionId],
		references: [sessions.id],
		relationName: "sessions_parentSessionId_sessions_id",
	}),
	sessions: many(sessions, {
		relationName: "sessions_parentSessionId_sessions_id",
	}),
	automation: one(automations, {
		fields: [sessions.automationId],
		references: [automations.id],
	}),
	trigger: one(triggers, {
		fields: [sessions.triggerId],
		references: [triggers.id],
	}),
	triggerEvent: one(triggerEvents, {
		fields: [sessions.triggerEventId],
		references: [triggerEvents.id],
		relationName: "sessions_triggerEventId_triggerEvents_id",
	}),
	configuration: one(configurations, {
		fields: [sessions.configurationId],
		references: [configurations.id],
	}),
	worker: one(workers, {
		fields: [sessions.workerId],
		references: [workers.id],
	}),
	workerRun: one(workerRuns, {
		fields: [sessions.workerRunId],
		references: [workerRuns.id],
	}),
	repoBaseline: one(repoBaselines, {
		fields: [sessions.repoBaselineId],
		references: [repoBaselines.id],
	}),
	repoBaselineTarget: one(repoBaselineTargets, {
		fields: [sessions.repoBaselineTargetId],
		references: [repoBaselineTargets.id],
	}),
	// V1 relations
	capabilities: many(sessionCapabilities),
	skills: many(sessionSkills),
	messages: many(sessionMessages),
	events: many(sessionEvents),
	acl: many(sessionAcl),
	userStates: many(sessionUserState),
	pullRequests: many(sessionPullRequests),
}));

export const slackConversationsRelations = relations(slackConversations, ({ one }) => ({
	slackInstallation: one(slackInstallations, {
		fields: [slackConversations.slackInstallationId],
		references: [slackInstallations.id],
	}),
	session: one(sessions, {
		fields: [slackConversations.sessionId],
		references: [sessions.id],
	}),
	repo: one(repos, {
		fields: [slackConversations.repoId],
		references: [repos.id],
	}),
}));

export const slackInstallationsRelations = relations(slackInstallations, ({ one, many }) => ({
	slackConversations: many(slackConversations),
	organization: one(organization, {
		fields: [slackInstallations.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [slackInstallations.installedBy],
		references: [user.id],
	}),
}));

export const sessionNotificationSubscriptionsRelations = relations(
	sessionNotificationSubscriptions,
	({ one }) => ({
		session: one(sessions, {
			fields: [sessionNotificationSubscriptions.sessionId],
			references: [sessions.id],
		}),
		user: one(user, {
			fields: [sessionNotificationSubscriptions.userId],
			references: [user.id],
		}),
		slackInstallation: one(slackInstallations, {
			fields: [sessionNotificationSubscriptions.slackInstallationId],
			references: [slackInstallations.id],
		}),
	}),
);

export const userSshKeysRelations = relations(userSshKeys, ({ one }) => ({
	user: one(user, {
		fields: [userSshKeys.userId],
		references: [user.id],
	}),
}));

export const cliDeviceCodesRelations = relations(cliDeviceCodes, ({ one }) => ({
	user: one(user, {
		fields: [cliDeviceCodes.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [cliDeviceCodes.orgId],
		references: [organization.id],
	}),
}));

export const apikeyRelations = relations(apikey, ({ one }) => ({
	user: one(user, {
		fields: [apikey.userId],
		references: [user.id],
	}),
}));

export const billingEventsRelations = relations(billingEvents, ({ one }) => ({
	organization: one(organization, {
		fields: [billingEvents.organizationId],
		references: [organization.id],
	}),
}));

export const configurationReposRelations = relations(configurationRepos, ({ one }) => ({
	configuration: one(configurations, {
		fields: [configurationRepos.configurationId],
		references: [configurations.id],
	}),
	repo: one(repos, {
		fields: [configurationRepos.repoId],
		references: [repos.id],
	}),
}));

export const cliGithubSelectionsRelations = relations(cliGithubSelections, ({ one }) => ({
	user: one(user, {
		fields: [cliGithubSelections.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [cliGithubSelections.organizationId],
		references: [organization.id],
	}),
}));

export const sandboxBaseSnapshotsRelations = relations(sandboxBaseSnapshots, () => ({}));

export const actionInvocationsRelations = relations(actionInvocations, ({ one }) => ({
	organization: one(organization, {
		fields: [actionInvocations.organizationId],
		references: [organization.id],
	}),
	integration: one(integrations, {
		fields: [actionInvocations.integrationId],
		references: [integrations.id],
	}),
	session: one(sessions, {
		fields: [actionInvocations.sessionId],
		references: [sessions.id],
	}),
}));

// ============================================
// vNext Table Relations
// ============================================

export const webhookInboxRelations = relations(webhookInbox, ({ one }) => ({
	organization: one(organization, {
		fields: [webhookInbox.organizationId],
		references: [organization.id],
	}),
}));

export const triggerPollGroupsRelations = relations(triggerPollGroups, ({ one }) => ({
	organization: one(organization, {
		fields: [triggerPollGroups.organizationId],
		references: [organization.id],
	}),
	integration: one(integrations, {
		fields: [triggerPollGroups.integrationId],
		references: [integrations.id],
	}),
}));

export const userActionPreferencesRelations = relations(userActionPreferences, ({ one }) => ({
	user: one(user, {
		fields: [userActionPreferences.userId],
		references: [user.id],
	}),
	organization: one(organization, {
		fields: [userActionPreferences.organizationId],
		references: [organization.id],
	}),
}));

export const secretFilesRelations = relations(secretFiles, ({ one }) => ({
	organization: one(organization, {
		fields: [secretFiles.organizationId],
		references: [organization.id],
	}),
	configuration: one(configurations, {
		fields: [secretFiles.configurationId],
		references: [configurations.id],
	}),
	user: one(user, {
		fields: [secretFiles.createdBy],
		references: [user.id],
	}),
}));

export const configurationSecretsRelations = relations(configurationSecrets, ({ one }) => ({
	configuration: one(configurations, {
		fields: [configurationSecrets.configurationId],
		references: [configurations.id],
	}),
	secret: one(secrets, {
		fields: [configurationSecrets.secretId],
		references: [secrets.id],
	}),
}));

// ============================================
// V1 Table Relations
// ============================================

export const workersRelations = relations(workers, ({ one, many }) => ({
	organization: one(organization, {
		fields: [workers.organizationId],
		references: [organization.id],
	}),
	createdByUser: one(user, {
		fields: [workers.createdBy],
		references: [user.id],
	}),
	managerSession: one(sessions, {
		fields: [workers.managerSessionId],
		references: [sessions.id],
	}),
	wakeEvents: many(wakeEvents),
	runs: many(workerRuns),
}));

export const wakeEventsRelations = relations(wakeEvents, ({ one }) => ({
	worker: one(workers, {
		fields: [wakeEvents.workerId],
		references: [workers.id],
	}),
	organization: one(organization, {
		fields: [wakeEvents.organizationId],
		references: [organization.id],
	}),
}));

export const workerRunsRelations = relations(workerRuns, ({ one, many }) => ({
	worker: one(workers, {
		fields: [workerRuns.workerId],
		references: [workers.id],
	}),
	organization: one(organization, {
		fields: [workerRuns.organizationId],
		references: [organization.id],
	}),
	managerSession: one(sessions, {
		fields: [workerRuns.managerSessionId],
		references: [sessions.id],
	}),
	wakeEvent: one(wakeEvents, {
		fields: [workerRuns.wakeEventId],
		references: [wakeEvents.id],
	}),
	events: many(workerRunEvents),
	taskSessions: many(sessions),
}));

export const workerRunEventsRelations = relations(workerRunEvents, ({ one }) => ({
	workerRun: one(workerRuns, {
		fields: [workerRunEvents.workerRunId],
		references: [workerRuns.id],
	}),
	worker: one(workers, {
		fields: [workerRunEvents.workerId],
		references: [workers.id],
	}),
}));

export const sessionCapabilitiesRelations = relations(sessionCapabilities, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionCapabilities.sessionId],
		references: [sessions.id],
	}),
}));

export const sessionSkillsRelations = relations(sessionSkills, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionSkills.sessionId],
		references: [sessions.id],
	}),
}));

export const sessionMessagesRelations = relations(sessionMessages, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionMessages.sessionId],
		references: [sessions.id],
	}),
}));

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionEvents.sessionId],
		references: [sessions.id],
	}),
}));

export const sessionAclRelations = relations(sessionAcl, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionAcl.sessionId],
		references: [sessions.id],
	}),
	user: one(user, {
		fields: [sessionAcl.userId],
		references: [user.id],
	}),
}));

export const sessionUserStateRelations = relations(sessionUserState, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionUserState.sessionId],
		references: [sessions.id],
	}),
	user: one(user, {
		fields: [sessionUserState.userId],
		references: [user.id],
	}),
}));

export const sessionPullRequestsRelations = relations(sessionPullRequests, ({ one }) => ({
	session: one(sessions, {
		fields: [sessionPullRequests.sessionId],
		references: [sessions.id],
	}),
	repo: one(repos, {
		fields: [sessionPullRequests.repoId],
		references: [repos.id],
	}),
}));

export const repoBaselinesRelations = relations(repoBaselines, ({ one, many }) => ({
	repo: one(repos, {
		fields: [repoBaselines.repoId],
		references: [repos.id],
	}),
	organization: one(organization, {
		fields: [repoBaselines.organizationId],
		references: [organization.id],
	}),
	targets: many(repoBaselineTargets),
}));

export const repoBaselineTargetsRelations = relations(repoBaselineTargets, ({ one }) => ({
	baseline: one(repoBaselines, {
		fields: [repoBaselineTargets.repoBaselineId],
		references: [repoBaselines.id],
	}),
}));

export const actionInvocationEventsRelations = relations(actionInvocationEvents, ({ one }) => ({
	actionInvocation: one(actionInvocations, {
		fields: [actionInvocationEvents.actionInvocationId],
		references: [actionInvocations.id],
	}),
}));

export const resumeIntentsRelations = relations(resumeIntents, ({ one }) => ({
	originSession: one(sessions, {
		fields: [resumeIntents.originSessionId],
		references: [sessions.id],
	}),
	actionInvocation: one(actionInvocations, {
		fields: [resumeIntents.invocationId],
		references: [actionInvocations.id],
	}),
}));
