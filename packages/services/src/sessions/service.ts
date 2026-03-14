import * as sessionsDb from "./db";

export interface Session {
	id: string;
	repoId: string;
	organizationId: string;
	createdBy: string | null;
	state: string;
	sessionType: string;
	harnessType: string;
	sandboxId: string | null;
	previewUrl: string | null;
	agentBaseUrl: string | null;
	devtoolsBaseUrl: string | null;
	sandboxAgentId: string | null;
	initialPrompt: string | null;
	createdAt: Date;
	updatedAt: Date;
	endedAt: Date | null;
	repo: { githubOrg: string; githubName: string } | null;
}

function toSession(row: sessionsDb.SessionWithRepo): Session {
	return {
		id: row.id,
		repoId: row.repoId,
		organizationId: row.organizationId,
		createdBy: row.createdBy,
		state: row.state,
		sessionType: row.sessionType,
		harnessType: row.harnessType,
		sandboxId: row.sandboxId ?? null,
		previewUrl: row.previewUrl ?? null,
		agentBaseUrl: row.agentBaseUrl ?? null,
		devtoolsBaseUrl: row.devtoolsBaseUrl ?? null,
		sandboxAgentId: row.sandboxAgentId ?? null,
		initialPrompt: row.initialPrompt ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		endedAt: row.endedAt ?? null,
		repo: row.repo,
	};
}

export async function listSessions(orgId: string): Promise<Session[]> {
	const rows = await sessionsDb.listByOrg(orgId);
	return rows.map(toSession);
}

export async function getSession(id: string, orgId: string): Promise<Session | null> {
	const row = await sessionsDb.findById(id);
	if (!row || row.organizationId !== orgId) return null;
	return toSession(row);
}
