export function EmptyState({ title, description, action }: { title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-navy-200 bg-white px-6 py-12 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-navy-50 text-navy-400" aria-hidden>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" /></svg>
      </div>
      <p className="font-display font-semibold text-navy-900">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-navy-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
