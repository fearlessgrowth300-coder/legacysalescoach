import { describe, expect, it } from "vitest";
import { describeEdgeFunctionError } from "@/lib/edge-function-error";

describe("Friend Edge Function errors", () => {
  it("shows provider errors and HTTP status", async () => {
    const context = new Response(JSON.stringify({ error: "Gemini rate limit reached" }), { status: 500 });
    expect(await describeEdgeFunctionError({ message: "Edge Function returned a non-2xx status code", context }))
      .toBe("HTTP 500: Gemini rate limit reached");
  });

  it("shows gateway codes when there is no app error field", async () => {
    const context = new Response(JSON.stringify({ code: "WORKER_RESOURCE_LIMIT", message: "CPU Time exceeded" }), { status: 546 });
    expect(await describeEdgeFunctionError({ context })).toBe("HTTP 546: CPU Time exceeded");
  });

  it("keeps a useful status for an empty gateway response", async () => {
    const context = new Response("", { status: 503 });
    expect(await describeEdgeFunctionError({ context })).toContain("HTTP 503");
  });
});
