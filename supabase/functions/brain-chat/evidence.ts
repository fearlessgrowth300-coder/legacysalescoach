import type { Chunk, Principle, SelectedPrinciple } from "../_shared/brain-pipeline.ts";

const clip = (value: unknown, size: number) => {
  const text = String(value ?? "").trim();
  return text.length > size ? `${text.slice(0, size - 1)}…` : text;
};

// Keep whole, individually bounded records. Global substring truncation used to
// advertise sources whose evidence never actually reached the model.
function pack<T>(rows: T[], render: (row: T) => string, limit: number) {
  const included: T[] = [];
  const blocks: string[] = [];
  let used = 0;
  for (const row of rows) {
    const text = render(row);
    if (used + text.length + 2 > limit) continue;
    included.push(row);
    blocks.push(text);
    used += text.length + 2;
  }
  return { included, text: blocks.join("\n\n") || "(none)" };
}

function principleText(p: Principle, title: string) {
  const chapter = (p as Principle & { chapter_label?: string }).chapter_label;
  return `PRINCIPLE ID: ${p.id}
SOURCE: "${title}"
${chapter ? `LOCATION: ${clip(chapter, 100)}\n` : ""}PRINCIPLE: ${clip(p.principle_name, 160)}
TEACHING: ${clip(p.what_i_learned, 260)}
APPLICATION: ${clip(p.how_to_apply, 220)}
WHY: ${clip(p.the_deep_why, 120)}
USE WHEN: ${clip(p.when_to_use, 120)}
AVOID WHEN: ${clip(p.when_not_to_use, 140)}
EXAMPLE (not the user's personal experience): ${clip(p.real_example_or_story || p.exact_words_to_use, 160)}`;
}

export function buildBrainEvidencePack(input: {
  selected: SelectedPrinciple[]; evidence_principles: Principle[]; supporting_chunks: Chunk[];
}) {
  const selected = pack(input.selected, s =>
    principleText(s.full, s.source_title || s.full.source_title || s.full.source_name), 5000);
  const evidence = pack(input.evidence_principles, p =>
    principleText(p, p.source_title || p.source_name), 3600);
  const chunks = pack(input.supporting_chunks, c => `PASSAGE ID: ${c.id}
SOURCE: "${c.source_title || "Uploaded content"}"
LOCATION: ${clip(c.locator || "Not provided", 140)}
TYPE: ${c.chunk_kind === "source_passage" ? "Original source excerpt" : "Extracted summary"}
TEXT: ${clip(c.content, 950)}`, 6000);
  return {
    selected: selected.included, evidence_principles: evidence.included, supporting_chunks: chunks.included,
    selectedBlock: selected.text, evidenceBlock: evidence.text, chunksBlock: chunks.text,
    text: [selected.text, evidence.text, chunks.text].join("\n\n"),
    sourceTitles: [...new Set([
      ...selected.included.map(s => s.source_title || s.full.source_title || s.full.source_name),
      ...evidence.included.map(p => p.source_title || p.source_name),
      ...chunks.included.map(c => c.source_title || "Uploaded content"),
    ].filter(Boolean))],
  };
}
