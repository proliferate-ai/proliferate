"use client";

import { SettingsCard, SettingsSection } from "@/components/settings/settings-row";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useBuyCredits } from "@/hooks/use-billing";
import { CreditCard, Loader2, Minus, Plus } from "lucide-react";
import { useState } from "react";

const CREDITS_PER_PACK = 500;
const PRICE_PER_PACK = 5;
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 10;

export function BuyCreditsSection() {
	const [isOpen, setIsOpen] = useState(false);
	const [quantity, setQuantity] = useState(1);
	const [error, setError] = useState<string | null>(null);
	const buyCredits = useBuyCredits();

	const totalCredits = quantity * CREDITS_PER_PACK;
	const totalPrice = quantity * PRICE_PER_PACK;

	const handleBuyCredits = async () => {
		setError(null);

		try {
			const result = await buyCredits.mutateAsync({ quantity });

			if (result.checkoutUrl) {
				window.location.href = result.checkoutUrl;
			} else {
				// Credits added directly, refresh the page
				window.location.reload();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to purchase credits");
		}
	};

	return (
		<SettingsSection title="Buy Credits">
			<SettingsCard>
				<div className="p-4">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm font-medium">Need more credits?</p>
							<p className="text-sm text-muted-foreground">
								Purchase additional credits anytime. Credits never expire.
							</p>
						</div>
						<Button onClick={() => setIsOpen(true)} variant="outline" size="sm">
							<Plus className="h-4 w-4 mr-1.5" />
							Buy Credits
						</Button>
					</div>
				</div>
			</SettingsCard>

			<Dialog
				open={isOpen}
				onOpenChange={(open) => {
					setIsOpen(open);
					if (!open) setQuantity(1);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Buy Credits</DialogTitle>
						<DialogDescription>
							Add credits to your account for compute time and AI usage.
						</DialogDescription>
					</DialogHeader>

					<div className="py-6">
						<div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
							<div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
								<CreditCard className="h-6 w-6 text-primary" />
							</div>
							<p className="text-3xl font-bold">{totalCredits.toLocaleString()}</p>
							<p className="text-sm text-muted-foreground mb-4">credits</p>

							<div className="flex items-center justify-center gap-3 mb-4">
								<Button
									variant="outline"
									size="icon"
									className="h-8 w-8"
									onClick={() => setQuantity((q) => Math.max(MIN_QUANTITY, q - 1))}
									disabled={quantity <= MIN_QUANTITY}
								>
									<Minus className="h-4 w-4" />
								</Button>
								<span className="text-lg font-medium w-16 text-center tabular-nums">
									{quantity}x
								</span>
								<Button
									variant="outline"
									size="icon"
									className="h-8 w-8"
									onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
									disabled={quantity >= MAX_QUANTITY}
								>
									<Plus className="h-4 w-4" />
								</Button>
							</div>

							<p className="text-2xl font-semibold">${totalPrice}</p>
							<p className="text-xs text-muted-foreground mt-1">
								{quantity === 1
									? "one-time purchase"
									: `${quantity} packs of ${CREDITS_PER_PACK} credits`}
							</p>
						</div>

						<div className="mt-4 space-y-2 text-sm text-muted-foreground">
							<div className="flex items-start gap-2">
								<span className="text-primary">•</span>
								<span>1 credit = 1 minute of compute time</span>
							</div>
							<div className="flex items-start gap-2">
								<span className="text-primary">•</span>
								<span>Credits also cover AI model usage</span>
							</div>
							<div className="flex items-start gap-2">
								<span className="text-primary">•</span>
								<span>Credits never expire</span>
							</div>
						</div>

						{error && <p className="mt-4 text-sm text-destructive text-center">{error}</p>}
					</div>

					<DialogFooter className="gap-2 sm:gap-0">
						<Button
							variant="outline"
							onClick={() => setIsOpen(false)}
							disabled={buyCredits.isPending}
						>
							Cancel
						</Button>
						<Button onClick={handleBuyCredits} disabled={buyCredits.isPending}>
							{buyCredits.isPending ? (
								<>
									<Loader2 className="h-4 w-4 mr-2 animate-spin" />
									Processing...
								</>
							) : (
								<>
									<CreditCard className="h-4 w-4 mr-2" />
									Buy for ${totalPrice}
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</SettingsSection>
	);
}
