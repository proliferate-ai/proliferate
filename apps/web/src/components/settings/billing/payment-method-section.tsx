"use client";

import { SettingsCard, SettingsSection } from "@/components/settings/settings-row";
import { Button } from "@/components/ui/button";
import { useSetupPaymentMethod } from "@/hooks/org/use-billing";
import { CreditCard, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";

interface PaymentMethodSectionProps {
	hasPaymentMethod: boolean;
	isAdmin: boolean;
}

export function PaymentMethodSection({ hasPaymentMethod, isAdmin }: PaymentMethodSectionProps) {
	const setupPayment = useSetupPaymentMethod();
	const [error, setError] = useState<string | null>(null);

	const handleSetup = async () => {
		setError(null);
		try {
			const result = await setupPayment.mutateAsync({});
			if (result.checkoutUrl) {
				window.location.href = result.checkoutUrl;
			} else {
				window.location.reload();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to set up payment method");
		}
	};

	return (
		<SettingsSection title="Payment Method">
			<SettingsCard>
				<div className="p-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
								<CreditCard className="h-4 w-4 text-muted-foreground" />
							</div>
							<div>
								<p className="text-sm font-medium">
									{hasPaymentMethod ? "Card on file" : "No payment method"}
								</p>
								<p className="text-sm text-muted-foreground">
									{hasPaymentMethod
										? "You can purchase credits and enable auto-recharge."
										: "Add a card to buy credits or enable auto-recharge."}
								</p>
							</div>
						</div>
						{isAdmin && (
							<Button
								onClick={handleSetup}
								variant={hasPaymentMethod ? "outline" : "primary"}
								size="sm"
								disabled={setupPayment.isPending}
							>
								{setupPayment.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : hasPaymentMethod ? (
									<>
										<ExternalLink className="h-4 w-4 mr-1.5" />
										Update
									</>
								) : (
									<>
										<CreditCard className="h-4 w-4 mr-1.5" />
										Add Card
									</>
								)}
							</Button>
						)}
					</div>
					{error && <p className="text-sm text-destructive mt-2">{error}</p>}
				</div>
			</SettingsCard>
		</SettingsSection>
	);
}
