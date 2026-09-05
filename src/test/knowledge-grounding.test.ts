import { describe, expect, it, vi, afterEach } from "vitest";
import { readGroundingVerdict } from "../../supabase/functions/_shared/knowledge-grounding";
import { buildBrainRetrievalMeta } from "../../supabase/functions/brain-chat/lib";
import { embedBatch } from "../../supabase/functions/_shared/embedding-batch";
import { userEmbed } from "../../supabase/functions/_shared/user-ai";
import { aiEmbed, type AiProvider } from "../../supabase/functions/_shared/ai-provider";

const draft = 'Ask which part remains uncertain before choosing relevant evidence.';
const unknown = (text: string) => text.includes('Invented Book') ? ['Invented Book'] : [];
describe('source verification', () => {
  it('rejects unavailable, malformed, or contradictory verdicts', () => {
    for (const raw of ['', '{}', '{"pass":"true","issues":[]}', '{"pass":true}', '{"pass":true,"issues":["unsupported claim"]}'])
      expect(() => readGroundingVerdict(raw,draft,unknown)).toThrow();
  });
  it('never releases a rejected draft without a corrected answer', () => {
    expect(() => readGroundingVerdict(JSON.stringify({pass:false,issues:['unsupported claim']}),draft,unknown)).toThrow();
    expect(() => readGroundingVerdict(JSON.stringify({pass:false,issues:['unsupported claim'],corrected_response:draft}),draft,unknown)).toThrow();
  });
  it('rechecks repaired citations and preserves a verified correction', () => {
    expect(() => readGroundingVerdict(JSON.stringify({pass:false,issues:['citation'],corrected_response:'This advice comes from the Invented Book.'}),draft,unknown)).toThrow();
    const corrected='A relevant case study may help once the concern is understood.';
    expect(readGroundingVerdict(JSON.stringify({pass:false,issues:['overclaim'],corrected_response:corrected}),draft,unknown))
      .toMatchObject({response:corrected,repaired:true,issues:[],resolvedIssues:['overclaim']});
  });
  it('does not count keyword fallback results as semantic matches', () => {
    const meta=buildBrainRetrievalMeta({selected:[{id:'p',source_title:'Book'}],supporting_chunks:[{id:'c',source_title:'Book'}],debug:{static_principles_count:1,embedding_used:false}});
    expect(meta.semanticMatches).toBe(0); expect(meta.embeddingUsed).toBe(false); expect(meta.chunksRetrieved).toBe(2);
  });
});
describe('embedding batches', () => {
  afterEach(() => vi.unstubAllGlobals());
  const target={provider:'gemini' as const,url:'unused',headers:{},model:'gemini-embedding-001',dimensions:3};
  it('preserves row order and rejects incomplete batches', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({embeddings:[{values:[1,2,3]}]}))));
    await expect(embedBatch(target,['one','two'])).rejects.toThrow('Incomplete');
  });
  it('reports quota failure without returning successful zero work', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:429,headers:{'retry-after':'60'}})));
    await expect(embedBatch(target,['one'])).rejects.toThrow('HTTP 429');
  });
  it('uses the same native Gemini model and dimensions for ingestion and queries', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ embeddings: [{ values: Array(768).fill(0.1) }] })));
    vi.stubGlobal('fetch', fetchMock);
    const provider = { name: 'gemini', embed: { provider: 'gemini', key: 'test-only', url: 'unused', model: 'gemini-embedding-001' } } as AiProvider;
    expect(await aiEmbed(provider, 'Synthetic training text')).toHaveLength(768);
    expect(await userEmbed({ ...target, dimensions: 768, headers: { 'x-goog-api-key': 'test-only' } }, 'Synthetic query')).toHaveLength(768);
    for (const [url, options] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toContain('gemini-embedding-001:batchEmbedContents');
      expect(JSON.parse(String(options.body)).requests[0].outputDimensionality).toBe(768);
      expect(options.headers).toHaveProperty('x-goog-api-key', 'test-only');
    }
  });
  it('rejects invalid numeric embeddings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ embeddings: [{ values: [null, 1, 2] }] }))));
    await expect(embedBatch(target, ['one'])).rejects.toThrow('Invalid');
  });
});
