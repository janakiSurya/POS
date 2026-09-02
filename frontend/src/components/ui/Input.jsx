import { cn } from "../../lib/format";

export function Select({ className, ...props }) {
  return (
    <select
      className={cn(
        "w-full rounded-md border border-ash bg-canvas px-3 py-2 text-sm text-ink focus:border-electric focus:outline-none focus:ring-2 focus:ring-electric/20",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-ink/20 bg-canvas px-3 py-2 text-sm text-ink placeholder:text-silver focus:border-electric focus:outline-none focus:ring-2 focus:ring-electric/20",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children, className }) {
  return (
    <label className={cn("mb-1 block text-sm font-medium text-graphite", className)}>
      {children}
    </label>
  );
}
