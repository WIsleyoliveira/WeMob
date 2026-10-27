import { uploadAttachmentAction } from "@/app/actions/contracts";
import { ActionForm } from "@/components/app/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { dateTime } from "@/lib/format";

type Item = { id: string; filename: string; size: number; createdAt: Date; visibleToPartner?: boolean; sha256?: string };

/** Lista e envio de anexos (PDF/PNG/JPEG/WEBP até 5 MB; tipo conferido pelo conteúdo no servidor). */
export function Attachments({ title = "Anexos", entityType, entityId, items, canUpload, partnerOption }: { title?: string; entityType: string; entityId: string; items: Item[]; canUpload: boolean; partnerOption?: boolean }) {
  return (
    <Card>
      <CardHeader title={title} description="PDF, PNG, JPEG ou WEBP até 5 MB. Downloads são registrados na auditoria." />
      <CardBody className="space-y-4">
        {items.length === 0 ? <p className="text-sm text-navy-500">Nenhum arquivo anexado.</p> : (
          <ul className="divide-y divide-navy-50 text-sm">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a className="break-all font-medium text-brand-700 hover:underline" href={`/api/anexos/${a.id}`}>{a.filename}</a>
                <span className="text-xs text-navy-400">{(a.size / 1024).toFixed(0)} KB · {dateTime(a.createdAt)} {a.visibleToPartner && <Badge tone="tiffany">visível ao parceiro</Badge>}</span>
              </li>
            ))}
          </ul>
        )}
        {canUpload && (
          <ActionForm action={uploadAttachmentAction} submitLabel="Enviar arquivo" pendingLabel="Enviando…" size="sm">
            <input type="hidden" name="entityType" value={entityType} />
            <input type="hidden" name="entityId" value={entityId} />
            <input type="file" name="file" required accept="application/pdf,image/png,image/jpeg,image/webp" aria-label="Arquivo" className="text-sm" />
            {partnerOption && <label className="flex items-center gap-2 text-sm text-navy-700"><input type="checkbox" name="visibleToPartner" /> Disponibilizar no portal do parceiro</label>}
          </ActionForm>
        )}
      </CardBody>
    </Card>
  );
}
