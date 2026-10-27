import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.PUBLIC_SITE_URL ?? "http://localhost:3000";
  return ["", "/modelos", "/simulador", "/contato", "/privacidade", "/termos"].map((p) => ({ url: `${base}${p}`, changeFrequency: "monthly" }));
}
