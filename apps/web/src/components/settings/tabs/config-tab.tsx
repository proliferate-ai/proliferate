"use client";

import { Badge } from "@/components/ui/badge";
import { LoadingDots } from "@/components/ui/loading-dots";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import type { EnvStatus, RequirementScope } from "@proliferate/environment";
import { useQuery } from "@tanstack/react-query";

const scopeLabel: Record<RequirementScope, string> = {
	core: "Core",
	feature: "Feature",
	cloud: "Cloud",
};

const scopeClasses: Record<RequirementScope, string> = {
	core: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200",
	feature: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
	cloud: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200",
};

export function ConfigTab() {
	const { data, isLoading, error } = useQuery<EnvStatus>({
		queryKey: ["config-status"],
		queryFn: async () => {
			const response = await fetch("/api/config/status");
			if (!response.ok) {
				throw new Error("Failed to load configuration status");
			}
			return (await response.json()) as EnvStatus;
		},
	});

	if (isLoading) {
		return (
			<div className="py-6 flex items-center justify-center">
				<LoadingDots size="md" className="text-muted-foreground" />
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="space-y-2">
				<Text variant="h4" className="text-lg">
					Configuration
				</Text>
				<Text variant="body" color="destructive" className="text-sm">
					Unable to load configuration status.
				</Text>
			</div>
		);
	}

	const missing = data.missing ?? [];
	const grouped = missing.reduce<Record<RequirementScope, typeof missing>>(
		(acc, item) => {
			acc[item.scope].push(item);
			return acc;
		},
		{ core: [], feature: [], cloud: [] },
	);

	const hasMissing = missing.length > 0;

	return (
		<div className="space-y-4">
			<div className="space-y-1">
				<Text variant="h4" className="text-lg">
					Configuration
				</Text>
				<Text variant="body" color="muted" className="text-sm">
					{hasMissing
						? "Some required environment variables are missing for this deployment."
						: "All required environment variables are set for this deployment."}
				</Text>
			</div>

			<div className="flex flex-wrap gap-2 text-xs">
				<Badge variant="outline">Profile: {data.profile}</Badge>
				{data.features.billingEnabled && <Badge variant="outline">Billing enabled</Badge>}
				{data.features.emailEnabled && <Badge variant="outline">Email enabled</Badge>}
				{data.features.integrationsEnabled && <Badge variant="outline">Integrations enabled</Badge>}
				{data.features.llmProxyEnabled && <Badge variant="outline">LLM proxy enabled</Badge>}
			</div>

			{hasMissing ? (
				<div className="space-y-3">
					{(Object.keys(grouped) as RequirementScope[]).map((scope) => {
						if (grouped[scope].length === 0) return null;
						return (
							<div key={scope} className="space-y-2">
								<div className="flex items-center gap-2">
									<span
										className={cn("px-2 py-1 rounded text-xs font-medium", scopeClasses[scope])}
									>
										{scopeLabel[scope]}
									</span>
									<Text variant="small" color="muted" className="text-xs">
										{scope === "core"
											? "Required for the app to run."
											: scope === "feature"
												? "Required because a feature is enabled."
												: "Required in cloud deployments."}
									</Text>
								</div>
								<div className="space-y-2">
									{grouped[scope].map((item) => (
										<div
											key={item.key}
											className="flex items-start justify-between gap-3 rounded border border-border px-3 py-2"
										>
											<div className="space-y-1">
												<div className="font-mono text-sm">{item.key}</div>
												<Text variant="small" color="muted" className="text-xs">
													{item.reason}
												</Text>
											</div>
											{item.secret && (
												<span className="text-[10px] px-2 py-1 rounded bg-muted text-muted-foreground">
													secret
												</span>
											)}
										</div>
									))}
								</div>
							</div>
						);
					})}
					<Text variant="small" color="muted" className="text-xs">
						See{" "}
						<a
							href="https://docs.proliferate.com/self-hosting/environment"
							target="_blank"
							rel="noreferrer"
							className="underline underline-offset-2"
						>
							docs.proliferate.com/self-hosting/environment
						</a>{" "}
						for required variables by deployment mode.
					</Text>
					<Text variant="small" color="muted" className="text-xs">
						Updating environment variables requires a service restart. Changes to{" "}
						<span className="font-mono">NEXT_PUBLIC_*</span> values require rebuilding the web app.
					</Text>
				</div>
			) : (
				<Text variant="small" color="muted" className="text-xs">
					No missing configuration detected.
				</Text>
			)}
		</div>
	);
}
