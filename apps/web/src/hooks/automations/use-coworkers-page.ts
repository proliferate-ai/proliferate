"use client";

import type { TemplateEntry } from "@/components/automations/template-picker-dialog";
import type { WorkerCapabilityDraft } from "@/components/automations/worker-capability-editor";
import type { CoworkerListTab } from "@/config/coworkers";
import { useAutomations, useCreateAutomation } from "@/hooks/automations/use-automations";
import { useCreateWorker, useWorkers } from "@/hooks/automations/use-workers";
import { useIntegrations, useSlackInstallations } from "@/hooks/integrations/use-integrations";
import { useCreateFromTemplate, useTemplateCatalog } from "@/hooks/org/use-templates";
import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";

export function useCoworkersPage() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { data: automations = [], isLoading: isLoadingAutomations } = useAutomations();
	const { data: workersList = [], isLoading: isLoadingWorkers } = useWorkers();
	const createAutomation = useCreateAutomation();
	const createWorker = useCreateWorker();
	const createFromTemplate = useCreateFromTemplate();
	const { data: templateCatalog = [] } = useTemplateCatalog();

	const { data: integrationsData } = useIntegrations();
	const { data: slackInstallations } = useSlackInstallations();

	const connectedProviders = useMemo(() => {
		const providers = new Set<string>();
		if (!integrationsData) return providers;
		if (integrationsData.github.connected) providers.add("github");
		if (integrationsData.sentry.connected) providers.add("sentry");
		if (integrationsData.linear.connected) providers.add("linear");
		if (integrationsData.jira.connected) providers.add("jira");
		if (slackInstallations && slackInstallations.length > 0) providers.add("slack");
		return providers;
	}, [integrationsData, slackInstallations]);

	// Tab and search state
	const [activeTab, setActiveTab] = useState<CoworkerListTab>("all");
	const [searchQuery, setSearchQuery] = useState("");

	// Template picker state
	const [pickerOpen, setPickerOpen] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	// Create dialog state
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createName, setCreateName] = useState("");
	const [createObjective, setCreateObjective] = useState("");
	const [createCapabilities, setCreateCapabilities] = useState<WorkerCapabilityDraft[]>([]);

	// Determine if we have V1 workers — show worker table when present, legacy automation list otherwise
	const hasWorkers = workersList.length > 0;
	const isLoading = hasWorkers ? isLoadingWorkers : isLoadingAutomations;

	// Worker counts
	const workerCounts = useMemo(
		() => ({
			all: workersList.length,
			active: workersList.filter((w) => w.status === "active").length,
			paused: workersList.filter((w) => w.status === "paused").length,
		}),
		[workersList],
	);

	const automationCounts = useMemo(
		() => ({
			all: automations.length,
			active: automations.filter((a) => a.enabled).length,
			paused: automations.filter((a) => !a.enabled).length,
		}),
		[automations],
	);

	const counts = hasWorkers ? workerCounts : automationCounts;

	// Filtered lists
	const filteredWorkers = useMemo(() => {
		let result = workersList;
		if (activeTab === "active") result = result.filter((w) => w.status === "active");
		else if (activeTab === "paused") result = result.filter((w) => w.status === "paused");
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			result = result.filter((w) => w.name.toLowerCase().includes(q));
		}
		return result;
	}, [workersList, activeTab, searchQuery]);

	const filteredAutomations = useMemo(() => {
		let result = automations;
		if (activeTab === "active") result = result.filter((a) => a.enabled);
		else if (activeTab === "paused") result = result.filter((a) => !a.enabled);
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			result = result.filter((a) => a.name.toLowerCase().includes(q));
		}
		return result;
	}, [automations, activeTab, searchQuery]);

	const openBlankCreateDialog = useCallback(() => {
		setCreateError(null);
		setPickerOpen(false);
		setCreateDialogOpen(true);
	}, []);

	// Auto-open create dialog from URL search params
	useEffect(() => {
		if (searchParams.get("create") !== "1") {
			return;
		}

		openBlankCreateDialog();
		router.replace("/coworkers");
	}, [searchParams, router, openBlankCreateDialog]);

	const handleBlankCreate = async () => {
		setCreateError(null);
		try {
			const result = await createWorker.mutateAsync({
				...(createName.trim() ? { name: createName.trim() } : {}),
				...(createObjective.trim() ? { objective: createObjective.trim() } : {}),
				...(createCapabilities.length > 0 ? { capabilities: createCapabilities } : {}),
			});
			setCreateDialogOpen(false);
			setCreateName("");
			setCreateObjective("");
			setCreateCapabilities([]);
			startTransition(() => {
				router.push(`/coworkers/${result.worker.id}`);
			});
		} catch (err) {
			setCreateError(err instanceof Error ? err.message : "Failed to create coworker");
		}
	};

	const handleTemplateSelect = async (template: TemplateEntry) => {
		setCreateError(null);
		const integrationBindings: Record<string, string> = {};
		if (integrationsData) {
			for (const req of template.requiredIntegrations) {
				const integration = integrationsData.integrations.find(
					(i) => i.integration_id === req.provider && i.status === "active",
				);
				if (integration) {
					integrationBindings[req.provider] = integration.id;
				}
			}
		}
		try {
			const worker = await createFromTemplate.mutateAsync({
				templateId: template.id,
				integrationBindings,
			});
			setPickerOpen(false);
			startTransition(() => {
				router.push(`/coworkers/${worker.id}`);
			});
		} catch (err) {
			setCreateError(
				err instanceof Error ? err.message : "Failed to create coworker from template",
			);
		}
	};

	const isPending =
		createAutomation.isPending || createWorker.isPending || createFromTemplate.isPending;
	const totalItems = hasWorkers ? workersList.length : automations.length;

	return {
		// Data
		templateCatalog,
		connectedProviders,
		filteredWorkers,
		filteredAutomations,

		// Status
		hasWorkers,
		isLoading,
		isPending,
		totalItems,
		counts,

		// Tab and search
		activeTab,
		setActiveTab,
		searchQuery,
		setSearchQuery,

		// Template picker
		pickerOpen,
		setPickerOpen,

		// Create dialog
		createDialogOpen,
		setCreateDialogOpen,
		createName,
		setCreateName,
		createObjective,
		setCreateObjective,
		createCapabilities,
		setCreateCapabilities,
		createError,

		// Handlers
		openBlankCreateDialog,
		handleBlankCreate,
		handleTemplateSelect,
	};
}
