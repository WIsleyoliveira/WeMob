import { requirePage } from "@/server/auth/current";
import { SectionTabs } from "@/components/app/section-tabs";

export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  await requirePage("support:read");
  return (
    <>
      <SectionTabs label="Seções do suporte" tabs={[{ href: "/app/suporte", label: "Tickets", exact: true }, { href: "/app/suporte/novo", label: "Novo ticket" }, { href: "/app/suporte/painel", label: "Painel operacional" }, { href: "/app/suporte/configurar", label: "SLA" }]} />
      {children}
    </>
  );
}
