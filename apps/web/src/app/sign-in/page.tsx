"use client";

export const dynamic = "force-dynamic";

import { Button } from "@/components/ui/button";
import { Eye, EyeOff, GoogleIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
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
	const [formLoading, setFormLoading] = useState(false);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);

	// Get redirect URL from query params, default to dashboard
	const redirectUrl = searchParams.get("redirect") || "/dashboard";

	const hasGoogleOAuth = authProviders?.providers.google ?? false;

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
			<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950">
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
			</div>
		);
	}

	if (session) {
		return null;
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950 p-6">
			<div className="w-full max-w-[360px]">
				<div className="mb-7 text-center">
					<Text variant="h3">Welcome back</Text>
				</div>

				{hasGoogleOAuth && (
					<>
						<div className="space-y-2">
							<Button
								variant="outline"
								className="relative h-11 w-full justify-center gap-2.5 rounded-lg text-sm font-medium"
								onClick={handleGoogleSignIn}
								disabled={googleLoading || formLoading}
								type="button"
							>
								<GoogleIcon className="absolute left-4 h-5 w-5" />
								{googleLoading ? "Signing in..." : "Sign in with Google"}
							</Button>
						</div>

						<div className="my-6 flex items-center">
							<div className="h-px flex-1 bg-border" />
							<div className="h-px flex-1 bg-border" />
						</div>
					</>
				)}

				<form onSubmit={handleEmailSignIn} className="space-y-0">
					<div className="space-y-1">
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

					<div className="relative space-y-1 pt-2.5">
						<div className="flex items-center justify-between">
							<Label htmlFor="password" className="text-sm font-medium">
								Password
							</Label>
							<Link
								href="/auth/forgot-password"
								className="text-xs text-muted-foreground hover:text-foreground hover:underline"
							>
								Forgot your password?
							</Link>
						</div>
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
					</div>

					<div className="pt-4">
						<Button
							type="submit"
							variant="dark"
							className="h-11 w-full rounded-lg"
							disabled={formLoading || googleLoading}
						>
							{formLoading ? "Signing in..." : "Sign in"}
						</Button>
					</div>
				</form>

				<Text
					variant="small"
					color="muted"
					className="mt-4 flex items-center justify-center gap-1 text-sm"
				>
					Don&apos;t have an account?
					<Link
						href={
							redirectUrl !== "/dashboard"
								? `/sign-up?redirect=${encodeURIComponent(redirectUrl)}`
								: "/sign-up"
						}
						className="font-medium text-foreground underline hover:no-underline"
					>
						Sign up
					</Link>
				</Text>
			</div>
		</div>
	);
}

export default function SignInPage() {
	return (
		<Suspense
			fallback={
				<div className="flex min-h-screen items-center justify-center bg-background dark:bg-neutral-950">
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
				</div>
			}
		>
			<SignInContent />
		</Suspense>
	);
}
