import {
	AlertTriangle,
	FolderTree,
	GitBranch,
	Globe,
	KeyRound,
	Layers,
	Settings,
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

/** Manager sessions: coworker-specific panel set. */
export const MANAGER_PANEL_TABS = [
	{ type: "configure" as const, label: "Configure", icon: Settings },
	{ type: "coworker-sessions" as const, label: "Sessions", icon: Layers },
	{ type: "terminal" as const, label: "Terminal", icon: SquareTerminal },
];

/** Setup sessions: environment + terminal only. */
export const SETUP_PANEL_TABS = [
	{ type: "environment" as const, label: "Environment", icon: KeyRound },
	{ type: "terminal" as const, label: "Terminal", icon: SquareTerminal },
];

export const INVESTIGATION_TAB = {
	type: "investigation" as const,
	label: "Investigate",
	icon: AlertTriangle,
};
