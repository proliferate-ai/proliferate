"use client";

import { useEffect } from "react";
import type { FilesSidebarTab } from "./state";

interface FilesPanelShortcutsOptions {
	sidebarTab: FilesSidebarTab;
	setSidebarTab: (tab: FilesSidebarTab) => void;
	currentFile: string | null;
	closeCurrentTab: () => void;
}

export function useFilesPanelShortcuts({
	setSidebarTab,
	currentFile,
	closeCurrentTab,
}: FilesPanelShortcutsOptions) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const isModifier = event.metaKey || event.ctrlKey;

			if (!isModifier) return;

			if (event.shiftKey && event.key.toLowerCase() === "f") {
				event.preventDefault();
				setSidebarTab("search");
				return;
			}

			if (!event.shiftKey && event.key.toLowerCase() === "w" && currentFile) {
				event.preventDefault();
				closeCurrentTab();
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [closeCurrentTab, currentFile, setSidebarTab]);
}
