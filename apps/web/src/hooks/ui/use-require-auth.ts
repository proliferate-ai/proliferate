"use client";

import { useSession } from "@/lib/auth/client";
import { env } from "@proliferate/environment/public";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Redirects unauthenticated users to /sign-in.
 * Also redirects to /auth/verify-email when email verification is enforced.
 * Returns session state for downstream auth guards.
 */
export function useRequireAuth() {
	const router = useRouter();
	const { data: session, isPending } = useSession();

	useEffect(() => {
		if (!isPending && !session) {
			router.push("/sign-in");
		}
	}, [session, isPending, router]);

	useEffect(() => {
		if (
			!isPending &&
			session &&
			env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION &&
			!session.user?.emailVerified
		) {
			router.push("/auth/verify-email");
		}
	}, [session, isPending, router]);

	return { session, isPending };
}
