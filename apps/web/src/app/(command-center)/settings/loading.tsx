import { Loader2 } from "lucide-react";

export default function SettingsLoading() {
	return (
		<div className="flex-1 flex items-center justify-center">
			<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
		</div>
	);
}
