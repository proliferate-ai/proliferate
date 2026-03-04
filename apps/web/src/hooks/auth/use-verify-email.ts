import { sendVerificationEmail, useSession } from "@/lib/auth/client";
import { sanitizeRedirect } from "@/lib/auth/utils";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function useVerifyEmail() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { data: session, isPending } = useSession();

	const emailFromQuery = searchParams.get("email");
	const redirectUrl = sanitizeRedirect(searchParams.get("redirect"));
	const email = session?.user?.email || emailFromQuery;

	const [isResending, setIsResending] = useState(false);
	const [resent, setResent] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!isPending && session?.user?.emailVerified) {
			router.push(redirectUrl);
		}
	}, [session, isPending, router, redirectUrl]);

	const handleResend = async () => {
		if (!email) return;
		setIsResending(true);
		setError(null);
		setResent(false);

		try {
			const result = await sendVerificationEmail({ email });
			if (result.error) {
				setError(result.error.message || "Failed to send verification email");
			} else {
				setResent(true);
			}
		} catch {
			setError("Failed to send verification email");
		} finally {
			setIsResending(false);
		}
	};

	return {
		session,
		isPending,
		email,
		isResending,
		resent,
		error,
		handleResend,
	};
}
