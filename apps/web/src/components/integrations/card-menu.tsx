import type { CatalogEntry } from "@/components/integrations/integration-picker-dialog";
import {
	getProviderDisplayName,
	getProviderManageUrl,
} from "@/components/integrations/provider-icon";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExternalLink, MoreHorizontal, RefreshCw, X } from "lucide-react";

interface CardMenuProps {
	entry: CatalogEntry;
	isLoading: boolean;
	onReconnect: () => void;
	onDisconnect: () => void;
}

export function CardMenu({ entry, isLoading, onReconnect, onDisconnect }: CardMenuProps) {
	const manageUrl = entry.provider ? getProviderManageUrl(entry.provider) : null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
					<MoreHorizontal className="h-4 w-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{/* Manage on provider */}
				{manageUrl && (
					<DropdownMenuItem asChild>
						<a
							href={manageUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-2"
						>
							<ExternalLink className="h-3.5 w-3.5" />
							Manage on {getProviderDisplayName(entry.provider!)}
						</a>
					</DropdownMenuItem>
				)}

				{/* Reconnect (OAuth / Slack) */}
				{(entry.type === "oauth" || entry.type === "slack" || entry.type === "composio-oauth") && (
					<DropdownMenuItem
						onClick={onReconnect}
						disabled={isLoading}
						className="flex items-center gap-2"
					>
						<RefreshCw className="h-3.5 w-3.5" />
						Reconnect
					</DropdownMenuItem>
				)}

				<DropdownMenuSeparator />

				{/* Disconnect */}
				<DropdownMenuItem
					onClick={onDisconnect}
					className="flex items-center gap-2 text-destructive focus:text-destructive"
				>
					<X className="h-3.5 w-3.5" />
					Disconnect
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
