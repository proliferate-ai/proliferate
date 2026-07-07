import type { ComponentProps } from "react";

import { Toaster as SonnerToaster, toast } from "sonner";

const kitClassNames = {
  toast:
    "!bg-popover !text-foreground !border !border-border !rounded-xl !shadow-md !text-ui",
  description: "!text-ui-sm !text-muted-foreground",
  actionButton: "!bg-primary !text-primary-foreground !rounded-md !text-ui-sm",
  cancelButton:
    "!border !border-input !bg-transparent !text-muted-foreground !rounded-md !text-ui-sm",
};

export function Toaster({ toastOptions, ...props }: ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      richColors={false}
      // Always expanded: prevents the hover-enter resize animation that sonner
      // applies when transitioning stacked toasts from collapsed to expanded.
      expand
      {...props}
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...kitClassNames,
          ...toastOptions?.classNames,
        },
      }}
    />
  );
}

export { toast };
