"use client";

import { AutomationListRow } from "@/components/automations/automation-list-row";
import { TemplatePickerDialog } from "@/components/automations/template-picker-dialog";
import { WorkerCapabilityEditor } from "@/components/automations/worker-capability-editor";
import { WorkerCard } from "@/components/automations/worker-card";
import {
	AutomationIllustration,
	PageEmptyState,
	PlusBadge,
} from "@/components/dashboard/page-empty-state";
import { PageShell } from "@/components/dashboard/page-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { COWORKER_LIST_TABS, type WorkerStatus } from "@/config/coworkers";
import { useCoworkersPage } from "@/hooks/automations/use-coworkers-page";
import { cn } from "@/lib/display/utils";
import { BookTemplate, Plus, Search } from "lucide-react";

export default function CoworkersPage() {
	const {
		templateCatalog,
		connectedProviders,
		filteredWorkers,
		filteredAutomations,
		hasWorkers,
		isLoading,
		isPending,
		totalItems,
		counts,
		activeTab,
		setActiveTab,
		searchQuery,
		setSearchQuery,
		pickerOpen,
		setPickerOpen,
		createDialogOpen,
		setCreateDialogOpen,
		createName,
		setCreateName,
		createSystemPrompt,
		setCreateSystemPrompt,
		createCapabilities,
		setCreateCapabilities,
		createError,
		openBlankCreateDialog,
		handleBlankCreate,
		handleTemplateSelect,
	} = useCoworkersPage();

	return (
		<PageShell
			title="Coworkers"
			subtitle="Background agents that monitor sources and run tasks."
			actions={
				<>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPickerOpen(true)}
						disabled={isPending}
					>
						<BookTemplate className="h-3.5 w-3.5 mr-1.5" />
						Templates
					</Button>
					<Button size="sm" onClick={openBlankCreateDialog} disabled={isPending}>
						<Plus className="h-4 w-4 mr-1.5" />
						New
					</Button>
				</>
			}
		>
			{isLoading ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
					{[1, 2, 3].map((i) => (
						<div key={i} className="h-16 rounded-2xl animate-pulse bg-muted/20" />
					))}
				</div>
			) : totalItems === 0 ? (
				<PageEmptyState
					illustration={<AutomationIllustration />}
					badge={<PlusBadge />}
					title="No coworkers created"
					description="Create a coworker to monitor sources and manage async engineering work."
				>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPickerOpen(true)}
						disabled={isPending}
					>
						<BookTemplate className="h-3.5 w-3.5 mr-1.5" />
						Browse templates
					</Button>
					<Button size="sm" onClick={openBlankCreateDialog} disabled={isPending}>
						<Plus className="h-4 w-4 mr-1.5" />
						New
					</Button>
				</PageEmptyState>
			) : (
				<>
					{/* Tabs + Search */}
					<div className="flex items-center justify-between gap-4 mb-4">
						<div className="flex items-center gap-1">
							{COWORKER_LIST_TABS.map((tab) => (
								<Button
									key={tab.value}
									variant="ghost"
									onClick={() => setActiveTab(tab.value)}
									className={cn(
										"flex items-center gap-1.5 px-3 h-7 text-sm rounded-lg transition-colors",
										activeTab === tab.value
											? "bg-card text-foreground font-medium shadow-subtle border border-border/50"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{tab.label}
									<span
										className={cn(
											"text-xs tabular-nums px-1.5 rounded-full",
											activeTab === tab.value
												? "bg-muted text-muted-foreground"
												: "bg-muted/50 text-muted-foreground/70",
										)}
									>
										{counts[tab.value]}
									</span>
								</Button>
							))}
						</div>
						<div className="relative">
							<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
							<Input
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								placeholder="Search"
								className="h-8 w-48 pl-8 text-sm bg-muted/50 border-0"
							/>
						</div>
					</div>

					{/* Workers grid (V1) */}
					{hasWorkers ? (
						filteredWorkers.length === 0 ? (
							<div className="text-center py-12">
								<p className="text-sm text-muted-foreground">
									{searchQuery.trim()
										? "No coworkers match your search."
										: `No ${activeTab} coworkers.`}
								</p>
							</div>
						) : (
							<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
								{filteredWorkers.map((worker) => (
									<WorkerCard
										key={worker.id}
										id={worker.id}
										name={worker.name}
										status={worker.status as WorkerStatus}
										objective={worker.systemPrompt}
										activeTaskCount={worker.activeTaskCount}
										pendingApprovalCount={worker.pendingApprovalCount}
									/>
								))}
							</div>
						)
					) : /* Legacy automation list (fallback) */
					filteredAutomations.length === 0 ? (
						<div className="text-center py-12">
							<p className="text-sm text-muted-foreground">
								{searchQuery.trim()
									? "No coworkers match your search."
									: `No ${activeTab} coworkers.`}
							</p>
						</div>
					) : (
						<div className="rounded-xl border border-border overflow-hidden">
							<div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/30 text-xs text-muted-foreground">
								<div className="flex-1 min-w-0">Name</div>
								<div className="hidden sm:block w-16 shrink-0">Scope</div>
								<div className="hidden md:block w-28 shrink-0">Triggers</div>
								<div className="hidden md:block w-24 shrink-0">Actions</div>
								<div className="hidden lg:block w-16 shrink-0 text-right">Created</div>
								<div className="w-16 shrink-0 text-right">Updated</div>
							</div>
							{filteredAutomations.map((automation) => (
								<AutomationListRow
									key={automation.id}
									id={automation.id}
									name={automation.name}
									enabled={automation.enabled}
									createdAt={automation.created_at}
									updatedAt={automation.updated_at}
									triggerCount={automation._count.triggers}
									scheduleCount={automation._count.schedules}
									activeProviders={automation.activeProviders}
									enabledTools={automation.enabled_tools}
								/>
							))}
						</div>
					)}
				</>
			)}

			<TemplatePickerDialog
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				templates={templateCatalog}
				connectedProviders={connectedProviders}
				onSelectTemplate={handleTemplateSelect}
				onSelectBlank={openBlankCreateDialog}
				isPending={isPending}
				error={createError}
			/>

			<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>Create coworker</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-1.5">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Name
							</p>
							<Input
								value={createName}
								onChange={(event) => setCreateName(event.target.value)}
								placeholder="Untitled coworker"
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Objective
							</p>
							<Textarea
								value={createSystemPrompt}
								onChange={(event) => setCreateSystemPrompt(event.target.value)}
								placeholder="Describe what this coworker should own."
								className="min-h-[100px]"
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
								Capabilities
							</p>
							<WorkerCapabilityEditor
								value={createCapabilities}
								onChange={setCreateCapabilities}
								disabled={isPending}
								connectedProviders={Array.from(connectedProviders)}
							/>
						</div>
						{createError && <p className="text-sm text-destructive">{createError}</p>}
						<div className="flex items-center justify-end gap-2">
							<Button
								variant="ghost"
								onClick={() => setCreateDialogOpen(false)}
								disabled={isPending}
							>
								Cancel
							</Button>
							<Button onClick={handleBlankCreate} disabled={isPending}>
								{isPending ? "Creating..." : "Create coworker"}
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</PageShell>
	);
}
