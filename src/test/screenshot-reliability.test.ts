import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { callGeminiNativeVision, normalizeGeminiModel } from "../../supabase/functions/_shared/gemini-models";
import { screenshotErrorMessage } from "../lib/screenshot-errors";

// Execute the real edge handler with mocked boundaries (no network, uploads,
// provider credits or private content). This catches unbound runtime identifiers.
function ocrHandler() {
  let handler!: (request: Request) => Promise<Response>;
  const db = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: "test-owner" } }, error: null })) } };
  const keyLookup = vi.fn(async () => ({ key: "synthetic-key" }));
  const vision = vi.fn(async () => JSON.stringify({ platform: "Instagram", name: "Synthetic test",
    messages: [{ speaker: "them", alignment: "right", text: "Hello!", order: 1 },
      { speaker: "them", alignment: "left", text: "Thanks for connecting.", order: 2 }] }));
  const source = readFileSync(resolve(process.cwd(), "supabase/functions/ocr-screenshot/index.ts"), "utf8")
    .replace(/^import[\s\S]*?;\r?\n/gm, "");
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("serve", "createClient", "resolveUserChatTarget", "NoUserAiKeyError", "getUserAiKey",
    "buildVisionModelChain", "callGeminiNativeVision", "userChat", "Deno", js)(
    (fn: typeof handler) => { handler = fn; }, () => db,
    async () => ({ provider: "gemini", models: { vision: "gemini-3.8-flash" } }), Error,
    keyLookup, () => [], vision, vi.fn(), { env: { get: () => "synthetic-only" } });
  return { handler, db, keyLookup, vision };
}

describe("screenshot OCR repair", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the initialized database client and preserves bubble direction", async () => {
    const test = ocrHandler();
    const response = await test.handler(new Request("https://example.test/ocr", { method: "POST",
      headers: { Authorization: "Bearer synthetic-session" }, body: JSON.stringify({ imageBase64: "synthetic-image" }) }));
    expect(response.status).toBe(200);
    expect(test.keyLookup).toHaveBeenCalledWith(test.db, "test-owner");
    const body = await response.json();
    expect(body.text).toContain("Me: Hello!");
    expect(body.text).toContain("Them: Thanks for connecting.");
  });
  it("does not read another user's screenshot with service privileges", async () => {
    const test = ocrHandler();
    const response = await test.handler(new Request("https://example.test/ocr", { method: "POST",
      body: JSON.stringify({ filePath: "another-owner/image.png" }) }));
    expect(response.status).toBe(403);
    expect(test.vision).not.toHaveBeenCalled();
  });
  it("shows the actual backend error in the upload workflow", async () => {
    expect(await screenshotErrorMessage({ context: new Response(JSON.stringify({ error: "Gemini rate limit reached" })) }, "Generic error"))
      .toBe("Gemini rate limit reached");
  });
  it("preserves Gemini 3.8 and reads text after thinking parts", async () => {
    expect(normalizeGeminiModel("google/gemini-3.8-flash")).toBe("gemini-3.8-flash");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { thought: true, text: "Internal analysis" }, { text: '{"messages":[]}' },
    ] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await callGeminiNativeVision("synthetic", "Read this test", [], "gemini-3.8-flash", { json: true, strict: true }))
      .toBe('{"messages":[]}');
    const options = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(options[0]).toContain("gemini-3.8-flash:generateContent");
    expect(options[1].headers).toMatchObject({ "x-goog-api-key": "synthetic" });
    expect(options[1].headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(String(options[1].body)).generationConfig.temperature).toBeUndefined();
  });
  it("stops quota retry loops and reports a usable error", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callGeminiNativeVision("synthetic", "test", [], "gemini-3.8-flash", { strict: true })).rejects.toThrow("rate limit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
