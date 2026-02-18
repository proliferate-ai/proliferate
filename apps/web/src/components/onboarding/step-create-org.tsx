"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { organization } from "@/lib/auth-client";
import { useOnboardingStore } from "@/stores/onboarding";
import { useState } from "react";
import { OnboardingCardImage } from "./onboarding-card-image";

interface StepCreateOrgProps {
	onComplete: () => void;
}

export function StepCreateOrg({ onComplete }: StepCreateOrgProps) {
	const orgName = useOnboardingStore((s) => s.orgName);
	const setOrgName = useOnboardingStore((s) => s.setOrgName);
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		if (!orgName.trim()) {
			setError("Organization name is required");
			return;
		}

		setIsCreating(true);
		setError(null);

		try {
			const slug = orgName
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "");

			const result = await organization.create({
				name: orgName.trim(),
				slug: `${slug}-${Date.now().toString(36)}`,
			});

			if (result.error) {
				setError(result.error.message || "Failed to create organization");
				return;
			}

			// Set the new org as active
			if (result.data?.id) {
				await organization.setActive({ organizationId: result.data.id });
			}

			onComplete();
		} catch (err) {
			console.error("Failed to create organization:", err);
			setError("Failed to create organization");
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<div className="w-[480px]">
			{/* Card with image */}
			<div className="rounded-2xl overflow-hidden border border-border">
				{/* Image Area */}
				<OnboardingCardImage src="/colloseum.png" alt="Create organization" label="Organization" />

				{/* Form Content */}
				<div className="p-6 bg-card">
					<div className="mb-5 text-center">
						<h1 className="text-xl font-semibold text-foreground">Create your organization</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							Give your team a name. You can invite members after setup.
						</p>
					</div>

					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="space-y-1">
							<Input
								placeholder="Acme Inc"
								value={orgName}
								onChange={(e) => {
									setOrgName(e.target.value);
									if (error) setError(null);
								}}
								disabled={isCreating}
								autoFocus
								className="h-11 rounded-lg px-4 text-sm"
							/>
							{error && <p className="text-sm text-destructive">{error}</p>}
						</div>

						<Button
							type="submit"
							variant="dark"
							className="h-11 w-full rounded-lg"
							disabled={isCreating || !orgName.trim()}
						>
							{isCreating ? (
								<>
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									Creating...
								</>
							) : (
								"Continue"
							)}
						</Button>
					</form>
				</div>
			</div>
		</div>
	);
}
