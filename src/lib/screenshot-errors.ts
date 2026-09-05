export async function screenshotErrorMessage(error: unknown, fallback: string): Promise<string> {
  const failure = error as { message?: string; context?: Response } | null;
  if (failure?.context && typeof failure.context.clone === "function") {
    try {
      const body = await failure.context.clone().json();
      if (typeof body?.error === "string" && body.error.trim()) return body.error;
    } catch { /* Network failures may not contain a JSON response. */ }
  }
  return failure?.message || fallback;
}
