"use client";

import { ConfigurationStatusBadges } from "@/components/dashboard/configuration-lifecycle";
import {
	GearIllustration,
	InfoBadge,
	PageEmptyState,
	PlusBadge,
} from "@/components/dashboard/page-empty-state";
import { PageShell } from "@/components/dashboard/page-shell";
import { CreateSnapshotContent } from "@/components/dashboard/snapshot-selector";
import { GitHubConnectButton } from "@/components/integrations/github-connect-button";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LoadingDots } from "@/components/ui/loading-dots";
import { useConfigurations } from "@/hooks/use-configurations";
import { useIntegrations } from "@/hooks/use-integrations";
import { getSetupInitialPrompt } from "@/lib/prompts";
import { useDashboardStore } from "@/stores/dashboard";
import type { Configuration } from "@proliferate/shared/contracts";
import { formatDistanceToNow } from "date-fns";
import { FolderGit2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

// ============================================
// Main Page
// ============================================

const STATUS_ORDER: Record<string, number> = { ready: 0, default: 1, building: 2, failed: 3 };

export default function ConfigurationsPage() {
	const router = useRouter();
	const { data: configurations, isLoading } = useConfigurations();
	const { data: integrationsData } = useIntegrations();
	const { setPendingPrompt } = useDashboardStore();
	const [filterQuery, setFilterQuery] = useState("");
	const [createOpen, setCreateOpen] = useState(false);

	const hasGitHub = integrationsData?.github?.connected ?? false;

	const configList = useMemo(() => {
		let list = configurations ?? [];
		if (filterQuery) {
			const q = filterQuery.toLowerCase();
			list = list.filter((c) => (c.name ?? "").toLowerCase().includes(q));
		}
		return [...list].sort(
			(a, b) => (STATUS_ORDER[a.status ?? ""] ?? 2) - (STATUS_ORDER[b.status ?? ""] ?? 2),
		);
	}, [configurations, filterQuery]);

	if (isLoading) {
		return (
			<PageShell title="Configurations" subtitle="Configure environments for your projects.">
				<div className="py-12 flex justify-center">
					<LoadingDots size="md" className="text-muted-foreground" />
				</div>
			</PageShell>
		);
	}

	const hasConfigs = (configurations ?? []).length > 0;
	const hasResults = configList.length > 0;

	return (
		<PageShell
			title="Configurations"
			subtitle="Configure environments for your projects."
			actions={
				<div className="flex items-center gap-2">
					{hasConfigs && (
						<div className="relative">
							<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
							<Input
								value={filterQuery}
								onChange={(e) => setFilterQuery(e.target.value)}
								placeholder="Search configurations..."
								className="pl-8 h-8 w-56 text-sm"
							/>
						</div>
					)}
					<Button
						size="sm"
						className="h-8"
						onClick={() => setCreateOpen(true)}
						disabled={!hasGitHub}
					>
						<Plus className="h-3.5 w-3.5 mr-1.5" />
						New Configuration
					</Button>
				</div>
			}
		>
			{!hasConfigs ? (
				hasGitHub ? (
					<PageEmptyState
						illustration={<GearIllustration />}
						badge={<PlusBadge />}
						title="No configurations yet"
						description="Choose repos and run a setup session to configure your environment."
					>
						<Button size="sm" onClick={() => setCreateOpen(true)}>
							<Plus className="h-3.5 w-3.5 mr-1.5" />
							New Configuration
						</Button>
					</PageEmptyState>
				) : (
					<PageEmptyState
						illustration={<GearIllustration />}
						badge={<InfoBadge />}
						title="Connect GitHub first"
						description="Configurations need access to your repos. Connect GitHub to get started."
					>
						<div className="w-56">
							<GitHubConnectButton />
						</div>
					</PageEmptyState>
				)
			) : !hasResults ? (
				<p className="text-sm text-muted-foreground text-center py-12">
					No configurations matching &ldquo;{filterQuery}&rdquo;
				</p>
			) : (
				<div className="rounded-xl border border-border overflow-hidden">
					{/* Table header */}
					<div className="flex items-center px-4 py-2 text-xs text-muted-foreground border-b border-border/50">
						<span className="flex-1 min-w-0">Name</span>
						<span className="w-40 text-center shrink-0">Status</span>
						<span className="w-28 text-center shrink-0">Created</span>
					</div>

					{configList.map((config) => (
						<ConfigurationRow key={config.id} config={config} />
					))}
				</div>
			)}
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
					<DialogHeader className="sr-only">
						<DialogTitle>New configuration</DialogTitle>
						<DialogDescription>Select repos and create a configuration</DialogDescription>
					</DialogHeader>
					<CreateSnapshotContent
						onCreate={(_configurationId, sessionId) => {
							setCreateOpen(false);
							setPendingPrompt(getSetupInitialPrompt());
							router.push(`/workspace/${sessionId}`);
						}}
					/>
				</DialogContent>
			</Dialog>
		</PageShell>
	);
}

// ============================================
// Configuration Row
// ============================================

function ConfigurationRow({ config }: { config: Configuration }) {
	const displayName = config.name || "Untitled configuration";
	const repos = (config.configurationRepos ?? []).filter((cr) => cr.repo !== null);
	const timeAgo = config.createdAt
		? formatDistanceToNow(new Date(config.createdAt), { addSuffix: true })
		: "\u2014";

	return (
		<div className="border-b border-border/50 last:border-0">
			<Link
				href={`/dashboard/configurations/${config.id}`}
				className="flex items-center px-4 py-2.5 text-sm hover:bg-muted/50 transition-colors"
			>
				<div className="flex-1 min-w-0">
					<span className="font-medium truncate block">{displayName}</span>
					{repos.length > 0 && (
						<div className="flex items-center gap-1.5 mt-1">
							{repos.map((cr) => (
								<span
									key={cr.repo!.id}
									className="inline-flex items-center gap-1 text-xs text-muted-foreground"
								>
									<FolderGit2 className="h-3 w-3 shrink-0" />
									<span className="truncate">{cr.repo!.githubRepoName.split("/").pop()}</span>
								</span>
							))}
						</div>
					)}
				</div>
				<span className="w-40 flex justify-center shrink-0">
					<ConfigurationStatusBadges status={config.status} />
				</span>
				<span className="w-28 text-center text-xs text-muted-foreground shrink-0">{timeAgo}</span>
			</Link>
		</div>
	);
}
