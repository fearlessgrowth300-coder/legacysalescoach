// Find the user's own Sales Brain lessons that fit a situation (semantic search),
// at most 2 per source so one book doesn't dominate. Used by the practice-call
// learning guide and the after-call scoring. "" when nothing is found.
import { resolveUserEmbedTarget, userEmbed } from "./user-ai.ts";

export async function searchPlaybook(supabase: any, userId: string, query: string, limit = 8): Promise<{ text: string; names: string[] }> {
  try {
    const emb = await userEmbed(await resolveUserEmbedTarget(supabase, userId), query.slice(0, 3000));
    if (!emb) return { text: "", names: [] };
    const { data: matches } = await supabase.rpc("match_sales_brain", {
      query_embedding: JSON.stringify(emb), match_count: limit * 3, match_threshold: 0.1, p_user_id: userId,
    });
    const ids = (matches || []).map((m: any) => m.id).filter(Boolean);
    if (!ids.length) return { text: "", names: [] };
    const { data: rows } = await supabase.from("sales_brain")
      .select("id, principle_name, category, what_i_learned, how_to_apply, exact_words_to_use, source_name")
      .in("id", ids);
    const byId = new Map((rows || []).map((r: any) => [r.id, r]));
    const perSource: Record<string, number> = {};
    const picked: any[] = [];
    for (const id of ids) { // keep similarity order
      const p: any = byId.get(id);
      if (!p) continue;
      const key = (p.source_name || "x").toLowerCase();
      if ((perSource[key] = (perSource[key] || 0) + 1) > 2) continue;
      picked.push(p);
      if (picked.length >= limit) break;
    }
    // Variety only when there's a choice: if the best matches all come from one
    // book (e.g. "Way of the Wolf" for the Wolf scenario), fill up with them
    // instead of returning just 2 lessons.
    for (const id of ids) {
      if (picked.length >= limit) break;
      const p: any = byId.get(id);
      if (p && !picked.includes(p)) picked.push(p);
    }
    const text = picked.map((p, i) =>
      `${i + 1}. ${p.principle_name} (from "${p.source_name}", ${p.category}): ${(p.what_i_learned || "").slice(0, 240)}` +
      (p.exact_words_to_use ? ` | Exact words: ${String(p.exact_words_to_use).slice(0, 160)}` : "") +
      (p.how_to_apply ? ` | Apply: ${String(p.how_to_apply).slice(0, 160)}` : "")
    ).join("\n");
    return { text, names: picked.map((p) => p.principle_name).filter(Boolean) };
  } catch (e) {
    console.warn("[playbook-search] failed:", e instanceof Error ? e.message : e);
    return { text: "", names: [] };
  }
}
