"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "@/lib/utils";

const Sheet = ({
	shouldScaleBackground = true,
	...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) => (
	<DrawerPrimitive.Root shouldScaleBackground={shouldScaleBackground} {...props} />
);
Sheet.displayName = "Sheet";

const SheetTrigger = DrawerPrimitive.Trigger;

const SheetPortal = DrawerPrimitive.Portal;

const SheetClose = DrawerPrimitive.Close;

const SheetOverlay = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Overlay>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
	<DrawerPrimitive.Overlay
		ref={ref}
		className={cn("fixed inset-0 z-50 bg-black/80", className)}
		{...props}
	/>
));
SheetOverlay.displayName = DrawerPrimitive.Overlay.displayName;

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> {
	side?: "top" | "bottom" | "left" | "right";
}

const SheetContent = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Content>,
	SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => (
	<SheetPortal>
		<SheetOverlay />
		<DrawerPrimitive.Content
			ref={ref}
			className={cn(
				"fixed z-50 bg-background",
				side === "left" &&
					"inset-y-0 left-0 h-full border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
				side === "right" &&
					"inset-y-0 right-0 h-full w-3/4 max-w-sm border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
				side === "top" &&
					"inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
				side === "bottom" &&
					"inset-x-0 bottom-0 mt-24 rounded-t-[10px] border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
				className,
			)}
			{...props}
		>
			{side === "bottom" && <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />}
			{children}
		</DrawerPrimitive.Content>
	</SheetPortal>
));
SheetContent.displayName = "SheetContent";

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Title>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
	<DrawerPrimitive.Title
		ref={ref}
		className={cn("text-lg font-semibold leading-none tracking-tight", className)}
		{...props}
	/>
));
SheetTitle.displayName = DrawerPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
	React.ElementRef<typeof DrawerPrimitive.Description>,
	React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
	<DrawerPrimitive.Description
		ref={ref}
		className={cn("text-sm text-muted-foreground", className)}
		{...props}
	/>
));
SheetDescription.displayName = DrawerPrimitive.Description.displayName;

export {
	Sheet,
	SheetPortal,
	SheetOverlay,
	SheetTrigger,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetFooter,
	SheetTitle,
	SheetDescription,
};
