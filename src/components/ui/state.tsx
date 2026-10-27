import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, Lock, PlugZap } from "lucide-react";
import { cn } from "@/lib/cn";

const ICONS = { empty: Inbox, error: AlertTriangle, forbidden: Lock, unavailable: PlugZap } satisfies Record<string, LucideIcon>;
const TONES = { empty: "bg-navy-50 text-navy-500", error: "bg-red-50 text-red-600", forbidden: "bg-amber-50 text-amber-700", unavailable: "bg-tiffany-300/15 text-tiffany-600" };

/** Estado padronizado: vazio, erro, sem permissão ou integração indisponível. */
export function StateMessage({
  kind,
  title,
  description,
  action,
  className,
}: {
  kind: keyof typeof ICONS;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = ICONS[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn("flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-navy-200 bg-white px-6 py-12 text-center", className)}
    >
      <div className={cn("mb-3 grid size-11 place-items-center rounded-full", TONES[kind])} aria-hidden>
        <Icon className="size-5" />
      </div>
      <p className="font-display font-semibold text-navy-900">{title}</p>
      {description && <div className="mt-1 max-w-md text-sm text-navy-500">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
