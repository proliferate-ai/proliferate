import type { ComponentProps } from "react";

import { Toaster as SonnerToaster, toast } from "sonner";

const kitClassNames = {
  toast:
    "!bg-popover !text-foreground !border !border-border !rounded-xl !shadow-md !text-[13px]",
  description: "!text-[12px] !text-muted-foreground",
  actionButton: "!bg-primary !text-primary-foreground !rounded-md !text-[12px]",
  cancelButton:
    "!border !border-input !bg-transparent !text-muted-foreground !rounded-md !text-[12px]",
};

export function Toaster({ toastOptions, ...props }: ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      richColors={false}
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
