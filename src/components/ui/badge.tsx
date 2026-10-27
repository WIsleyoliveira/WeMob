import { cn } from "@/lib/cn";

const tones = {
  neutral: "bg-navy-50 text-navy-600 ring-navy-200",
  green: "bg-brand-50 text-brand-700 ring-brand-200",
  tiffany: "bg-tiffany-300/15 text-tiffany-600 ring-tiffany-300/60",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  navy: "bg-navy-900 text-white ring-navy-900",
} as const;

export function Badge({ tone = "neutral", className, ...p }: { tone?: keyof typeof tones } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone], className)} {...p} />;
}
