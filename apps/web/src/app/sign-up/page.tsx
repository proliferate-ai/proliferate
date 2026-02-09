"use client";

export const dynamic = "force-dynamic";

import { Button } from "@/components/ui/button";
import { Eye, EyeOff, GithubIcon, GoogleIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useAuthProviders } from "@/hooks/use-auth-providers";
import { signIn, signUp, useSession } from "@/lib/auth-client";
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
	const [githubLoading, setGithubLoading] = useState(false);
	const [formLoading, setFormLoading] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);

	// Get redirect URL from query params, default to dashboard
	const redirectUrl = searchParams.get("redirect") || "/dashboard";

	const hasGoogleOAuth = authProviders?.providers.google ?? false;
	const hasGitHubOAuth = authProviders?.providers.github ?? false;
	const hasAnySocialOAuth = hasGoogleOAuth || hasGitHubOAuth;

	useEffect(() => {
		if (session && !isPending) {
			if (!session.user?.emailVerified && REQUIRE_EMAIL_VERIFICATION) {
				router.push(`/auth/verify-email?email=${encodeURIComponent(session.user.email)}`);
				return;
			}
			router.push(redirectUrl);
		}
	}, [session, isPending, router, redirectUrl]);

	const handleGoogleSignIn = async () => {
		setGoogleLoading(true);
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

	const handleGitHubSignIn = async () => {
		setGithubLoading(true);
		try {
			await signIn.social({
				provider: "github",
				callbackURL: redirectUrl,
			});
		} catch (err) {
			console.error("GitHub sign up failed:", err);
			toast.error("GitHub sign up failed. Please try again.");
			setGithubLoading(false);
		}
	};

	const handleEmailSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		setFormLoading(true);

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
			<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950">
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
			</div>
		);
	}

	if (session) {
		return null;
	}

	// Build sign-in link with redirect param preserved
	const signInHref =
		redirectUrl !== "/dashboard"
			? `/sign-in?redirect=${encodeURIComponent(redirectUrl)}`
			: "/sign-in";

	return (
		<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950 p-6">
			<div className="w-full max-w-[360px]">
				<div className="mb-7 text-center">
					<Text variant="h3">Create your account</Text>
				</div>

				{hasAnySocialOAuth && (
					<>
						<div className="space-y-2">
							{hasGoogleOAuth && (
								<Button
									variant="outline"
									className="relative h-11 w-full justify-center gap-2.5 rounded-lg text-sm font-medium"
									onClick={handleGoogleSignIn}
									disabled={googleLoading || githubLoading || formLoading}
									type="button"
								>
									<GoogleIcon className="absolute left-4 h-5 w-5" />
									{googleLoading ? "Signing up..." : "Sign up with Google"}
								</Button>
							)}
							{hasGitHubOAuth && (
								<Button
									variant="outline"
									className="relative h-11 w-full justify-center gap-2.5 rounded-lg text-sm font-medium"
									onClick={handleGitHubSignIn}
									disabled={githubLoading || googleLoading || formLoading}
									type="button"
								>
									<GithubIcon className="absolute left-4 h-5 w-5" />
									{githubLoading ? "Signing up..." : "Sign up with GitHub"}
								</Button>
							)}
						</div>

						<div className="my-6 flex items-center">
							<div className="h-px flex-1 bg-border" />
							<div className="h-px flex-1 bg-border" />
						</div>
					</>
				)}

				<form onSubmit={handleEmailSignUp} className="space-y-0">
					<div className="space-y-1">
						<Label htmlFor="name" className="text-sm font-medium">
							Name
						</Label>
						<Input
							id="name"
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder=""
							required
							disabled={formLoading || googleLoading}
							className="h-11 rounded-lg px-4 text-sm"
						/>
					</div>

					<div className="space-y-1 pt-2.5">
						<Label htmlFor="email" className="text-sm font-medium">
							Email
						</Label>
						<Input
							id="email"
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder=""
							required
							disabled={formLoading || googleLoading}
							className="h-11 rounded-lg px-4 text-sm"
						/>
					</div>

					<div className="space-y-1 pt-2.5">
						<Label htmlFor="password" className="text-sm font-medium">
							Password
						</Label>
						<div className="relative">
							<Input
								id="password"
								type={showPassword ? "text" : "password"}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder=""
								required
								disabled={formLoading || googleLoading}
								className="h-11 rounded-lg px-4 pr-10 text-sm"
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={() => setShowPassword(!showPassword)}
								className="absolute inset-y-0 right-0 h-full px-4 text-muted-foreground hover:text-foreground"
							>
								{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
							</Button>
						</div>
						<Text variant="small" color="muted" className="text-xs">
							At least 8 characters
						</Text>
					</div>

					<div className="pt-4">
						<Button
							type="submit"
							variant="dark"
							className="h-11 w-full rounded-lg"
							disabled={formLoading || googleLoading}
						>
							{formLoading ? "Creating account..." : "Create account"}
						</Button>
					</div>
				</form>

				<Text
					variant="small"
					color="muted"
					className="mt-4 flex items-center justify-center gap-1 text-sm"
				>
					Already have an account?
					<Link
						href={signInHref}
						className="font-medium text-foreground underline hover:no-underline"
					>
						Sign in
					</Link>
				</Text>
			</div>
		</div>
	);
}

export default function SignUpPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950">
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
				</div>
			}
		>
			<SignUpContent />
		</Suspense>
	);
}
