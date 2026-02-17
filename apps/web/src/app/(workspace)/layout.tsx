"use client";

import { useSession } from "@/lib/auth-client";
import { env } from "@proliferate/environment/public";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function WorkspaceLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const router = useRouter();
	const { data: session, isPending: authPending } = useSession();

	const requireEmailVerification = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;

	// Redirect to sign-in if not authenticated
	useEffect(() => {
		if (!authPending && !session) {
			router.push("/sign-in");
		}
	}, [session, authPending, router]);

	// Redirect to verify-email if email not verified (when verification is required)
	useEffect(() => {
		if (!authPending && session && requireEmailVerification && !session.user?.emailVerified) {
			router.push("/auth/verify-email");
		}
	}, [session, authPending, router, requireEmailVerification]);

	if (authPending) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	return <>{children}</>;
}
