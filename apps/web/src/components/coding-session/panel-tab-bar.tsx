"use client";

import { cn } from "@/lib/utils";
import { Settings, X } from "lucide-react";

interface PanelTab {
	id: string;
	label: string;
	badge?: number | null;
	isActive: boolean;
	onClick: () => void;
}

interface PanelTabBarProps {
	tabs: PanelTab[];
	onToggleSettings?: () => void;
	onClose: () => void;
	settingsActive?: boolean;
}

export function PanelTabBar({ tabs, onToggleSettings, onClose, settingsActive }: PanelTabBarProps) {
	return (
		<div className="flex items-center border-b border-border px-1 h-9 shrink-0">
			{/* Tabs */}
			<div className="flex items-center gap-0.5 flex-1 min-w-0">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={tab.onClick}
						className={cn(
							"px-2.5 py-1.5 text-[12px] font-medium tracking-wide transition-colors border-b-2 -mb-px",
							tab.isActive
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground",
						)}
					>
						{tab.label}
						{tab.badge != null && tab.badge > 0 && (
							<span className="ml-1 font-mono text-[11px]">[{tab.badge}]</span>
						)}
					</button>
				))}
			</div>

			{/* Right controls */}
			<div className="flex items-center gap-0.5 shrink-0">
				{onToggleSettings && (
					<button
						type="button"
						onClick={onToggleSettings}
						className={cn(
							"p-1.5 rounded-sm transition-colors",
							settingsActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
						)}
					>
						<Settings className="h-3.5 w-3.5" />
					</button>
				)}
				<button
					type="button"
					onClick={onClose}
					className="p-1.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
		</div>
	);
}
