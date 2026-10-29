"use client";
import { useState } from "react";
import { LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistance, sortByDistance } from "@/domain/stations/discovery";

type Item = { id: string; lat: number | null; lon: number | null; card: React.ReactNode };
type State = { kind: "idle" } | { kind: "locating" } | { kind: "sorted" } | { kind: "error"; message: string };

/**
 * Lista de estações com ordenação opcional por distância. A localização só é pedida quando o motorista toca no
 * botão, fica apenas na memória desta tela e nunca é enviada ao servidor nem gravada. Sem permissão, a lista
 * continua funcionando na ordem padrão. A distância é em linha reta (não é rota nem tempo de viagem).
 */
export function NearbyList({ items }: { items: Item[] }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [sorted, setSorted] = useState<(Item & { km: number | null })[] | null>(null);
  const canLocate = items.some((i) => i.lat !== null && i.lon !== null);

  function locate() {
    if (!("geolocation" in navigator)) return setState({ kind: "error", message: "Este navegador não informa a localização. A lista segue na ordem padrão." });
    setState({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSorted(sortByDistance(items, { lat: pos.coords.latitude, lon: pos.coords.longitude }));
        setState({ kind: "sorted" });
      },
      (err) =>
        setState({
          kind: "error",
          message: err.code === err.PERMISSION_DENIED ? "Sem permissão de localização. A lista segue na ordem padrão — você pode filtrar por conector, potência ou preço." : "Não foi possível obter sua localização agora. A lista segue na ordem padrão.",
        }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  const list = sorted ?? items.map((i) => ({ ...i, km: null }));
  return (
    <>
      {canLocate && (
        <div className="mt-3 rounded-xl border border-navy-100 bg-white p-3">
          {state.kind === "sorted" ? (
            <p className="text-sm text-navy-700" role="status">
              Ordenado pela distância em linha reta até você. Sua localização não é gravada.{" "}
              <button type="button" className="font-medium text-brand-700 underline" onClick={() => { setSorted(null); setState({ kind: "idle" }); }}>
                Voltar à ordem padrão
              </button>
            </p>
          ) : (
            <>
              <Button type="button" variant="secondary" size="sm" onClick={locate} disabled={state.kind === "locating"}>
                <LocateFixed className="size-4" aria-hidden />
                {state.kind === "locating" ? "Obtendo localização…" : "Ordenar pelas mais próximas"}
              </Button>
              <p className="mt-2 text-xs text-navy-500">Usamos sua localização só nesta tela, para calcular a distância. Ela não é enviada nem gravada.</p>
              {state.kind === "error" && <p className="mt-2 text-sm text-navy-700" role="status">{state.message}</p>}
            </>
          )}
        </div>
      )}
      <ul className="mt-4 flex flex-col gap-3" aria-label="Estações">
        {list.map((i) => (
          <li key={i.id}>
            {state.kind === "sorted" && <p className="mb-1 text-xs font-medium text-navy-600">{i.km === null ? "Sem coordenadas cadastradas" : `${formatDistance(i.km)} em linha reta`}</p>}
            {i.card}
          </li>
        ))}
      </ul>
    </>
  );
}
