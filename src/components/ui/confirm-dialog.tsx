"use client";

import { useEffect, useRef } from "react";
import { Button } from "./button";

/** Diálogo modal acessível (elemento <dialog> nativo: foco preso, Esc fecha). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  tone = "primary",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      aria-labelledby="confirm-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-[var(--radius-card)] bg-white p-0 text-navy-900 shadow-2xl backdrop:bg-navy-950/50 open:animate-fade-in"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="font-display text-lg font-semibold text-navy-900">{title}</h2>
        {description && <p className="mt-2 text-sm text-navy-600">{description}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} autoFocus>Cancelar</Button>
          <Button type="button" variant={tone} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}
