export class AppError extends Error {
  constructor(
    public code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RATE_LIMITED",
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const forbidden = (msg = "Você não tem permissão para esta ação.") => new AppError("FORBIDDEN", msg);
export const notFound = (msg = "Registro não encontrado.") => new AppError("NOT_FOUND", msg);
