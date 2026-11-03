import type { MetadataRoute } from "next";

/**
 * PWA do motorista: instalável na tela inicial, abrindo direto em /motorista.
 * Sem service worker de propósito: telas de pagamento e recarga mostram dinheiro e estado do carregador e nunca podem
 * vir de cache. Sem rede, o navegador mostra a própria página de erro (o app não finge estar atualizado).
 * Nome exibido: marca atual da interface — a marca definitiva (WeMob/WAPE × Sansol Mob) é decisão pendente.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/motorista",
    name: "Sansol Mob — Recarga de veículos elétricos",
    short_name: "Sansol Mob",
    description: "Encontre carregadores, pague e acompanhe sua recarga.",
    lang: "pt-BR",
    start_url: "/motorista",
    scope: "/motorista",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f9fb",
    theme_color: "#0d1828",
    categories: ["travel", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
