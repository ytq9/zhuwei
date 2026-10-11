import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Four levels: `primary` for the one main action in view (send, roll,
 * confirm), `secondary` for the rest, `ghost` for back and dismiss, and
 * `danger` for leaving or removing someone. A pressed toggle shows in brass. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.98] aria-pressed:border-brass aria-pressed:bg-brass/15 aria-pressed:text-brass",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-fg hover:bg-primary/90",
        secondary:
          "bg-elevated text-fg hover:bg-elevated/80 border border-border",
        ghost:
          "bg-transparent text-fg hover:bg-elevated border border-border",
        danger:
          "bg-danger text-fg hover:bg-danger/90",
      },
      size: {
        /** Dense controls in bars, lists and the map. */
        xs: "min-h-9 px-3 py-1.5 text-xs",
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-4 text-sm",
        lg: "h-12 px-5 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
