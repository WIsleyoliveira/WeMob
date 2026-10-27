import { cn } from "@/lib/cn";

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm [&_td]:border-b [&_td]:border-navy-50 [&_td]:px-3 [&_td]:py-2.5 [&_th]:border-b [&_th]:border-navy-100 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-navy-400 [&_tbody_tr:hover]:bg-navy-50/50", className)} {...p} />
    </div>
  );
}
