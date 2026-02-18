"use client";

export const dynamic = "force-dynamic";

import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, GoogleIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthProviders } from "@/hooks/use-auth-providers";
import { signIn, signUp, useSession } from "@/lib/auth-client";
import { buildAuthLink, sanitizeRedirect } from "@/lib/auth-utils";
import { env } from "@proliferate/environment/public";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

const REQUIRE_EMAIL_VERIFICATION = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;

function SignUpContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { data: session, isPending } = useSession();
	const { data: authProviders } = useAuthProviders();
	const [googleLoading, setGoogleLoading] = useState(false);
	const [formLoading, setFormLoading] = useState(false);
	const [name, setName] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);

	// Get redirect URL and optional pre-filled email from query params
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

	// Track which auth method was last used
	const setLastAuthMethod = (method: "google" | "email") => {
		try {
			localStorage.setItem("proliferate:last-auth-method", method);
		} catch {
			// localStorage may be unavailable in private browsing
		}
	};

	const handleGoogleSignIn = async () => {
		setGoogleLoading(true);
		setLastAuthMethod("google");
		try {
			await signIn.social({
				provider: "google",
				callbackURL: redirectUrl,
			});
		} catch (err) {
			console.error("Google sign up failed:", err);
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

	if (isPending) {
		return (
			<AuthLayout>
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-300" />
			</AuthLayout>
		);
	}

	if (session) {
		return null;
	}

	// Build sign-in link preserving redirect + email params
	const signInHref = buildAuthLink("/sign-in", redirectUrl, email);

	return (
		<AuthLayout>
			<div className="w-full max-w-[380px]">
				<div className="mb-8 text-center">
					<h1 className="text-xl font-semibold tracking-tight text-neutral-50">
						Create Your Proliferate Account
					</h1>
					<p className="mt-1.5 text-sm text-neutral-500">Get started with Proliferate for free</p>
				</div>

				{hasGoogleOAuth && (
					<>
						<Button
							variant="outline"
							className="h-10 w-full gap-2.5 rounded-lg border-neutral-800 bg-neutral-900/50 text-sm font-medium text-neutral-300 hover:bg-neutral-800/80 hover:text-neutral-100"
							onClick={handleGoogleSignIn}
							disabled={googleLoading || formLoading}
							type="button"
						>
							<GoogleIcon className="h-4 w-4" />
							{googleLoading ? "..." : "Google"}
						</Button>

						<div className="my-6 flex items-center gap-3">
							<div className="h-px flex-1 bg-neutral-800" />
							<span className="text-xs text-neutral-600">or</span>
							<div className="h-px flex-1 bg-neutral-800" />
						</div>
					</>
				)}

				<form onSubmit={handleEmailSignUp} className="space-y-4">
					<div className="space-y-1.5">
						<Label htmlFor="name" className="text-sm font-medium text-neutral-400">
							Name
						</Label>
						<Input
							id="name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Your name"
							required
							disabled={formLoading || googleLoading}
							className="h-10 rounded-lg border-neutral-800 bg-neutral-900/50 px-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus-visible:border-neutral-600 focus-visible:ring-0"
						/>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="email" className="text-sm font-medium text-neutral-400">
							Email
						</Label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="you@company.com"
							required
							disabled={formLoading || googleLoading}
							className="h-10 rounded-lg border-neutral-800 bg-neutral-900/50 px-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus-visible:border-neutral-600 focus-visible:ring-0"
						/>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="password" className="text-sm font-medium text-neutral-400">
							Password
						</Label>
						<div className="relative">
							<Input
								id="password"
								type={showPassword ? "text" : "password"}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="At least 8 characters"
								required
								disabled={formLoading || googleLoading}
								className="h-10 rounded-lg border-neutral-800 bg-neutral-900/50 px-3 pr-10 text-sm text-neutral-100 placeholder:text-neutral-600 focus-visible:border-neutral-600 focus-visible:ring-0"
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => setShowPassword(!showPassword)}
								className="absolute inset-y-0 right-0 h-full px-3 text-neutral-500 hover:bg-transparent hover:text-neutral-300"
							>
								{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
							</Button>
						</div>
					</div>

					<Button
						type="submit"
						className="h-10 w-full rounded-lg bg-neutral-100 text-sm font-medium text-neutral-950 hover:bg-white"
						disabled={formLoading || googleLoading}
					>
						{formLoading ? "Creating account..." : "Create account"}
					</Button>
				</form>

				<p className="mt-6 text-center text-sm text-neutral-500">
					Already have an account?{" "}
					<Link href={signInHref} className="text-neutral-300 transition-colors hover:text-white">
						Sign in
					</Link>
				</p>
			</div>
		</AuthLayout>
	);
}

export default function SignUpPage() {
	return (
		<Suspense
			fallback={
				<AuthLayout>
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-300" />
				</AuthLayout>
			}
		>
			<SignUpContent />
		</Suspense>
	);
}
