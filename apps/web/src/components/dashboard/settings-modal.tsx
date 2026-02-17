"use client";

import type { Provider } from "@/components/integrations/provider-icon";
import {
	ConfigTab,
	ConnectionsTab,
	OrganizationTab,
	RepositoriesTab,
	SecretsTab,
} from "@/components/settings/tabs";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog, ResponsiveDialogContent } from "@/components/ui/responsive-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useGitHubAppConnect } from "@/hooks/use-github-app-connect";
import {
	type NangoProvider,
	shouldUseNangoForProvider,
	useNangoConnect,
} from "@/hooks/use-nango-connect";
import { cn } from "@/lib/utils";
import { env } from "@proliferate/environment/public";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, FolderGit2, Key, Link, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

type SettingsTab = "repositories" | "connections" | "secrets" | "organization" | "configuration";

interface SettingsModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultTab?: SettingsTab;
}

export function SettingsModal({
	open,
	onOpenChange,
	defaultTab = "repositories",
}: SettingsModalProps) {
	const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);
	const queryClient = useQueryClient();
	const integrationsEnabled = env.NEXT_PUBLIC_INTEGRATIONS_ENABLED;

	// Sync activeTab when defaultTab changes (e.g., when opening modal from URL params)
	useEffect(() => {
		setActiveTab(defaultTab);
	}, [defaultTab]);

	useEffect(() => {
		if (!integrationsEnabled && activeTab === "connections") {
			setActiveTab("repositories");
		}
	}, [integrationsEnabled, activeTab]);

	// Nango connect hook for Linear/Sentry (not GitHub)
	const {
		connect: nangoConnect,
		disconnect: nangoDisconnect,
		loadingProvider: nangoLoadingProvider,
	} = useNangoConnect({
		flow: "auth",
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["integrations"] });
		},
	});

	// GitHub App connect hook (GitHub no longer uses Nango)
	const {
		connect: githubConnect,
		disconnect: githubDisconnect,
		isLoading: githubLoading,
	} = useGitHubAppConnect({
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["integrations"] });
			queryClient.invalidateQueries({ queryKey: ["onboarding"] });
		},
	});

	// Combined connect/disconnect functions that route to the correct handler
	// Uses shouldUseNangoForProvider to determine which flow to use for GitHub
	const connect = async (provider: Provider) => {
		if (shouldUseNangoForProvider(provider)) {
			await nangoConnect(provider as NangoProvider);
		} else {
			await githubConnect();
		}
	};

	const disconnect = async (provider: Provider, integrationId: string) => {
		if (shouldUseNangoForProvider(provider)) {
			await nangoDisconnect(provider as NangoProvider, integrationId);
		} else {
			await githubDisconnect(integrationId);
		}
	};

	const loadingProvider: Provider | null = githubLoading ? "github" : nangoLoadingProvider;

	// Reset tab when modal closes
	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) {
			setActiveTab(defaultTab);
		}
		onOpenChange(newOpen);
	};

	const tabs = [
		{ id: "repositories" as const, label: "Repositories", icon: FolderGit2 },
		...(integrationsEnabled
			? [{ id: "connections" as const, label: "Connections", icon: Link }]
			: []),
		{ id: "secrets" as const, label: "Secrets", icon: Key },
		{ id: "organization" as const, label: "Organization", icon: Building2 },
		{ id: "configuration" as const, label: "Configuration", icon: SlidersHorizontal },
	];

	return (
		<ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
			<ResponsiveDialogContent className="max-w-3xl max-h-[90vh] md:max-h-[80vh] p-0 gap-0">
				<div className="flex flex-col md:flex-row h-[85vh] md:h-[70vh]">
					{/* Tabs - Compact icons on mobile, Vertical with labels on desktop */}
					<div className="md:w-48 border-b md:border-b-0 md:border-r border-border bg-muted/30 p-2 flex flex-col shrink-0">
						<h2 className="text-lg font-semibold px-3 py-2 hidden md:block mb-2">Settings</h2>
						<nav className="flex md:flex-col gap-1 justify-around md:justify-start">
							{tabs.map((tab) => (
								<TooltipProvider key={tab.id} delayDuration={0}>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												onClick={() => setActiveTab(tab.id)}
												className={cn(
													"justify-center md:justify-start gap-2 px-3 py-2 text-sm h-auto",
													"md:w-full",
													activeTab === tab.id
														? "bg-background text-foreground font-medium shadow-sm"
														: "text-muted-foreground hover:text-foreground hover:bg-background/50",
												)}
											>
												<tab.icon className="h-4 w-4" />
												<span className="hidden md:inline">{tab.label}</span>
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom" className="md:hidden">
											{tab.label}
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							))}
						</nav>
					</div>

					{/* Tab Content */}
					<div className="flex-1 overflow-y-auto p-4 md:p-6">
						{activeTab === "repositories" && (
							<RepositoriesTab onClose={() => handleOpenChange(false)} />
						)}
						{activeTab === "connections" && integrationsEnabled && (
							<ConnectionsTab
								connect={connect}
								disconnect={disconnect}
								loadingProvider={loadingProvider}
							/>
						)}
						{activeTab === "secrets" && <SecretsTab />}
						{activeTab === "organization" && <OrganizationTab />}
						{activeTab === "configuration" && <ConfigTab />}
					</div>
				</div>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
