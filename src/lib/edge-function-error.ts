import { AiRequestTimeoutError } from "./ai-request-timeout";

/** Preserve the actionable gateway/provider status instead of Supabase's generic non-2xx label. */
export async function describeEdgeFunctionError(error: unknown): Promise<string> {
  if (error instanceof AiRequestTimeoutError) return error.message;
  const candidate = error as { message?: string; context?: unknown } | null;
  const context = candidate?.context;
  if (context && typeof context === "object" && "clone" in context &&
    typeof (context as Response).clone === "function") {
    const response = context as Response;
    const status = response.status;
    const raw = await response.clone().text().catch(() => "");
    let detail = "";
    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      detail = [body.error, body.message, body.code].find((value): value is string =>
        typeof value === "string" && !!value.trim()) || "";
    } catch {
      detail = raw.trim();
    }
    if (detail) return `HTTP ${status}: ${detail.slice(0, 300)}`;
    return `Friend AI request failed (HTTP ${status}). Please retry.`;
  }
  return String(candidate?.message || "Friend AI request failed. Please retry.");
}
