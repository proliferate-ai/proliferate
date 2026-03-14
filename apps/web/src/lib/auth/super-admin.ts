import "server-only";
import { isDevMode, serverConfig } from "@/lib/config/server";
import { cookies } from "next/headers";

export interface ImpersonationData {
	userId: string;
	orgId: string;
}

const IMPERSONATION_COOKIE = "x-impersonate";

export function isSuperAdmin(email: string | null | undefined): boolean {
	if (!email) return false;
	const superAdminEmails = serverConfig.superAdminEmails
		.split(",")
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
		secure: !isDevMode(),
		sameSite: "strict",
		path: "/",
		maxAge: 60 * 60 * 24,
	});
}

export async function clearImpersonationCookie(): Promise<void> {
	const cookieStore = await cookies();
	cookieStore.delete(IMPERSONATION_COOKIE);
}
