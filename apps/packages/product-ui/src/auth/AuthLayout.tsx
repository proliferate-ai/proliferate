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
      <main className="w-full max-w-md space-y-8">
        <div className="space-y-5">
          {mark ? <div className="flex size-12 items-center justify-start">{mark}</div> : null}
          <div className="space-y-2.5">
            <h1 className="text-3xl font-semibold leading-tight text-foreground">{title}</h1>
            {subtitle ? <p className="text-sm leading-6 text-muted-foreground">{subtitle}</p> : null}
          </div>
        </div>
        <div className="space-y-4">{children}</div>
        {footer ? <div className="text-xs leading-5 text-faint">{footer}</div> : null}
      </main>
    </div>
  );
}
