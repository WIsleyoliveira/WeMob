import { Breadcrumbs, type Crumb } from "./breadcrumbs";

export function PageHeader({ title, description, actions, breadcrumbs }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; breadcrumbs?: Crumb[] }) {
  return (
    <div className="mb-6">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
          {description && <div className="mt-1 max-w-3xl text-sm text-navy-500">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
