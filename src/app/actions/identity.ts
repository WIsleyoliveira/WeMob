"use server";
import { revalidatePath } from "next/cache";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { revokeMembership } from "@/server/modules/identity/service";

export async function revokeMembershipAction(_prev: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const res = await toActionState(() => revokeMembership(ctx, String(f.get("membershipId"))), "Acesso revogado e sessões encerradas.");
  revalidatePath("/app/usuarios");
  return res;
}
