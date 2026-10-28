-- Momento em que o início foi pedido ao carregador (após o pagamento). Prazos do carregador contam daqui,
-- não da criação do pedido: no Pix/cartão o pagamento pode levar minutos. Nulo em pedidos antigos (usa createdAt).
ALTER TABLE "ChargeRequest" ADD COLUMN "startRequestedAt" TIMESTAMP(3);
