import "server-only";

import { isEmailEnabled, sendInvitationEmail, sendVerificationEmail } from "@/lib/infra/email";
import { logger } from "@/lib/infra/logger";
import { createAuth } from "@proliferate/auth-core";
import { Pool } from "pg";

const log = logger.child({ module: "auth" });

const isDev = process.env.NODE_ENV !== "production";

// Prevent Next.js HMR from creating orphaned pools on every file save
const globalForAuthDb = globalThis as unknown as { authPool: Pool | undefined };

const isLocalDb =
	!process.env.DATABASE_URL?.includes("amazonaws.com") &&
	!process.env.DATABASE_URL?.includes("neon.tech");

const pool =
	globalForAuthDb.authPool ??
	new Pool({
		connectionString: process.env.DATABASE_URL,
		max: isDev ? 5 : 1,
		idleTimeoutMillis: 10000,
		connectionTimeoutMillis: isDev ? 60000 : 5000,
		keepAlive: isDev,
		ssl: isLocalDb ? false : { rejectUnauthorized: false },
	});

if (isDev) {
	globalForAuthDb.authPool = pool;
}

export const auth = createAuth({
	pool,
	emailAndPassword: {
		requireEmailVerification: Boolean(process.env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION),
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
