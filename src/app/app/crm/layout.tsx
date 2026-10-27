import { requirePage } from "@/server/auth/current";
import { CrmTabs } from "./crm-tabs";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePage("lead:read");
  return (
    <>
      <CrmTabs canConfigure={ctx.permissions.has("crm:configure")} />
      {children}
    </>
  );
}
