import { type HTMLAttributes, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface AuthLayoutProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  mark?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({
  mark,
  title,
  subtitle,
  children,
  footer,
  className = "",
  ...props
}: AuthLayoutProps) {
  return (
    <div
      className={twMerge("flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground", className)}
      {...props}
    >
      <div className="flex w-full max-w-sm flex-col items-center">
        {mark && <div className="mb-6">{mark}</div>}
        <h1 className="text-center text-xl font-semibold tracking-normal">{title}</h1>
        {subtitle && <p className="mt-2 text-center text-sm leading-5 text-muted-foreground">{subtitle}</p>}
        <div className="mt-9 flex w-full flex-col gap-3">{children}</div>
        {footer && <div className="mt-6 text-center text-xs leading-5 text-faint">{footer}</div>}
      </div>
    </div>
  );
}
