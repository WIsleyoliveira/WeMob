import { requirePage } from "@/server/auth/current";
import { SectionTabs } from "@/components/app/section-tabs";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requirePage("finance:read");
  return (
    <>
      <SectionTabs
        label="Seções do financeiro"
        tabs={[
          { href: "/app/financeiro", label: "Visão geral", exact: true },
          { href: "/app/financeiro/lancamentos", label: "Contas a pagar e receber" },
          { href: "/app/financeiro/fechamento", label: "Fechamento" },
          { href: "/app/financeiro/demonstrativo", label: "Demonstrativo" },
          { href: "/app/financeiro/tributos", label: "Tributos" },
        ]}
      />
      {children}
    </>
  );
}
