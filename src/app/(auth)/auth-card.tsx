import { Logo } from "@/components/ui/logo";

export function AuthCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo inverted /></div>
        <main className="rounded-[var(--radius-card)] bg-white p-6 shadow-xl">
          <h1 className="font-display text-xl font-semibold text-navy-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-navy-500">{description}</p>}
          {children}
        </main>
      </div>
    </div>
  );
}
