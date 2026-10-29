import { z } from "zod";

/**
 * Ajuda contextual do motorista (regra pura, P23 B4). Tipos de problema com orientação do que fazer, sem
 * prometer prazo de resposta (não há base real para estimar) e sem sugerir manipulação do equipamento.
 */
export const HELP_TOPICS = {
  SEM_INICIO: { label: "Paguei e a recarga não começou", guidance: "Não pague de novo. Se o carregador não iniciar dentro do prazo, o pedido é encerrado sem nova cobrança e o valor pago vai para análise de estorno pela nossa equipe." },
  DUPLICADA: { label: "Cobrança aparentemente duplicada", guidance: "Não faça um novo pagamento. Cada pedido gera uma única cobrança; informe abaixo o que você vê no extrato e conferimos com o gateway antes de qualquer ajuste." },
  VALOR_DIVERGENTE: { label: "Valor final diferente do esperado", guidance: "O valor final usa a leitura do medidor no encerramento e a tarifa congelada no início. Conferimos a medição da sua recarga e o pagamento registrado." },
  NAO_ENCERRA: { label: "A recarga não encerra", guidance: "Você pode encerrar também pelo próprio veículo. Se o carregador estiver sem comunicação, o encerramento é registrado quando ele reconectar; o limite da sua compra continua protegido." },
  SEM_RESPOSTA: { label: "Carregador sem resposta ou sem energia", guidance: "Confira se o cabo está bem encaixado no veículo. Não abra, force nem desmonte o equipamento." },
  ESTORNO: { label: "Estorno ou devolução pendente", guidance: "No cartão, o estorno pode levar até 10 dias úteis para aparecer na fatura. A situação do estorno vem do gateway de pagamento; conferimos para você." },
  OUTRO: { label: "Outro assunto", guidance: "" },
} as const;
export type HelpTopic = keyof typeof HELP_TOPICS;
export const HELP_TOPIC_KEYS = Object.keys(HELP_TOPICS) as HelpTopic[];

/** Vale para qualquer tipo de problema com o equipamento: segurança antes de tudo. */
export const PHYSICAL_SAFETY_TEXT =
  "Se houver cheiro de queimado, faísca, fumaça, cabo danificado ou água no equipamento: afaste-se, não toque no carregador nem no cabo e siga as instruções de segurança do local ou procure a assistência adequada.";

export const helpContextSchema = z.object({
  sessao: z.string().regex(/^[a-z0-9]{10,40}$/).optional().catch(undefined),
  pedido: z.string().regex(/^[a-z0-9]{10,40}$/).optional().catch(undefined),
  tipo: z.enum(HELP_TOPIC_KEYS as [HelpTopic, ...HelpTopic[]]).optional().catch(undefined),
});

export function parseHelpContext(raw: Record<string, string | string[] | undefined>) {
  const one = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k]);
  return helpContextSchema.parse({ sessao: one("sessao"), pedido: one("pedido"), tipo: one("tipo") });
}

/** Assunto do chamado: o tipo escolhido vem primeiro para a equipe triar sem reler a mensagem. */
export function supportSubject(topic: HelpTopic | undefined, subject: string) {
  const s = subject.trim();
  if (!topic || topic === "OUTRO") return s;
  const label = HELP_TOPICS[topic].label;
  return s && s !== label ? `${label}: ${s}`.slice(0, 120) : label;
}
