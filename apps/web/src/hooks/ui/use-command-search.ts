"use client";

import { useDashboardStore } from "@/stores/dashboard";
import { useEffect } from "react";

export function useCommandSearch() {
	const { commandSearchOpen, setCommandSearchOpen } = useDashboardStore();

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				setCommandSearchOpen(true);
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [setCommandSearchOpen]);

	return { open: commandSearchOpen, setOpen: setCommandSearchOpen };
}
