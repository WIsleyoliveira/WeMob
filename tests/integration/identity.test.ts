import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { login, resolveSession } from "@/server/auth/session";
import { changePassword, createPasswordResetLink, requestPasswordReset, resetPasswordWithToken } from "@/server/modules/identity/password-reset";
import { revokeMembership } from "@/server/modules/identity/service";
import type { EmailAdapter, EmailMessage } from "@/server/integrations/email";
import { __test } from "@/server/log";
import { bootstrapOperator, createOrg, createUser, resetDb, PASSWORD } from "./fixtures";

beforeEach(resetDb);
const NEW = "nova-senha-segura-456";

describe("redefinição de senha", () => {
  it("link do admin é de uso único, troca a senha e encerra as sessões", async () => {
    const op = await bootstrapOperator();
    const admin = await createUser(op.id, "admin");
    const user = await createUser(op.id, "commercial");
    const { token } = await createPasswordResetLink(admin.ctx, user.membership.id);
    await resetPasswordWithToken({ token, password: NEW, confirm: NEW });
    expect(await resolveSession(user.token)).toBeNull();
    await expect(login({ email: user.user.email, password: PASSWORD })).rejects.toThrow();
    await expect(login({ email: user.user.email, password: NEW })).resolves.toHaveProperty("token");
    await expect(resetPasswordWithToken({ token, password: NEW, confirm: NEW })).rejects.toThrow(/inválido ou expirado/);
  });

  it("link expirado é recusado e novo link invalida o anterior", async () => {
    const op = await bootstrapOperator();
    const admin = await createUser(op.id, "admin");
    const user = await createUser(op.id, "commercial");
    const first = await createPasswordResetLink(admin.ctx, user.membership.id);
    const second = await createPasswordResetLink(admin.ctx, user.membership.id);
    await expect(resetPasswordWithToken({ token: first.token, password: NEW, confirm: NEW })).rejects.toThrow(/inválido/);
    await db.passwordResetToken.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(resetPasswordWithToken({ token: second.token, password: NEW, confirm: NEW })).rejects.toThrow(/expirado/);
  });

  it("senha fraca ou confirmação divergente não altera nada", async () => {
    const op = await bootstrapOperator();
    const admin = await createUser(op.id, "admin");
    const user = await createUser(op.id, "commercial");
    const { token } = await createPasswordResetLink(admin.ctx, user.membership.id);
    await expect(resetPasswordWithToken({ token, password: "curta1", confirm: "curta1" })).rejects.toThrow();
    await expect(resetPasswordWithToken({ token, password: NEW, confirm: NEW + "x" })).rejects.toThrow();
    expect(await db.passwordResetToken.count({ where: { usedAt: null } })).toBe(1);
  });

  it("admin de outra organização não gera link para membro alheio", async () => {
    const op = await bootstrapOperator();
    const user = await createUser(op.id, "commercial");
    const other = await createOrg("Outra", "OPERATOR");
    const intruder = await createUser(other.id, "admin");
    await expect(createPasswordResetLink(intruder.ctx, user.membership.id)).rejects.toThrow(/não encontrado/);
  });

  it("admin não gera link para usuário que também pertence a outra organização", async () => {
    const op = await bootstrapOperator();
    const admin = await createUser(op.id, "admin");
    const partnerOrg = await createOrg("Parceiro", "PARTNER");
    const shared = await createUser(partnerOrg.id, "partner");
    const role = await db.role.findFirstOrThrow({ where: { organizationId: null, key: "commercial" } });
    const m = await db.membership.create({ data: { userId: shared.user.id, organizationId: op.id, roleId: role.id } });
    await expect(createPasswordResetLink(admin.ctx, m.id)).rejects.toThrow(/outras organizações/);
  });

  it("solicitação pública sem provedor de e-mail não gera token e é neutra", async () => {
    const op = await bootstrapOperator();
    const u = await createUser(op.id, "commercial");
    expect(await requestPasswordReset(u.user.email)).toEqual({ emailChannel: "not_configured" });
    expect(await requestPasswordReset("naoexiste@x.com")).toEqual({ emailChannel: "not_configured" });
    expect(await db.passwordResetToken.count()).toBe(0);
  });

  it("com adaptador configurado (fake de teste) envia só para usuário existente", async () => {
    const op = await bootstrapOperator();
    const u = await createUser(op.id, "commercial");
    const sent: EmailMessage[] = [];
    const fake: EmailAdapter = { name: "fake", status: "configured", send: async (m) => (sent.push(m), { delivered: true }) };
    await requestPasswordReset(u.user.email, { email: fake, baseUrl: "http://t" });
    await requestPasswordReset("naoexiste@x.com", { email: fake, baseUrl: "http://t" });
    expect(sent).toHaveLength(1);
    const token = sent[0].text.match(/token=([\w-]+)/)![1];
    await resetPasswordWithToken({ token, password: NEW, confirm: NEW });
  });

  it("troca de senha exige a atual e encerra outras sessões, mantendo a corrente", async () => {
    const op = await bootstrapOperator();
    const u = await createUser(op.id, "commercial");
    const { token: other } = await login({ email: u.user.email, password: PASSWORD });
    await expect(changePassword(u.ctx, { currentPassword: "errada-123456", password: NEW, confirm: NEW })).rejects.toThrow(/atual incorreta/);
    await changePassword(u.ctx, { currentPassword: PASSWORD, password: NEW, confirm: NEW });
    expect(await resolveSession(other)).toBeNull();
    expect(await resolveSession(u.token)).not.toBeNull();
  });
});

describe("proteções de acesso", () => {
  it("revogações sucessivas sempre mantêm ao menos um administrador ativo", async () => {
    const op = await bootstrapOperator();
    const admin = await createUser(op.id, "admin");
    const admin2 = await createUser(op.id, "admin");
    await revokeMembership(admin.ctx, admin2.membership.id);
    // Cria um terceiro admin e tenta revogar o primeiro a partir dele: permitido (ainda resta o terceiro).
    const admin3 = await createUser(op.id, "admin");
    await revokeMembership(admin3.ctx, admin.membership.id);
    // Agora admin3 é o único; não há quem possa revogá-lo além dele mesmo (bloqueado).
    await expect(revokeMembership(admin3.ctx, admin3.membership.id)).rejects.toThrow(/próprio/);
    expect(await db.membership.count({ where: { organizationId: op.id, revokedAt: null } })).toBe(1);
  });
});

describe("logs", () => {
  it("remove campos sensíveis em qualquer nível", () => {
    expect(__test.redact({ email: "a@b", password: "x", nested: { accessToken: "t", ok: 1 }, list: [{ secret: "s" }] })).toEqual({
      email: "a@b", password: "[redacted]", nested: { accessToken: "[redacted]", ok: 1 }, list: [{ secret: "[redacted]" }],
    });
  });
});
