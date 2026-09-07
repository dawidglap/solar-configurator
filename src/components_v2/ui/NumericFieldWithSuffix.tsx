import React from "react";

import { cn } from "@/lib/utils";

type NumericFieldWithSuffixProps = React.InputHTMLAttributes<HTMLInputElement> & {
  suffix: string;
  containerClassName?: string;
};

/** A full-width numeric text field with a non-interactive unit inside the control. */
const NumericFieldWithSuffix = React.forwardRef<
  HTMLInputElement,
  NumericFieldWithSuffixProps
>(function NumericFieldWithSuffix(
  { suffix, className, containerClassName, ...inputProps },
  ref,
) {
  return (
    <span className={cn("relative block w-full", containerClassName)}>
      <input
        ref={ref}
        className={cn(
          "glass-input h-9 w-full rounded-lg py-0 pl-3 pr-10 text-[11px] leading-none",
          "focus:ring-1 focus:ring-primary/40",
          className,
        )}
        {...inputProps}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[11px] text-muted-foreground"
      >
        {suffix}
      </span>
    </span>
  );
});

export default NumericFieldWithSuffix;
