import { createLogger } from "@proliferate/logger";
import { users } from "@proliferate/services";

const logger = createLogger({ service: "gateway" }).child({ module: "git-identity" });

export interface GitIdentity {
	name: string;
	email: string;
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function buildGitIdentity(
	name: string | null | undefined,
	email: string | null | undefined,
): GitIdentity | null {
	const normalizedEmail = normalizeWhitespace(email ?? "");
	if (!normalizedEmail) {
		return null;
	}

	const localPart = normalizedEmail.split("@")[0] || "Proliferate User";
	const normalizedName = normalizeWhitespace(name ?? "") || localPart;

	return {
		name: normalizedName,
		email: normalizedEmail,
	};
}

export async function resolveGitIdentity(
	userId: string | null | undefined,
): Promise<GitIdentity | null> {
	if (!userId) {
		return null;
	}

	try {
		const user = await users.findById(userId);
		if (!user) {
			return null;
		}
		return buildGitIdentity(user.name, user.email);
	} catch (err) {
		logger.warn({ err, userId }, "Failed to resolve git identity");
		return null;
	}
}

export function toGitIdentityEnv(identity: GitIdentity | null | undefined): Record<string, string> {
	if (!identity) {
		return {};
	}

	return {
		GIT_AUTHOR_NAME: identity.name,
		GIT_AUTHOR_EMAIL: identity.email,
		GIT_COMMITTER_NAME: identity.name,
		GIT_COMMITTER_EMAIL: identity.email,
	};
}
