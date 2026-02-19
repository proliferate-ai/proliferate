import { Loader2 } from "lucide-react";

export default function WorkspaceLoading() {
	return (
		<div className="h-screen flex items-center justify-center bg-background">
			<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
		</div>
	);
}
