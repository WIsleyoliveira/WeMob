"use client";
import { StateMessage } from "@/components/ui/state";
import { Button } from "@/components/ui/button";

export default function AppError({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <StateMessage
      kind="error"
      title="Não foi possível carregar esta página"
      description={<>Tente novamente. Se persistir, informe o código ao suporte{error.digest ? `: ${error.digest}` : ""}.</>}
      action={<Button onClick={reset}>Tentar novamente</Button>}
    />
  );
}
