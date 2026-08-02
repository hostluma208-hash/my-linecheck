import { createServerFn } from "@tanstack/react-start";
import type { Creds } from "@/lib/staffAuth.server";

type Input = Creds & {
  kind: "receiving" | "closing";
  record_id: string;
  brand_name: string;
  payload: Record<string, unknown>;
};

/** Public: publish a share link on behalf of a verified PIN (team member) user. */
export const staffPublishShare = createServerFn({ method: "POST" })
  .inputValidator((input: Input) => input)
  .handler(async ({ data }) => {
    const { validCreds, verifyStaff } = await import("@/lib/staffAuth.server");
    const row = await verifyStaff(validCreds(data));
    if (!row) throw new Error("Invalid team member session");
    const kind = data.kind === "closing" ? "closing" : "receiving";
    const record_id = String(data.record_id ?? "").slice(0, 200);
    if (!record_id) throw new Error("Missing record id");
    const brand_name = String(data.brand_name ?? "LUMA").slice(0, 120);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const table = kind === "closing" ? "shared_closings" : "shared_receivings";
    const { data: out, error } = await supabaseAdmin
      .from(table)
      .upsert(
        {
          owner_id: row.owner_id,
          record_id,
          brand_name,
          payload: data.payload as never,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,record_id" },
      )
      .select("id")
      .single();
    if (error || !out) throw error ?? new Error("Failed to publish share");
    return { id: out.id as string };
  });
