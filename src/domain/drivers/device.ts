/**
 * Rótulo genérico do aparelho de uma sessão do motorista (regra pura). Só navegador e sistema, para a pessoa
 * reconhecer os próprios acessos na lista "Aparelhos conectados". O User-Agent completo NÃO é guardado
 * (minimização, LGPD): versão, modelo do aparelho e demais detalhes são descartados aqui.
 */

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\b(Headless)?Chrome\/|\bCriOS\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

export const UNKNOWN_DEVICE = "Aparelho não identificado";

export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").slice(0, 512);
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && system) return `${browser} no ${system}`;
  return browser ?? system ?? UNKNOWN_DEVICE;
}

/** Intervalo mínimo entre atualizações do "último uso" (evita uma escrita no banco por requisição). */
export const DEVICE_TOUCH_INTERVAL_MS = 5 * 60_000;

export function shouldTouchDevice(lastSeenAt: Date | null, now = new Date()) {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() >= DEVICE_TOUCH_INTERVAL_MS;
}
