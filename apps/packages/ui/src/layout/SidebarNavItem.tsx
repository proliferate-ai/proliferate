import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface SidebarNavItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
}

export const SidebarNavItem = forwardRef<HTMLButtonElement, SidebarNavItemProps>(
  function SidebarNavItem({
    active = false,
    icon,
    className = "",
    children,
    type = "button",
    ...props
  }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-current={active ? "page" : undefined}
        className={twMerge(
          "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium transition-colors",
          active
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          className,
        )}
        {...props}
      >
        {icon && (
          <span className="flex size-[18px] shrink-0 items-center justify-center text-current [&>svg]:size-4 [&>svg]:shrink-0">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </button>
    );
  },
);
