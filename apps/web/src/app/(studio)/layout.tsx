"use client";

import { Button } from "@/components/ui/button";
import { useAttentionInbox } from "@/hooks/use-attention-inbox";
import { useBilling } from "@/hooks/use-billing";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { env } from "@proliferate/environment/public";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function StudioLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const router = useRouter();
	const { data: session, isPending: authPending } = useSession();
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
	const { data: billingInfo, isLoading: billingLoading, isError: billingError } = useBilling();
	const needsOnboarding = billingEnabled && billingInfo?.state.billingState === "unconfigured";

	const inboxItems = useAttentionInbox({ wsApprovals: [] });
	const inboxCount = inboxItems.length;

	// Redirect to sign-in if not authenticated
	useEffect(() => {
		if (!authPending && !session) {
			router.push("/sign-in");
		}
	}, [session, authPending, router]);

	// Redirect to verify-email if email not verified
	const requireEmailVerification = env.NEXT_PUBLIC_ENFORCE_EMAIL_VERIFICATION;
	useEffect(() => {
		if (!authPending && session && requireEmailVerification && !session.user?.emailVerified) {
			router.push("/auth/verify-email");
		}
	}, [session, authPending, router, requireEmailVerification]);

	// Keep onboarding/billing progression required
	useEffect(() => {
		if (!authPending && session && !billingLoading && needsOnboarding) {
			router.push("/onboarding");
		}
	}, [authPending, session, billingLoading, needsOnboarding, router]);

	// Wait for required gate checks before rendering anything
	if (authPending || (billingEnabled && (billingLoading || billingError))) {
		return <div className="min-h-screen bg-background" />;
	}

	if (!session) {
		return null;
	}

	if (needsOnboarding) {
		return null;
	}

	return (
		<div className="h-screen flex flex-col bg-background">
			{/* Minimal top bar — the only escape hatch to Command Center */}
			<header className="h-10 flex items-center justify-between px-3 border-b border-border shrink-0">
				<Link
					href="/dashboard"
					className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
				>
					Proliferate
				</Link>
				<Link href="/dashboard/inbox">
					<Button
						variant="ghost"
						size="sm"
						className={cn(
							"h-7 gap-1.5 text-xs font-medium",
							inboxCount > 0 ? "text-foreground" : "text-muted-foreground",
						)}
					>
						<Inbox className="h-3.5 w-3.5" />
						Inbox
						{inboxCount > 0 && (
							<span className="h-4 min-w-4 rounded-full bg-foreground text-background text-[10px] font-medium flex items-center justify-center px-1">
								{inboxCount > 99 ? "99+" : inboxCount}
							</span>
						)}
					</Button>
				</Link>
			</header>

			{/* Full-bleed studio content */}
			<div className="flex-1 min-h-0">{children}</div>
		</div>
	);
}
