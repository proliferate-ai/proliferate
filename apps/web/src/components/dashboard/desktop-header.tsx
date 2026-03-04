import { openIntercomMessenger } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { ChatBubbleIcon } from "@/components/ui/icons";
import { BookOpen } from "lucide-react";
import Link from "next/link";
import { NotificationTray } from "./notification-tray";

interface DesktopHeaderProps {
	pageTitle: string;
}

export function DesktopHeader({ pageTitle }: DesktopHeaderProps) {
	return (
		<div className="hidden md:flex shrink-0 items-center justify-between h-12 px-4 border-b border-border/50">
			<h1 className="text-sm font-medium text-foreground truncate">{pageTitle}</h1>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					className="h-8 gap-1.5 rounded-lg text-muted-foreground"
					asChild
				>
					<Link href="https://docs.proliferate.com" target="_blank" rel="noopener noreferrer">
						<BookOpen className="h-3.5 w-3.5" />
						<span className="text-xs">Docs</span>
					</Link>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-8 gap-1.5 rounded-lg text-muted-foreground"
					onClick={openIntercomMessenger}
				>
					<ChatBubbleIcon className="h-3.5 w-3.5" />
					<span className="text-xs">Help</span>
				</Button>
				<NotificationTray />
			</div>
		</div>
	);
}
