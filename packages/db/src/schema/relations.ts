import { relations } from "drizzle-orm/relations";
import {
	account,
	actionGrants,
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
	configurationSecrets,
	integrations,
	invitation,
	member,
	orgConnectors,
	organization,
	outbox,
	prebuildRepos,
	prebuilds,
	repoConnections,
	repos,
	sandboxBaseSnapshots,
	schedules,
	secretBundles,
	secretFiles,
	secrets,
	session,
	sessionConnections,
	sessions,
	slackConversations,
	slackInstallations,
	snapshotRepos,
	snapshots,
	triggerEvents,
	triggers,
	user,
	userSshKeys,
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
	prebuilds_createdBy: many(prebuilds, {
		relationName: "prebuilds_createdBy_user_id",
	}),
	prebuilds_userId: many(prebuilds, {
		relationName: "prebuilds_userId_user_id",
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
	prebuilds: many(prebuilds),
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
	prebuildRepos: many(prebuildRepos),
	snapshotRepos: many(snapshotRepos),
}));

export const prebuildsRelations = relations(prebuilds, ({ one, many }) => ({
	user_createdBy: one(user, {
		fields: [prebuilds.createdBy],
		references: [user.id],
		relationName: "prebuilds_createdBy_user_id",
	}),
	user_userId: one(user, {
		fields: [prebuilds.userId],
		references: [user.id],
		relationName: "prebuilds_userId_user_id",
	}),
	organization: one(organization, {
		fields: [prebuilds.organizationId],
		references: [organization.id],
	}),
	activeSnapshot: one(snapshots, {
		fields: [prebuilds.activeSnapshotId],
		references: [snapshots.id],
		relationName: "prebuilds_activeSnapshotId_snapshots_id",
	}),
	secrets: many(secrets),
	automations: many(automations),
	sessions: many(sessions),
	prebuildRepos: many(prebuildRepos),
	snapshots: many(snapshots, {
		relationName: "snapshots_prebuildId_prebuilds_id",
	}),
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

export const secretBundlesRelations = relations(secretBundles, ({ one, many }) => ({
	organization: one(organization, {
		fields: [secretBundles.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [secretBundles.createdBy],
		references: [user.id],
	}),
	secrets: many(secrets),
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
	prebuild: one(prebuilds, {
		fields: [secrets.prebuildId],
		references: [prebuilds.id],
	}),
	bundle: one(secretBundles, {
		fields: [secrets.bundleId],
		references: [secretBundles.id],
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
	prebuild: one(prebuilds, {
		fields: [automations.defaultPrebuildId],
		references: [prebuilds.id],
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
	prebuild: one(prebuilds, {
		fields: [sessions.prebuildId],
		references: [prebuilds.id],
	}),
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

export const prebuildReposRelations = relations(prebuildRepos, ({ one }) => ({
	prebuild: one(prebuilds, {
		fields: [prebuildRepos.prebuildId],
		references: [prebuilds.id],
	}),
	repo: one(repos, {
		fields: [prebuildRepos.repoId],
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

export const actionGrantsRelations = relations(actionGrants, ({ one }) => ({
	organization: one(organization, {
		fields: [actionGrants.organizationId],
		references: [organization.id],
	}),
	creator: one(user, {
		fields: [actionGrants.createdBy],
		references: [user.id],
	}),
	session: one(sessions, {
		fields: [actionGrants.sessionId],
		references: [sessions.id],
	}),
}));

// ============================================
// PR1 expand relations
// ============================================

export const snapshotsRelations = relations(snapshots, ({ one, many }) => ({
	prebuild: one(prebuilds, {
		fields: [snapshots.prebuildId],
		references: [prebuilds.id],
		relationName: "snapshots_prebuildId_prebuilds_id",
	}),
	snapshotRepos: many(snapshotRepos),
}));

export const snapshotReposRelations = relations(snapshotRepos, ({ one }) => ({
	snapshot: one(snapshots, {
		fields: [snapshotRepos.snapshotId],
		references: [snapshots.id],
	}),
	repo: one(repos, {
		fields: [snapshotRepos.repoId],
		references: [repos.id],
	}),
}));

export const secretFilesRelations = relations(secretFiles, ({ one, many }) => ({
	prebuild: one(prebuilds, {
		fields: [secretFiles.prebuildId],
		references: [prebuilds.id],
	}),
	configurationSecrets: many(configurationSecrets),
}));

export const configurationSecretsRelations = relations(configurationSecrets, ({ one }) => ({
	secretFile: one(secretFiles, {
		fields: [configurationSecrets.secretFileId],
		references: [secretFiles.id],
	}),
}));
