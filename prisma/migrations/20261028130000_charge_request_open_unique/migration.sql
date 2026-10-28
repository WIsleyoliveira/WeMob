-- Um único pedido de recarga em aberto por motorista e por conector (aguardando pagamento ou o carregador).
-- Impede cobrança duplicada por cliques/requisições simultâneas e dois motoristas pagando pelo mesmo conector.
-- Índices parciais: existem só no SQL (o Prisma não os modela), como os demais do projeto.
CREATE UNIQUE INDEX "ChargeRequest_open_per_driver" ON "ChargeRequest" ("driverId") WHERE "status" IN ('AWAITING_PAYMENT', 'START_REQUESTED');
CREATE UNIQUE INDEX "ChargeRequest_open_per_connector" ON "ChargeRequest" ("stationId", "connectorId") WHERE "status" IN ('AWAITING_PAYMENT', 'START_REQUESTED');
