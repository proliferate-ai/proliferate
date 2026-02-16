"use client";

import { ConnectorIcon } from "@/components/integrations/connector-icon";
import { Button } from "@/components/ui/button";
import type { ConnectorConfig } from "@proliferate/shared";
import { CONNECTOR_PRESETS } from "@proliferate/shared";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

/** Best-effort preset key lookup for a connected tool (matches by URL). */
export function findPresetKey(connector: ConnectorConfig): string {
	const match = CONNECTOR_PRESETS.find((p) => p.defaults.url && connector.url === p.defaults.url);
	return match?.key ?? "custom";
}

export interface ConnectorRowProps {
	connector: ConnectorConfig;
	onEdit: () => void;
	onRemove: () => void;
	onToggle: () => void;
}

export function ConnectorRow({ connector, onEdit, onRemove, onToggle }: ConnectorRowProps) {
	const [confirmDelete, setConfirmDelete] = useState(false);

	return (
		<div className="flex items-center justify-between px-4 py-3">
			<div className="flex items-center gap-3 min-w-0">
				<div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted shrink-0">
					<ConnectorIcon presetKey={findPresetKey(connector)} size="sm" />
				</div>
				<div className="min-w-0">
					<p className="text-sm font-medium truncate">{connector.name}</p>
					<p className="text-xs text-muted-foreground truncate">{connector.url}</p>
				</div>
			</div>

			<div className="flex items-center gap-1.5 shrink-0">
				<Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onToggle}>
					{connector.enabled ? (
						<span className="text-green-600">Enabled</span>
					) : (
						<span className="text-muted-foreground">Disabled</span>
					)}
				</Button>
				<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
					<Pencil className="h-3.5 w-3.5" />
				</Button>
				{confirmDelete ? (
					<Button
						variant="destructive"
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={() => {
							onRemove();
							setConfirmDelete(false);
						}}
					>
						Confirm
					</Button>
				) : (
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-destructive"
						onClick={() => setConfirmDelete(true)}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				)}
			</div>
		</div>
	);
}
