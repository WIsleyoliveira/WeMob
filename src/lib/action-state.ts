/** Estado de formulário com server action — seguro para componentes do navegador (sem código de servidor). */
export type ActionState<T = unknown> =
  | { status: "idle" }
  | { status: "ok"; data?: T; message?: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

export const idle: ActionState = { status: "idle" };
