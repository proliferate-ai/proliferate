"use client";

import { useEffect } from "react";
import { getCalApi } from "@calcom/embed-react";
import { cn } from "@/lib/utils";

interface CalButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
  variant?: "default" | "outline";
  size?: "default" | "lg";
}

export function CalendlyButton({ 
  className = "", 
  text = "Schedule time with me",
  variant = "default",
  size = "default",
  ...props 
}: CalButtonProps) {
  useEffect(() => {
    (async function () {
      const cal = await getCalApi();
      cal("ui", {
        theme: "dark",
        styles: {
          branding: { brandColor: "#000000" },
        },
      });
    })();
  }, []);

  // Base button styles from the Button component
  const baseStyles = "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer";
  
  // Variant styles
  const variantStyles = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground"
  };
  
  // Size styles
  const sizeStyles = {
    default: "h-10 px-4 py-2",
    lg: "h-10 rounded-md px-6"
  };

  return (
    <button
      data-cal-link="pablo-proliferate/proliferate-intro"
      data-cal-config='{"theme":"dark","overlayCalendar":true}'
      className={cn(
        baseStyles,
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {text}
    </button>
  );
} 