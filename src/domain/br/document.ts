/** CPF/CNPJ: normalização e dígitos verificadores (regra pública da Receita Federal). Sem I/O. */
export const onlyDigits = (v: string) => v.replace(/\D/g, "");

function cpfValid(d: string) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function cnpjValid(d: string) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((a, w, i) => a + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function isValidDocument(v: string) {
  const d = onlyDigits(v);
  return d.length === 11 ? cpfValid(d) : d.length === 14 ? cnpjValid(d) : false;
}

/** Ex.: "•••.•••.•••-09" — nunca o documento completo. */
export function documentHint(v: string) {
  const d = onlyDigits(v);
  return d.length === 14 ? `••.•••.•••/••••-${d.slice(-2)}` : `•••.•••.•••-${d.slice(-2)}`;
}
