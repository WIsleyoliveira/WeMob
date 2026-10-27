import QRCode from "qrcode";

/** QR Code impresso no carregador: abre o início de recarga daquele conector no portal do motorista. */
export async function ConnectorQr({ baseUrl, identity, connectorId }: { baseUrl: string; identity: string; connectorId: number }) {
  const url = `${baseUrl}/motorista/carregar/${encodeURIComponent(identity)}/${connectorId}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <figure className="flex flex-col items-center gap-1 text-center">
      <div className="size-32" role="img" aria-label={`QR Code do conector ${connectorId}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className="break-all text-[10px] text-navy-500">Conector {connectorId}<br />{url}</figcaption>
    </figure>
  );
}
