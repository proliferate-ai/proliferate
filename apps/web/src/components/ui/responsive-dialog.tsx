"use client";

import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import * as React from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "./sheet";

interface ResponsiveDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: React.ReactNode;
	modal?: boolean;
}

interface ResponsiveDialogContentProps {
	className?: string;
	children: React.ReactNode;
	disableOverlayPointerEvents?: boolean;
}

interface ResponsiveDialogHeaderProps {
	className?: string;
	children: React.ReactNode;
}

interface ResponsiveDialogFooterProps {
	className?: string;
	children: React.ReactNode;
}

interface ResponsiveDialogTitleProps {
	className?: string;
	children: React.ReactNode;
}

interface ResponsiveDialogDescriptionProps {
	className?: string;
	children: React.ReactNode;
}

const ResponsiveDialogContext = React.createContext<{ isMobile: boolean }>({
	isMobile: false,
});

function ResponsiveDialog({ open, onOpenChange, children, modal }: ResponsiveDialogProps) {
	const isMobile = useMediaQuery("(max-width: 767px)");

	if (isMobile) {
		return (
			<ResponsiveDialogContext.Provider value={{ isMobile: true }}>
				<Sheet open={open} onOpenChange={onOpenChange} modal={modal}>
					{children}
				</Sheet>
			</ResponsiveDialogContext.Provider>
		);
	}

	return (
		<ResponsiveDialogContext.Provider value={{ isMobile: false }}>
			<Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
				{children}
			</Dialog>
		</ResponsiveDialogContext.Provider>
	);
}

function ResponsiveDialogContent({
	className,
	children,
	disableOverlayPointerEvents,
}: ResponsiveDialogContentProps) {
	const { isMobile } = React.useContext(ResponsiveDialogContext);

	if (isMobile) {
		return (
			<SheetContent side="bottom" className={cn("max-h-[85vh] overflow-y-auto", className)}>
				{children}
			</SheetContent>
		);
	}

	return (
		<DialogContent className={className} disableOverlayPointerEvents={disableOverlayPointerEvents}>
			{children}
		</DialogContent>
	);
}

function ResponsiveDialogHeader({ className, children }: ResponsiveDialogHeaderProps) {
	const { isMobile } = React.useContext(ResponsiveDialogContext);

	if (isMobile) {
		return <SheetHeader className={className}>{children}</SheetHeader>;
	}

	return <DialogHeader className={className}>{children}</DialogHeader>;
}

function ResponsiveDialogFooter({ className, children }: ResponsiveDialogFooterProps) {
	const { isMobile } = React.useContext(ResponsiveDialogContext);

	if (isMobile) {
		return <SheetFooter className={className}>{children}</SheetFooter>;
	}

	return <DialogFooter className={className}>{children}</DialogFooter>;
}

function ResponsiveDialogTitle({ className, children }: ResponsiveDialogTitleProps) {
	const { isMobile } = React.useContext(ResponsiveDialogContext);

	if (isMobile) {
		return <SheetTitle className={className}>{children}</SheetTitle>;
	}

	return <DialogTitle className={className}>{children}</DialogTitle>;
}

function ResponsiveDialogDescription({ className, children }: ResponsiveDialogDescriptionProps) {
	const { isMobile } = React.useContext(ResponsiveDialogContext);

	if (isMobile) {
		return <SheetDescription className={className}>{children}</SheetDescription>;
	}

	return <DialogDescription className={className}>{children}</DialogDescription>;
}

function ResponsiveDialogClose({
	className,
	children,
}: { className?: string; children?: React.ReactNode }) {
	const { isMobile } = React.useContext(ResponsiveDialogContext);

	if (isMobile) {
		return <SheetClose className={className}>{children}</SheetClose>;
	}

	return <DialogClose className={className}>{children}</DialogClose>;
}

export {
	ResponsiveDialog,
	ResponsiveDialogContent,
	ResponsiveDialogHeader,
	ResponsiveDialogFooter,
	ResponsiveDialogTitle,
	ResponsiveDialogDescription,
	ResponsiveDialogClose,
};
