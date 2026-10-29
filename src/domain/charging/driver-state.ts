/**
 * Estados da recarga vistos pelo motorista (regra pura). Converte os estados técnicos (pedido, comando
 * OCPP, sessão) em etapas claras SEM mudar o significado operacional: "ordem enviada" ≠ "ordem aceita pelo
 * carregador" ≠ "recarga iniciada", e "encerramento solicitado" ≠ "encerramento confirmado". Sucesso só com
 * confirmação do equipamento (StartTransaction / StopTransaction).
 */

export type CommandStatus = "PENDING" | "SENT" | "ACCEPTED" | "REJECTED" | "TIMEOUT" | "FAILED" | "BLOCKED";
type RequestStatus = "AWAITING_PAYMENT" | "START_REQUESTED" | "STARTED" | "FAILED" | "CANCELLED" | "EXPIRED";
type SessionStatus = "ACTIVE" | "COMMUNICATION_LOST" | "COMPLETED";

export type StartStage = "PAYMENT_PENDING" | "START_SENDING" | "START_ACCEPTED" | "START_REFUSED" | "STARTED" | "ENDED";

/** Etapa do início: só conta como iniciada quando o carregador abre a transação (pedido STARTED). */
export function startStage(request: RequestStatus, command: CommandStatus | null): StartStage {
  if (request === "AWAITING_PAYMENT") return "PAYMENT_PENDING";
  if (request === "STARTED") return "STARTED";
  if (request !== "START_REQUESTED") return "ENDED";
  if (command === "ACCEPTED") return "START_ACCEPTED";
  if (command && ["REJECTED", "TIMEOUT", "FAILED", "BLOCKED"].includes(command)) return "START_REFUSED";
  return "START_SENDING"; // sem comando ainda, PENDING ou SENT
}

export const START_STAGE_TEXT: Record<Exclude<StartStage, "PAYMENT_PENDING" | "ENDED">, string> = {
  START_SENDING: "Pagamento confirmado. Estamos enviando a ordem de início ao carregador — mantenha o cabo conectado.",
  START_ACCEPTED: "O carregador aceitou a ordem de início. Aguardando o início efetivo da recarga — mantenha o cabo conectado.",
  START_REFUSED:
    "O carregador não aceitou a ordem de início. Confira se o cabo está bem conectado. Se a recarga não começar dentro do prazo, o pedido é encerrado sem nova cobrança e o valor pago vai para análise de estorno.",
  STARTED: "Recarga iniciada pelo carregador.",
};

export type StopStage = "NONE" | "STOP_SENDING" | "STOP_ACCEPTED" | "STOP_REFUSED" | "STOPPED";

/** Etapa do encerramento: só "encerrada" quando a sessão é concluída pelo carregador. */
export function stopStage(session: SessionStatus, command: CommandStatus | null): StopStage {
  if (session === "COMPLETED") return "STOPPED";
  if (!command) return "NONE";
  if (command === "ACCEPTED") return "STOP_ACCEPTED";
  if (["REJECTED", "TIMEOUT", "FAILED", "BLOCKED"].includes(command)) return "STOP_REFUSED";
  return "STOP_SENDING";
}

export const STOP_STAGE_TEXT: Record<Exclude<StopStage, "NONE" | "STOPPED">, string> = {
  STOP_SENDING: "Solicitação de encerramento enviada ao carregador. O valor final aparece quando ele confirmar o encerramento.",
  STOP_ACCEPTED: "O carregador aceitou o encerramento. Aguardando a confirmação final com a leitura do medidor.",
  STOP_REFUSED: "O carregador não confirmou o pedido de encerramento. Você pode tentar de novo ou encerrar pelo próprio veículo.",
};

/** O botão de encerrar só volta a aparecer quando não há pedido em curso (nunca dois pedidos simultâneos). */
export function canRequestStop(session: SessionStatus, stage: StopStage) {
  return session === "ACTIVE" && (stage === "NONE" || stage === "STOP_REFUSED");
}
