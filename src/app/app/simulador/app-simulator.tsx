"use client";
import { Simulator, type SimulatorModel } from "@/components/simulator/simulator";
import { saveSimulationAction } from "@/app/actions/commercial";

export function AppSimulator({ models, leadId }: { models: SimulatorModel[]; leadId?: string }) {
  return <Simulator models={models} mode="app" onSave={(p) => saveSimulationAction({ ...p, leadId })} />;
}
