export function Logo({ inverted = false }: { inverted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect width="32" height="32" rx="9" fill="#16a36b" />
        <path d="M18.5 5 9 18h6l-1.5 9L23 14h-6l1.5-9Z" fill="#fff" />
        <circle cx="25" cy="7" r="2.2" fill="#3fcbc6" />
      </svg>
      <span className={`font-display text-lg font-bold tracking-tight ${inverted ? "text-white" : "text-navy-900"}`}>
        Sansol <span className="text-brand-500">Mob</span>
      </span>
    </span>
  );
}
