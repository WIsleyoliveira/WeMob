"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

type Pref = "light" | "dark" | "system";
const COOKIE = "sm_theme";
const OPTIONS: { value: Pref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Escuro", Icon: Moon },
  { value: "system", label: "Sistema", Icon: Monitor },
];

function apply(pref: Pref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.themePref = pref;
}

/** Seletor de tema (claro, escuro ou o do sistema). A preferência fica no cookie `sm_theme` por um ano, neste aparelho. */
export function ThemeToggle({ className, tone = "default" }: { className?: string; tone?: "default" | "inverted" }) {
  const [pref, setPref] = useState<Pref>("system");
  useEffect(() => {
    const p = (document.documentElement.dataset.themePref as Pref | undefined) ?? "system";
    setPref(p);
    if (p !== "system") return;
    // Seguindo o sistema: acompanha a troca de tema do aparelho sem recarregar.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);
  const choose = (p: Pref) => {
    document.cookie = `${COOKIE}=${p}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
    apply(p);
    setPref(p);
  };
  return (
    <div role="radiogroup" aria-label="Tema da interface" className={cn("inline-flex items-center rounded-lg p-0.5", tone === "inverted" ? "bg-white/10" : "bg-navy-100", className)}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          title={`Tema: ${label}`}
          onClick={() => choose(value)}
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md transition-colors",
            tone === "inverted" ? (pref === value ? "bg-white/20 text-white" : "text-navy-300 hover:text-white") : pref === value ? "bg-white text-navy-900 shadow-sm" : "text-navy-500 hover:text-navy-900",
          )}
        >
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
