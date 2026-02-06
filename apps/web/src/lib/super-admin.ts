import { nodeEnv } from "@proliferate/environment/runtime";
import { env } from "@proliferate/environment/server";
import { cookies } from "next/headers";

export interface ImpersonationData {
	userId: string;
	orgId: string;
}

const IMPERSONATION_COOKIE = "x-impersonate";

export function isSuperAdmin(email: string | null | undefined): boolean {
	if (!email) return false;
	const superAdminEmails = env.SUPER_ADMIN_EMAILS.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	return superAdminEmails.includes(email.toLowerCase());
}

export async function getImpersonationCookie(): Promise<ImpersonationData | null> {
	const cookieStore = await cookies();
	const cookie = cookieStore.get(IMPERSONATION_COOKIE);
	if (!cookie?.value) return null;

	try {
		return JSON.parse(cookie.value) as ImpersonationData;
	} catch {
		return null;
	}
}

export async function setImpersonationCookie(data: ImpersonationData): Promise<void> {
	const cookieStore = await cookies();
	cookieStore.set(IMPERSONATION_COOKIE, JSON.stringify(data), {
		httpOnly: true,
		secure: nodeEnv === "production",
		sameSite: "strict",
		path: "/",
		maxAge: 60 * 60 * 24, // 24 hours max
	});
}

export async function clearImpersonationCookie(): Promise<void> {
	const cookieStore = await cookies();
	cookieStore.delete(IMPERSONATION_COOKIE);
}
