import { REQUIRE_EMAIL_VERIFICATION } from "@/config/auth";
import { useAuthProviders } from "@/hooks/use-auth-providers";
import { signIn, signUp, useSession } from "@/lib/auth/client";
import { setLastAuthMethod } from "@/lib/auth/last-auth-method";
import { sanitizeRedirect } from "@/lib/auth/utils";
import { getUtms } from "@/lib/utm";
import { useRouter, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function trackSignup(method: "google" | "email") {
	const utms = getUtms() ?? {};
	posthog.capture("user_signed_up", { method, ...utms });
}

export function useSignUp() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { data: session, isPending } = useSession();
	const { data: authProviders } = useAuthProviders();
	const [googleLoading, setGoogleLoading] = useState(false);
	const [formLoading, setFormLoading] = useState(false);
	const [name, setName] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);

	const redirectUrl = sanitizeRedirect(searchParams.get("redirect"));
	const prefilledEmail = searchParams.get("email") || "";
	const [email, setEmail] = useState(prefilledEmail);

	const hasGoogleOAuth = authProviders?.providers.google ?? false;

	useEffect(() => {
		if (session && !isPending) {
			if (!session.user?.emailVerified && REQUIRE_EMAIL_VERIFICATION) {
				router.push(
					`/auth/verify-email?email=${encodeURIComponent(session.user.email)}&redirect=${encodeURIComponent(redirectUrl)}`,
				);
				return;
			}
			router.push(redirectUrl);
		}
	}, [session, isPending, router, redirectUrl]);

	const handleGoogleSignIn = async () => {
		setGoogleLoading(true);
		setLastAuthMethod("google");
		try {
			await signIn.social({
				provider: "google",
				callbackURL: redirectUrl,
			});
		} catch {
			toast.error("Google sign up failed. Please try again.");
			setGoogleLoading(false);
		}
	};

	const handleEmailSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		setFormLoading(true);
		setLastAuthMethod("email");

		if (password.length < 8) {
			toast.error("Password must be at least 8 characters");
			setFormLoading(false);
			return;
		}

		try {
			const result = await signUp.email({ email, password, name });
			if (result.error) {
				toast.error(result.error.message || "Sign up failed");
				setFormLoading(false);
			} else {
				trackSignup("email");
				// When email verification is required server-side, better-auth won't
				// return a session token. Check both the client flag and the actual
				// response to handle build-time env mismatches.
				const hasSession = !!(result.data as Record<string, unknown> | null)?.token;
				if (REQUIRE_EMAIL_VERIFICATION || !hasSession) {
					router.push(
						`/auth/verify-email?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirectUrl)}`,
					);
				} else {
					router.push(redirectUrl);
				}
			}
		} catch (err) {
			toast.error("Sign up failed. Please try again.");
			setFormLoading(false);
		}
	};

	return {
		session,
		isPending,
		name,
		setName,
		email,
		setEmail,
		password,
		setPassword,
		showPassword,
		setShowPassword,
		googleLoading,
		formLoading,
		hasGoogleOAuth,
		redirectUrl,
		handleGoogleSignIn,
		handleEmailSignUp,
	};
}
