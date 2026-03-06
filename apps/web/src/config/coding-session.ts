import {
	AlertTriangle,
	FolderTree,
	GitBranch,
	Globe,
	Layers,
	SquareTerminal,
	Wrench,
} from "lucide-react";

export const PANEL_TABS = [
	{ type: "url" as const, label: "Preview", icon: Globe },
	{ type: "files" as const, label: "Code", icon: FolderTree },
	{ type: "terminal" as const, label: "Terminal", icon: SquareTerminal },
	{ type: "git" as const, label: "Git", icon: GitBranch },
	{ type: "services" as const, label: "Logs", icon: Layers },
	{ type: "artifacts" as const, label: "Workspace", icon: Wrench },
];

/** Manager sessions: simplified panel set (G9). */
export const MANAGER_PANEL_TABS = [
	{ type: "terminal" as const, label: "Terminal", icon: SquareTerminal },
];

export const INVESTIGATION_TAB = {
	type: "investigation" as const,
	label: "Investigate",
	icon: AlertTriangle,
};
