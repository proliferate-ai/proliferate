"use client";

import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { sendVerificationEmail, useSession } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

// ─── Mail Illustration ───────────────────────────────────────────────────────

const MailIllustration = () => (
	<svg xmlns="http://www.w3.org/2000/svg" width="66" height="66" viewBox="0 0 66 66" fill="none">
		{/* Envelope body */}
		<rect
			x="6"
			y="16"
			width="54"
			height="38"
			rx="5"
			fill="#1a1a1a"
			stroke="#333"
			strokeWidth="1.5"
		/>
		{/* Flap */}
		<path d="M6 21L33 40L60 21" stroke="#333" strokeWidth="1.5" strokeLinejoin="round" />
		{/* Bottom fold lines */}
		<path
			d="M6 54L24 38"
			stroke="#333"
			strokeWidth="1"
			strokeLinecap="round"
			strokeDasharray="3 3"
		/>
		<path
			d="M60 54L42 38"
			stroke="#333"
			strokeWidth="1"
			strokeLinecap="round"
			strokeDasharray="3 3"
		/>
		{/* Letter peeking out */}
		<rect x="16" y="8" width="34" height="28" rx="3" fill="#111" stroke="#333" strokeWidth="1.2" />
		<path d="M24 16H42" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
		<path d="M24 22H38" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
		<path d="M24 28H34" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
	</svg>
);

const CheckBadge = () => (
	<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
		<path
			d="M10 18.333C14.602 18.333 18.333 14.602 18.333 10C18.333 5.398 14.602 1.667 10 1.667C5.398 1.667 1.667 5.398 1.667 10C1.667 14.602 5.398 18.333 10 18.333Z"
			stroke="currentColor"
			strokeWidth="1.5"
		/>
		<path
			d="M7 10L9.5 12.5L13.5 7.5"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

// ─── Page ────────────────────────────────────────────────────────────────────

function VerifyEmailContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { data: session, isPending } = useSession();

	const emailFromQuery = searchParams.get("email");
	const redirectUrl = searchParams.get("redirect") || "/dashboard";
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

	if (isPending) {
		return (
			<AuthLayout>
				<div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-300" />
			</AuthLayout>
		);
	}

	if (session?.user?.emailVerified) {
		return null;
	}

	return (
		<AuthLayout>
			<div className="w-full max-w-[380px]">
				{/* Illustration + badge */}
				<div className="mb-6 flex justify-center">
					<div className="relative flex flex-col items-center">
						<MailIllustration />
						{/* Shadow */}
						<div className="mt-1 h-1.5 w-6 rounded-full bg-neutral-800 scale-x-[2]" />
						{/* Badge */}
						<div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-950 text-neutral-500">
							<CheckBadge />
						</div>
					</div>
				</div>

				{/* Header */}
				<div className="mb-6 text-center">
					<h1 className="text-xl font-semibold tracking-tight text-neutral-50">Check your email</h1>
					<p className="mt-1.5 text-sm text-neutral-500">
						{email ? (
							<>
								We sent a verification link to <span className="text-neutral-300">{email}</span>
							</>
						) : (
							"We sent a verification link to your email"
						)}
					</p>
				</div>

				{/* Card */}
				<div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
					<p className="mb-4 text-center text-xs text-neutral-500">
						Click the link in the email to verify your account. Check spam if you don&apos;t see it.
					</p>

					{resent && (
						<p className="mb-3 text-center text-xs text-green-500">Verification email sent!</p>
					)}
					{error && <p className="mb-3 text-center text-xs text-destructive">{error}</p>}

					<div className="space-y-2">
						{email && (
							<Button
								variant="light"
								size="lg"
								className="w-full"
								onClick={handleResend}
								disabled={isResending || resent}
								type="button"
							>
								{isResending ? "Sending..." : resent ? "Email sent" : "Resend verification email"}
							</Button>
						)}
						<Link
							href="/sign-in"
							className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md text-sm text-neutral-500 transition-colors hover:text-neutral-300"
						>
							Back to sign in
						</Link>
					</div>
				</div>
			</div>
		</AuthLayout>
	);
}

export default function VerifyEmailPage() {
	return (
		<Suspense
			fallback={
				<AuthLayout>
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-300" />
				</AuthLayout>
			}
		>
			<VerifyEmailContent />
		</Suspense>
	);
}
