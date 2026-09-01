import { Button } from "./Button";
import { cn } from "../../lib/format";

export function Modal({ open, onClose, title, children, className }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        className={cn(
          "w-full max-w-md rounded-xl border border-charcoal-3 bg-charcoal-2 p-6 shadow-xl",
          className,
        )}
        role="dialog"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="text-white-muted hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function BlockingModal({ open, title, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal p-4">
      <div className="w-full max-w-md rounded-xl border border-charcoal-3 bg-charcoal-2 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">{title}</h2>
        {children}
      </div>
    </div>
  );
}
