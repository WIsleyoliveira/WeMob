import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-navy-100/70 motion-reduce:animate-none", className)} />;
}

/** Esqueleto padrão de página do backoffice. */
export function PageSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <Skeleton className="mb-2 h-4 w-40" />
      <Skeleton className="mb-6 h-8 w-72" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="mt-6 h-64" />
    </div>
  );
}
