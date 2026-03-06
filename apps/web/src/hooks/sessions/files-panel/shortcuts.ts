"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import type { FilesSidebarTab } from "./state";

interface FilesPanelShortcutsOptions {
	setSidebarTab: (tab: FilesSidebarTab) => void;
	currentFile: string | null;
	closeCurrentTab: () => void;
	rootRef: RefObject<HTMLElement | null>;
}

export function useFilesPanelShortcuts({
	setSidebarTab,
	currentFile,
	closeCurrentTab,
	rootRef,
}: FilesPanelShortcutsOptions) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const isModifier = event.metaKey || event.ctrlKey;
			const target = event.target;
			const root = rootRef.current;

			if (!isModifier || !root || !(target instanceof Node) || !root.contains(target)) return;

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
	}, [closeCurrentTab, currentFile, rootRef, setSidebarTab]);
}
