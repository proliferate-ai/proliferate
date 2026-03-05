"use client";

import type { TemplateEntry } from "@/components/automations/template-picker-dialog";
import type { CoworkerListTab } from "@/config/coworkers";
import { useAutomations, useCreateAutomation } from "@/hooks/automations/use-automations";
import { useCreateWorker, useWorkers } from "@/hooks/automations/use-workers";
import { useIntegrations, useSlackInstallations } from "@/hooks/integrations/use-integrations";
import { useCreateFromTemplate, useTemplateCatalog } from "@/hooks/org/use-templates";
import { useRouter } from "next/navigation";
import { startTransition, useMemo, useState } from "react";

export function useCoworkerCreate() {
	const router = useRouter();
	const { data: automations = [], isLoading: isLoadingAutomations } = useAutomations();
	const { data: workersList = [], isLoading: isLoadingWorkers } = useWorkers();
	const createAutomation = useCreateAutomation();
	const createWorker = useCreateWorker();
	const createFromTemplate = useCreateFromTemplate();
	const { data: templateCatalog = [] } = useTemplateCatalog();

	const { data: integrationsData } = useIntegrations();
	const { data: slackInstallations } = useSlackInstallations();

	const [pickerOpen, setPickerOpen] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);

	const connectedProviders = useMemo(() => {
		const providers = new Set<string>();
		if (!integrationsData) return providers;
		if (integrationsData.github.connected) providers.add("github");
		if (integrationsData.sentry.connected) providers.add("sentry");
		if (integrationsData.linear.connected) providers.add("linear");
		if (slackInstallations && slackInstallations.length > 0) providers.add("slack");
		return providers;
	}, [integrationsData, slackInstallations]);

	const hasWorkers = workersList.length > 0;
	const isLoading = hasWorkers ? isLoadingWorkers : isLoadingAutomations;
	const totalItems = hasWorkers ? workersList.length : automations.length;
	const isPending =
		createAutomation.isPending || createWorker.isPending || createFromTemplate.isPending;

	const handleBlankCreate = async () => {
		setCreateError(null);
		setPickerOpen(false);
		startTransition(() => {
			router.push("/coworkers?create=1");
		});
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

	return {
		automations,
		workersList,
		templateCatalog,
		connectedProviders,
		hasWorkers,
		isLoading,
		totalItems,
		isPending,
		pickerOpen,
		setPickerOpen,
		createError,
		handleBlankCreate,
		handleTemplateSelect,
	};
}

export function useCoworkerListFilters(
	workersList: ReturnType<typeof useCoworkerCreate>["workersList"],
	automations: ReturnType<typeof useCoworkerCreate>["automations"],
	hasWorkers: boolean,
) {
	const [activeTab, setActiveTab] = useState<CoworkerListTab>("all");
	const [searchQuery, setSearchQuery] = useState("");

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

	return {
		activeTab,
		setActiveTab,
		searchQuery,
		setSearchQuery,
		counts,
		filteredWorkers,
		filteredAutomations,
	};
}
