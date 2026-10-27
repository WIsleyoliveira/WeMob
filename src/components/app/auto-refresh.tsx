"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Atualiza os dados do servidor periodicamente (sessão em andamento). Pausa com a aba oculta. */
export function AutoRefresh({ ms = 5000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(id);
  }, [ms, router]);
  return null;
}
