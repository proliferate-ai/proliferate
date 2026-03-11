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
import { TOP_UP_PACK_OPTIONS } from "@/config/billing";
import { useBuyCredits } from "@/hooks/org/use-billing";
import { cn } from "@/lib/display/utils";
import { CreditCard, Loader2, Plus } from "lucide-react";
import { useState } from "react";

export function BuyCreditsSection() {
	const [isOpen, setIsOpen] = useState(false);
	const defaultPack =
		TOP_UP_PACK_OPTIONS.find((p) => p.packId === "topup_20") ?? TOP_UP_PACK_OPTIONS[0];
	const [selectedPackId, setSelectedPackId] = useState(defaultPack.packId);
	const [error, setError] = useState<string | null>(null);
	const buyCredits = useBuyCredits();

	const selectedPack = TOP_UP_PACK_OPTIONS.find((p) => p.packId === selectedPackId) ?? defaultPack;

	const handleBuyCredits = async () => {
		setError(null);

		try {
			const result = await buyCredits.mutateAsync({ packId: selectedPackId });

			if (result.checkoutUrl) {
				window.location.href = result.checkoutUrl;
			} else {
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
								1 credit = $1 = ~1 hour of compute time. Credits never expire.
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
					if (!open) setSelectedPackId(defaultPack.packId);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Buy Credits</DialogTitle>
						<DialogDescription>
							Choose a credit pack. 1 credit = $1 = ~1 hour of compute time.
						</DialogDescription>
					</DialogHeader>

					<div className="py-4 space-y-2">
						{TOP_UP_PACK_OPTIONS.map((pack) => (
							<Button
								key={pack.packId}
								variant="outline"
								onClick={() => setSelectedPackId(pack.packId)}
								className={cn(
									"w-full h-auto flex items-center justify-between p-3",
									selectedPackId === pack.packId && "border-primary bg-primary/5",
								)}
							>
								<div className="text-left">
									<p className="text-sm font-medium">{pack.name}</p>
									<p className="text-xs text-muted-foreground">{pack.credits} credits</p>
								</div>
								<p className="text-sm font-semibold">{pack.price}</p>
							</Button>
						))}
					</div>

					{error && <p className="text-sm text-destructive text-center">{error}</p>}

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
									Buy {selectedPack.credits} credits for {selectedPack.price}
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</SettingsSection>
	);
}
