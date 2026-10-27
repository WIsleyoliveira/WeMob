/**
 * OCPP 1.6-J — enquadramento RPC (CALL/CALLRESULT/CALLERROR) e validação das ações suportadas.
 * Suporte IMPLEMENTADO: subconjunto do perfil Core listado em SUPPORTED_INCOMING e REMOTE_ACTIONS.
 * Não há certificação nem teste de conformidade (OCTT): compatibilidade com equipamentos reais
 * precisa ser validada em bancada com cada fabricante/modelo.
 */
import { z } from "zod";

export const OCPP16_SUBPROTOCOL = "ocpp1.6";

export type OcppErrorCode =
  | "NotImplemented"
  | "NotSupported"
  | "InternalError"
  | "ProtocolError"
  | "SecurityError"
  | "FormationViolation"
  | "PropertyConstraintViolation"
  | "OccurenceConstraintViolation"
  | "TypeConstraintViolation"
  | "GenericError";

export class OcppError extends Error {
  constructor(public code: OcppErrorCode, message: string, public messageId?: string) {
    super(message);
  }
}

export type Frame =
  | { type: "CALL"; id: string; action: string; payload: unknown }
  | { type: "RESULT"; id: string; payload: unknown }
  | { type: "ERROR"; id: string; code: string; description: string; details: unknown };

export function parseFrame(raw: string): Frame {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new OcppError("FormationViolation", "JSON inválido.");
  }
  if (!Array.isArray(data) || data.length < 3) throw new OcppError("FormationViolation", "Mensagem não é um array OCPP.");
  const [kind, id] = data;
  if (typeof id !== "string" || id.length === 0 || id.length > 36) throw new OcppError("FormationViolation", "UniqueId inválido.");
  if (kind === 2) {
    if (data.length !== 4 || typeof data[2] !== "string") throw new OcppError("FormationViolation", "CALL malformado.", id);
    if (data[3] === null || typeof data[3] !== "object" || Array.isArray(data[3])) throw new OcppError("FormationViolation", "Payload deve ser objeto.", id);
    return { type: "CALL", id, action: data[2], payload: data[3] };
  }
  if (kind === 3) {
    if (data.length !== 3) throw new OcppError("FormationViolation", "CALLRESULT malformado.", id);
    return { type: "RESULT", id, payload: data[2] };
  }
  if (kind === 4) {
    if (data.length !== 5) throw new OcppError("FormationViolation", "CALLERROR malformado.", id);
    return { type: "ERROR", id, code: String(data[2]), description: String(data[3]), details: data[4] };
  }
  throw new OcppError("ProtocolError", "MessageTypeId desconhecido.", id);
}

export const callFrame = (id: string, action: string, payload: unknown) => JSON.stringify([2, id, action, payload]);
export const resultFrame = (id: string, payload: unknown) => JSON.stringify([3, id, payload]);
export const errorFrame = (id: string, code: OcppErrorCode, description: string) => JSON.stringify([4, id, code, description, {}]);

const ciString = (max: number) => z.string().max(max);
const dateTime = z.string().datetime({ offset: true }).transform((v) => new Date(v));

export const STATUS_16 = ["Available", "Preparing", "Charging", "SuspendedEVSE", "SuspendedEV", "Finishing", "Reserved", "Unavailable", "Faulted"] as const;
export const ERROR_CODES_16 = [
  "ConnectorLockFailure", "EVCommunicationError", "GroundFailure", "HighTemperature", "InternalError", "LocalListConflict",
  "NoError", "OtherError", "OverCurrentFailure", "PowerMeterFailure", "PowerSwitchFailure", "ReaderFailure", "ResetFailure",
  "UnderVoltage", "OverVoltage", "WeakSignal",
] as const;

const sampledValue = z.object({
  value: z.string().max(50),
  context: z.string().optional(),
  format: z.string().optional(),
  measurand: z.string().optional(),
  phase: z.string().optional(),
  location: z.string().optional(),
  unit: z.string().optional(),
});
export const meterValueSchema = z.object({ timestamp: dateTime, sampledValue: z.array(sampledValue).min(1).max(50) });

/** Ações recebidas do carregador que este CSMS processa. */
export const SUPPORTED_INCOMING = {
  BootNotification: z.object({
    chargePointVendor: ciString(20),
    chargePointModel: ciString(20),
    chargePointSerialNumber: ciString(25).optional(),
    chargeBoxSerialNumber: ciString(25).optional(),
    firmwareVersion: ciString(50).optional(),
    iccid: ciString(20).optional(),
    imsi: ciString(20).optional(),
    meterType: ciString(25).optional(),
    meterSerialNumber: ciString(25).optional(),
  }),
  Heartbeat: z.object({}).strict(),
  StatusNotification: z.object({
    connectorId: z.number().int().min(0).max(99),
    errorCode: z.enum(ERROR_CODES_16),
    status: z.enum(STATUS_16),
    timestamp: dateTime.optional(),
    info: ciString(50).optional(),
    vendorId: ciString(255).optional(),
    vendorErrorCode: ciString(50).optional(),
  }),
  Authorize: z.object({ idTag: ciString(20).min(1) }),
  StartTransaction: z.object({
    connectorId: z.number().int().min(1).max(99),
    idTag: ciString(20).min(1),
    meterStart: z.number().int().min(0),
    timestamp: dateTime,
    reservationId: z.number().int().optional(),
  }),
  StopTransaction: z.object({
    transactionId: z.number().int(),
    meterStop: z.number().int().min(0),
    timestamp: dateTime,
    idTag: ciString(20).optional(),
    reason: z.string().max(30).optional(),
    transactionData: z.array(meterValueSchema).max(500).optional(),
  }),
  MeterValues: z.object({
    connectorId: z.number().int().min(0).max(99),
    transactionId: z.number().int().optional(),
    meterValue: z.array(meterValueSchema).min(1).max(500),
  }),
} as const;
export type IncomingAction = keyof typeof SUPPORTED_INCOMING;
export const isSupported = (a: string): a is IncomingAction => a in SUPPORTED_INCOMING;

/** Ações que o CSMS envia (comandos remotos implementados). */
export const REMOTE_ACTIONS = {
  RESET: "Reset",
  REMOTE_START: "RemoteStartTransaction",
  REMOTE_STOP: "RemoteStopTransaction",
  UNLOCK_CONNECTOR: "UnlockConnector",
  CHANGE_AVAILABILITY: "ChangeAvailability",
} as const;

/** Conversão de amostras de energia/potência para Wh/W. Retorna null quando a unidade não é suportada. */
export function readSample(values: z.infer<typeof sampledValue>[], measurand: "Energy.Active.Import.Register" | "Power.Active.Import"): number | null {
  const s = values.find((v) => (v.measurand ?? "Energy.Active.Import.Register") === measurand && (v.phase === undefined || v.phase === null));
  if (!s) return null;
  const n = Number(s.value);
  if (!Number.isFinite(n)) return null;
  const unit = s.unit ?? (measurand === "Power.Active.Import" ? "W" : "Wh");
  if (unit === "Wh" || unit === "W") return Math.round(n);
  if (unit === "kWh" || unit === "kW") return Math.round(n * 1000);
  return null;
}

export const STATUS_MAP = {
  Available: "AVAILABLE",
  Preparing: "PREPARING",
  Charging: "CHARGING",
  SuspendedEVSE: "SUSPENDED_EVSE",
  SuspendedEV: "SUSPENDED_EV",
  Finishing: "FINISHING",
  Reserved: "RESERVED",
  Unavailable: "UNAVAILABLE",
  Faulted: "FAULTED",
} as const;
