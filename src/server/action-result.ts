import { ZodError } from "zod";
import { AppError } from "./errors";
import { log } from "./log";

export type ActionState<T = unknown> =
  | { status: "idle" }
  | { status: "ok"; data?: T; message?: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

export const idle: ActionState = { status: "idle" };

/** Converte exceções conhecidas em estado de formulário; erros inesperados são logados sem dados sensíveis. */
export async function toActionState<T>(fn: () => Promise<T>, okMessage?: string): Promise<ActionState<T>> {
  try {
    const data = await fn();
    return { status: "ok", data, message: okMessage };
  } catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of e.issues) {
        const k = issue.path.join(".");
        if (!fieldErrors[k]) fieldErrors[k] = issue.message;
      }
      return { status: "error", message: "Revise os campos destacados.", fieldErrors };
    }
    if (e instanceof AppError) return { status: "error", message: e.message };
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect/notFound do Next
    log.error("action_failed", { error: e instanceof Error ? e.message : String(e) });
    return { status: "error", message: "Não foi possível concluir a operação. Tente novamente." };
  }
}
