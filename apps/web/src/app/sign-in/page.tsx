"use client";

export const dynamic = "force-dynamic";

import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, GithubIcon, GoogleIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthProviders } from "@/hooks/use-auth-providers";
import { signIn, useSession } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

function SignInContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { data: session, isPending } = useSession();
	const { data: authProviders } = useAuthProviders();
	const [googleLoading, setGoogleLoading] = useState(false);
	const [githubLoading, setGithubLoading] = useState(false);
	const [formLoading, setFormLoading] = useState(false);
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
			console.error("Google sign in failed:", err);
			toast.error("Google sign in failed. Please try again.");
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
			console.error("GitHub sign in failed:", err);
			toast.error("GitHub sign in failed. Please try again.");
			setGithubLoading(false);
		}
	};

	const handleEmailSignIn = async (e: React.FormEvent) => {
		e.preventDefault();
		setFormLoading(true);
		try {
			const result = await signIn.email({ email, password });
			if (result.error) {
				toast.error(result.error.message || "Invalid email or password");
				setFormLoading(false);
			} else {
				router.push(redirectUrl);
			}
		} catch (err) {
			toast.error("Sign in failed. Please try again.");
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

	return (
		<AuthLayout>
			<div className="w-full max-w-[380px]">
				<div className="mb-8 text-center">
					<h1 className="text-xl font-semibold tracking-tight text-neutral-50">Welcome back</h1>
					<p className="mt-1.5 text-sm text-neutral-500">Sign in to your account to continue</p>
				</div>

				{hasAnySocialOAuth && (
					<>
						<div className="flex items-center gap-3">
							{hasGoogleOAuth && (
								<Button
									variant="outline"
									className="h-10 flex-1 gap-2.5 rounded-lg border-neutral-800 bg-neutral-900/50 text-sm font-medium text-neutral-300 hover:bg-neutral-800/80 hover:text-neutral-100"
									onClick={handleGoogleSignIn}
									disabled={googleLoading || githubLoading || formLoading}
									type="button"
								>
									<GoogleIcon className="h-4 w-4" />
									{googleLoading ? "..." : "Google"}
								</Button>
							)}
							{hasGitHubOAuth && (
								<Button
									variant="outline"
									className="h-10 flex-1 gap-2.5 rounded-lg border-neutral-800 bg-neutral-900/50 text-sm font-medium text-neutral-300 hover:bg-neutral-800/80 hover:text-neutral-100"
									onClick={handleGitHubSignIn}
									disabled={githubLoading || googleLoading || formLoading}
									type="button"
								>
									<GithubIcon className="h-4 w-4" />
									{githubLoading ? "..." : "GitHub"}
								</Button>
							)}
						</div>

						<div className="my-6 flex items-center gap-3">
							<div className="h-px flex-1 bg-neutral-800" />
							<span className="text-xs text-neutral-600">or</span>
							<div className="h-px flex-1 bg-neutral-800" />
						</div>
					</>
				)}

				<form onSubmit={handleEmailSignIn} className="space-y-4">
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
							disabled={formLoading || googleLoading || githubLoading}
							className="h-10 rounded-lg border-neutral-800 bg-neutral-900/50 px-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus-visible:border-neutral-600 focus-visible:ring-0"
						/>
					</div>

					<div className="space-y-1.5">
						<div className="flex items-center justify-between">
							<Label htmlFor="password" className="text-sm font-medium text-neutral-400">
								Password
							</Label>
							<Link
								href="/auth/forgot-password"
								className="text-xs text-neutral-500 transition-colors hover:text-neutral-300"
							>
								Forgot password?
							</Link>
						</div>
						<div className="relative">
							<Input
								id="password"
								type={showPassword ? "text" : "password"}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								disabled={formLoading || googleLoading || githubLoading}
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
						disabled={formLoading || googleLoading || githubLoading}
					>
						{formLoading ? "Signing in..." : "Sign in"}
					</Button>
				</form>

				<p className="mt-6 text-center text-sm text-neutral-500">
					Don&apos;t have an account?{" "}
					<Link
						href={
							redirectUrl !== "/dashboard"
								? `/sign-up?redirect=${encodeURIComponent(redirectUrl)}`
								: "/sign-up"
						}
						className="text-neutral-300 transition-colors hover:text-white"
					>
						Sign up
					</Link>
				</p>
			</div>
		</AuthLayout>
	);
}

export default function SignInPage() {
	return (
		<Suspense
			fallback={
				<AuthLayout>
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-300" />
				</AuthLayout>
			}
		>
			<SignInContent />
		</Suspense>
	);
}
