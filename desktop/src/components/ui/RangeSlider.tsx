import { forwardRef, type InputHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type RangeSliderProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const RangeSlider = forwardRef<HTMLInputElement, RangeSliderProps>(
  function RangeSlider({ className = "", ...props }, ref) {
    return (
      <input
        ref={ref}
        type="range"
        className={twMerge(
          "h-2 w-full cursor-pointer appearance-none rounded-full bg-foreground/10 accent-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
