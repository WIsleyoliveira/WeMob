# Runbook operacional (inicial)

## Saúde
`GET /api/health` → 200 `{status:"ok"}` ou 503 se o banco estiver inacessível.

## Deploy
1. `npm run check` verde no CI.
2. Backup do banco (`pg_dump -Fc`).
3. `prisma migrate deploy` (executado no start do container). Nunca usar `migrate reset` fora do banco de teste.
4. Rollback de aplicação: reimplantar a imagem anterior. Migrações são somente aditivas; reversão de esquema exige migração nova.

## Backup e restauração
- Diário: `pg_dump -Fc "$DATABASE_URL" > sansol-$(date +%F).dump` com retenção de 30 dias em storage externo.
- Teste mensal: `pg_restore -d sansol_restore_test sansol-AAAA-MM-DD.dump` e `npm run db:deploy` contra a cópia.
- **Pendente:** automação e evidência do primeiro teste de restauração (ver IMPLEMENTATION_STATUS.md).

## Incidentes
- Acesso indevido suspeito: revogar vínculos em /app/usuarios (encerra sessões); consultar /app/auditoria.
- Pico de spam no formulário: limite por IP já ativo (5/h); ajustar em `submitPublicLead`.
- Logs: JSON em stdout (`level`, `msg`); nunca registrar senhas, tokens ou dados de cartão.

## Servidor OCPP (carregadores)
- Processo separado: `npm run ocpp:server` (porta `OCPP_PORT`, padrão 9220). URL do carregador: `wss://<host>/ocpp/<identidade>` com subprotocolo `ocpp1.6` e HTTP Basic (usuário = identidade, senha gerada no cadastro da estação).
- **TLS obrigatório em produção** (proxy reverso). Basic sem TLS expõe a senha.
- Comandos remotos ficam numa fila no banco; o servidor OCPP entrega os pendentes das estações conectadas a cada 1 s e marca TIMEOUT após 30 s sem resposta.
- Estação sem mensagens por mais de 2 × heartbeat + 60 s → `DISCONNECTED`, conectores `UNKNOWN`, sessões `COMMUNICATION_LOST` (varredura a cada 30 s e ao fechar o WebSocket).
- Comandos em equipamentos de produção: desligados por padrão (`OCPP_ALLOW_PRODUCTION_COMMANDS=0`) e restritos a superadministrador.
- Senha de carregador vazada: "Gerar nova senha" na página da estação e reconfigurar o equipamento.
