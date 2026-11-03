"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

/** Botão "Menu" do celular: abre/fecha a navegação lateral; fecha sozinho ao trocar de página ou com Esc. */
export function MobileNavToggle({ targetId }: { targetId: string }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (el) el.dataset.open = open ? "true" : "false";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, targetId]);
  return (
    <button type="button" aria-controls={targetId} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex size-9 items-center justify-center rounded-lg text-navy-700 hover:bg-navy-100 lg:hidden">
      {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      <span className="sr-only">{open ? "Fechar menu" : "Abrir menu"}</span>
    </button>
  );
}
