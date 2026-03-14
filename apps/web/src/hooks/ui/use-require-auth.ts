"use client";

import { REQUIRE_EMAIL_VERIFICATION } from "@/config/auth";
import { useSession } from "@/lib/auth/client";
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
			REQUIRE_EMAIL_VERIFICATION &&
			!session.user?.emailVerified
		) {
			router.push("/auth/verify-email");
		}
	}, [session, isPending, router]);

	return { session, isPending };
}
