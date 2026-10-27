"use client";
import { useRouter } from "next/navigation";
import { Simulator, type SimulatorModel } from "@/components/simulator/simulator";
import { saveSimulationAction } from "@/app/actions/commercial";
import type { ParsedViabilityInput } from "@/domain/viability/engine";

export function AppSimulator({
  models,
  leadId,
  parent,
}: {
  models: SimulatorModel[];
  leadId?: string;
  parent?: { id: string; name: string; versionId?: string; input: ParsedViabilityInput };
}) {
  const router = useRouter();
  return (
    <Simulator
      models={models}
      mode="app"
      initial={parent ? { input: parent.input, versionId: parent.versionId, name: `${parent.name} (revisão)` } : undefined}
      onSave={async (p) => {
        const r = await saveSimulationAction({ ...p, leadId, parentId: parent?.id });
        if (r.status === "ok" && r.data) router.push(`/app/simulador/${r.data.id}`);
        return r;
      }}
    />
  );
}
