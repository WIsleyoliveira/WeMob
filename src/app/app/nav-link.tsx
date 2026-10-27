"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/app" ? path === "/app" : path.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("shrink-0 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white")}
    >
      {children}
    </Link>
  );
}
