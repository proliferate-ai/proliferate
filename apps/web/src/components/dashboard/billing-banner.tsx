"use client";

import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useBillingState } from "@/hooks/use-billing";
import { env } from "@proliferate/environment/public";
import { AlertOctagon, AlertTriangle, Clock, CreditCard, X } from "lucide-react";
import { useState } from "react";

export function BillingBanner() {
	const billingEnabled = env.NEXT_PUBLIC_BILLING_ENABLED;
	const {
		isLoaded,
		hasCredits,
		creditBalance,
		hasActiveSubscription,
		isNearCreditLimit,
		overagePolicy,
		// V2 state fields
		billingState,
		graceExpiresAt,
	} = useBillingState();
	const [dismissed, setDismissed] = useState(false);

	// Don't show anything while loading or if dismissed
	if (!billingEnabled || !isLoaded || dismissed) {
		return null;
	}

	// V2 Priority 1: Suspended - critical, non-dismissable
	if (billingState === "suspended") {
		return (
			<div className="bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<AlertOctagon className="h-4 w-4" />
					<Text variant="small" className="font-medium">
						Account suspended. Contact support to resolve billing issues.
					</Text>
				</div>
				<Button
					variant="ghost"
					size="sm"
					asChild
					className="h-7 px-3 bg-destructive-foreground/10 hover:bg-destructive-foreground/20 text-destructive-foreground"
				>
					<a href="mailto:support@proliferate.com">Contact Support</a>
				</Button>
			</div>
		);
	}

	// V2 Priority 2: Exhausted - critical, non-dismissable
	if (billingState === "exhausted") {
		const message = hasActiveSubscription
			? "Credits exhausted. Add credits to resume sessions."
			: "Trial credits exhausted. Activate your plan to continue.";
		return (
			<div className="bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<AlertTriangle className="h-4 w-4" />
					<Text variant="small" className="font-medium">
						{message}
					</Text>
				</div>
				<Button
					variant="ghost"
					size="sm"
					asChild
					className="h-7 px-3 bg-destructive-foreground/10 hover:bg-destructive-foreground/20 text-destructive-foreground"
				>
					<a href="/settings/billing">
						<CreditCard className="h-4 w-4 mr-1" />
						{hasActiveSubscription ? "Add Credits" : "Activate Plan"}
					</a>
				</Button>
			</div>
		);
	}

	// V2 Priority 3: Grace period - urgent warning
	if (billingState === "grace") {
		const graceExpiryLabel = graceExpiresAt
			? new Intl.DateTimeFormat(undefined, {
					hour: "numeric",
					minute: "2-digit",
				}).format(new Date(graceExpiresAt))
			: null;

		return (
			<div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Clock className="h-4 w-4" />
					<Text variant="small" className="font-medium">
						Credits exhausted. Grace period active
						{graceExpiryLabel ? ` until ${graceExpiryLabel}` : ""}. Add credits to continue.
					</Text>
				</div>
				<Button
					variant="ghost"
					size="sm"
					asChild
					className="h-7 px-3 bg-amber-600 hover:bg-amber-700 text-amber-950"
				>
					<a href="/settings/billing">
						<CreditCard className="h-4 w-4 mr-1" />
						Add Credits Now
					</a>
				</Button>
			</div>
		);
	}

	// Priority 4: No credits (legacy check)
	if (!hasCredits) {
		return (
			<div className="bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<AlertTriangle className="h-4 w-4" />
					<Text variant="small" className="font-medium">
						You've run out of credits. Add credits to continue using sessions.
					</Text>
				</div>
				<Button
					variant="ghost"
					size="sm"
					asChild
					className="h-7 px-3 bg-destructive-foreground/10 hover:bg-destructive-foreground/20 text-destructive-foreground"
				>
					<a href="/settings/billing">
						<CreditCard className="h-4 w-4 mr-1" />
						Add Credits
					</a>
				</Button>
			</div>
		);
	}

	// Priority 5: Low credits warning (only for subscribed users without auto-reload)
	if (isNearCreditLimit && hasActiveSubscription && overagePolicy !== "allow") {
		return (
			<div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<AlertTriangle className="h-4 w-4" />
					<Text variant="small" className="font-medium">
						Running low on credits ({creditBalance} remaining).
					</Text>
				</div>
				<div className="flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						asChild
						className="h-7 px-3 bg-amber-600 hover:bg-amber-700 text-amber-950"
					>
						<a href="/settings/billing">
							<CreditCard className="h-4 w-4 mr-1" />
							Add Credits
						</a>
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => setDismissed(true)}
						className="h-7 w-7 text-amber-950 hover:bg-amber-600"
						aria-label="Dismiss"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>
			</div>
		);
	}

	// No banner needed
	return null;
}
