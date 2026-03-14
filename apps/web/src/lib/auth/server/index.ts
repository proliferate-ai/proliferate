import "server-only";

import { runtimeConfig } from "@/lib/config/runtime";
import { isDevMode, isLocalDb, serverConfig } from "@/lib/config/server";
import { isEmailEnabled, sendInvitationEmail, sendVerificationEmail } from "@/lib/infra/email";
import { logger } from "@/lib/infra/logger";
import { createAuth } from "@proliferate/auth-core";
import { Pool } from "pg";

const log = logger.child({ module: "auth" });

const isDev = isDevMode();

// Prevent Next.js HMR from creating orphaned pools on every file save
const globalForAuthDb = globalThis as unknown as { authPool: Pool | undefined };

const pool =
	globalForAuthDb.authPool ??
	new Pool({
		connectionString: serverConfig.databaseUrl,
		max: isDev ? 5 : 1,
		idleTimeoutMillis: 10000,
		connectionTimeoutMillis: isDev ? 60000 : 5000,
		keepAlive: isDev,
		ssl: isLocalDb() ? false : { rejectUnauthorized: false },
	});

if (isDev) {
	globalForAuthDb.authPool = pool;
}

export const auth = createAuth({
	pool,
	emailAndPassword: {
		requireEmailVerification: runtimeConfig.enforceEmailVerification,
	},
	emailVerification: {
		sendVerificationEmail: async ({ user, url }) => {
			if (!isEmailEnabled()) {
				throw new Error("Email is disabled but verification is required.");
			}
			await sendVerificationEmail(user, url);
		},
	},
	sendInvitationEmail: async (data) => {
		if (!isEmailEnabled()) {
			log.warn("Email is disabled; skipping invite email");
			return;
		}
		await sendInvitationEmail(data);
	},
});

export type Auth = typeof auth;
