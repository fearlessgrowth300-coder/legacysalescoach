export type SalesOntology = {
  knowledgeTypes: string[];
  objectionTypes: string[];
  hiddenCauses: string[];
  buyingStages: string[];
  psychologicalMechanisms: string[];
  intendedOutcomes: string[];
  strategies: string[];
  techniques: string[];
  contraindications: string[];
  languagePatterns: string[];
  triggers: string[];
  examples: string[];
  extractionConfidence: number;
  evidenceMode: "verbatim" | "paraphrased" | "inferred";
  evidenceQuote: string;
  speaker: string;
};

export type StrategyPerformanceRow = {
  sales_brain_id?: string | null;
  strategy_key?: string | null;
  effectiveness_score?: number | string | null;
  previous_attempt_count?: number | string | null;
  previous_failure_count?: number | string | null;
  used_count?: number | string | null;
  reply_count?: number | string | null;
  permission_count?: number | string | null;
  sale_count?: number | string | null;
};

const UNKNOWN = /^(?:unknown|none|not inferred|not provided|n\/a)$/i;

export function normalizeSalesKey(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
}

function cleanText(value: unknown, max = 1000): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/\s+/g, " ").trim();
  return UNKNOWN.test(cleaned) ? "" : cleaned.slice(0, max);
}

function cleanList(value: unknown, maxItems = 16, itemLength = 220): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n|]+/)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of raw) {
    const cleaned = cleanText(item, itemLength);
    const key = normalizeSalesKey(cleaned);
    if (!cleaned || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maxItems) break;
  }
  return result;
}

function confidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.7;
  const normalized = parsed > 1 ? parsed / 100 : parsed;
  return Math.max(0.05, Math.min(1, Math.round(normalized * 10000) / 10000));
}

export function extractSalesOntology(learning: Record<string, unknown>): SalesOntology {
  const evidenceQuote = cleanText(
    learning.evidence_quote || learning.source_quote || learning.verbatim_evidence || learning.exact_words_to_use,
    2200,
  );
  const rawMode = cleanText(learning.evidence_mode, 30).toLowerCase();
  const evidenceMode: SalesOntology["evidenceMode"] = rawMode === "verbatim" && evidenceQuote
    ? "verbatim"
    : rawMode === "paraphrased"
      ? "paraphrased"
      : "inferred";

  return {
    knowledgeTypes: cleanList(learning.knowledge_types || learning.knowledge_type || learning.category, 8, 80),
    objectionTypes: cleanList(learning.objection_types || learning.objections, 12),
    hiddenCauses: cleanList(learning.hidden_causes || learning.possible_hidden_causes, 12),
    buyingStages: cleanList(learning.buying_stages || learning.suitable_stages || learning.buying_stage, 8, 80),
    psychologicalMechanisms: cleanList(
      learning.psychological_mechanisms || learning.psychology || learning.the_deep_why,
      10,
      320,
    ),
    intendedOutcomes: cleanList(learning.intended_outcomes || learning.outcomes, 10),
    strategies: cleanList(learning.strategies || learning.strategy || learning.recommended_behavior, 10, 420),
    techniques: cleanList(learning.techniques || learning.technique || learning.how_to_apply, 12, 320),
    contraindications: cleanList(learning.contraindications || learning.when_not_to_use, 12, 320),
    languagePatterns: cleanList(learning.language_patterns || learning.exact_words_to_use, 12, 420),
    triggers: cleanList(learning.trigger_phrases || learning.when_to_use, 12, 260),
    examples: cleanList(learning.examples || learning.real_example_or_story, 8, 700),
    extractionConfidence: confidence(learning.extraction_confidence),
    evidenceMode,
    evidenceQuote,
    speaker: cleanText(learning.speaker, 180),
  };
}

type PersistGraphInput = {
  supabase: any;
  userId: string;
  workspaceId?: string | null;
  sourceId: string;
  salesBrainId: string;
  principleName: string;
  summary: string;
  learning: Record<string, unknown>;
  principleChunkId?: string | null;
  evidenceChunk?: Record<string, unknown> | null;
};

async function upsertConcept(
  supabase: any,
  userId: string,
  workspaceId: string | null,
  conceptType: string,
  name: string,
): Promise<any | null> {
  const canonicalKey = normalizeSalesKey(name);
  if (!canonicalKey) return null;
  const { data, error } = await supabase.from("sales_concepts").upsert({
    user_id: userId,
    workspace_id: workspaceId,
    concept_type: conceptType,
    canonical_key: canonicalKey,
    name,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: "user_id,workspace_id,concept_type,canonical_key",
  }).select("id, concept_type, canonical_key, name").single();
  if (error) console.warn("sales_concepts upsert skipped:", error.message);
  return data || null;
}

async function upsertNode(
  supabase: any,
  input: PersistGraphInput,
  nodeType: string,
  title: string,
  conceptId: string | null,
  ontology: SalesOntology,
): Promise<any | null> {
  const canonicalKey = normalizeSalesKey(title);
  if (!canonicalKey) return null;
  const { data, error } = await supabase.from("sales_knowledge_nodes").upsert({
    user_id: input.userId,
    workspace_id: input.workspaceId || null,
    source_id: input.sourceId,
    // Every typed child retains its originating intelligence record. This lets
    // graph traversal return a candidate strategy after matching an objection,
    // cause, stage, trigger, or contraindication node directly.
    sales_brain_id: input.salesBrainId,
    concept_id: conceptId,
    node_type: nodeType,
    canonical_key: canonicalKey,
    title,
    summary: nodeType === "principle" ? input.summary : title,
    buying_stages: ontology.buyingStages,
    objection_types: ontology.objectionTypes,
    confidence: ontology.extractionConfidence,
    metadata: {
      evidence_mode: ontology.evidenceMode,
      speaker: ontology.speaker || null,
    },
    updated_at: new Date().toISOString(),
  }, {
    onConflict: "user_id,workspace_id,source_id,node_type,canonical_key",
  }).select("id, node_type, canonical_key, title").single();
  if (error) console.warn("sales_knowledge_nodes upsert skipped:", error.message);
  return data || null;
}

async function upsertEdge(
  supabase: any,
  input: PersistGraphInput,
  fromNodeId: string,
  toNodeId: string,
  relationshipType: string,
  confidenceValue: number,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
  const { error } = await supabase.from("sales_knowledge_edges").upsert({
    user_id: input.userId,
    workspace_id: input.workspaceId || null,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    relationship_type: relationshipType,
    confidence: confidenceValue,
    metadata,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: "user_id,from_node_id,to_node_id,relationship_type",
  });
  if (error) console.warn("sales_knowledge_edges upsert skipped:", error.message);
}

export async function persistSalesKnowledgeGraph(input: PersistGraphInput): Promise<string | null> {
  const ontology = extractSalesOntology(input.learning);
  const workspaceId = input.workspaceId || null;
  const principleConcept = await upsertConcept(input.supabase, input.userId, workspaceId, "principle", input.principleName);
  const principleNode = await upsertNode(
    input.supabase,
    input,
    "principle",
    input.principleName,
    principleConcept?.id || null,
    ontology,
  );
  if (!principleNode) return null;

  // Entity resolution across uploads: principles with the same canonical
  // concept become traversable across books/videos instead of remaining
  // isolated inside one source.
  if (principleConcept?.id) {
    const { data: equivalentNodes } = await input.supabase.from("sales_knowledge_nodes")
      .select("id")
      .eq("user_id", input.userId)
      .eq("concept_id", principleConcept.id)
      .neq("id", principleNode.id)
      .limit(20);
    for (const equivalent of equivalentNodes || []) {
      await upsertEdge(
        input.supabase,
        input,
        principleNode.id,
        equivalent.id,
        "principle_reinforces",
        ontology.extractionConfidence,
        { reason: "shared_canonical_concept", cross_source: true },
      );
      await upsertEdge(
        input.supabase,
        input,
        equivalent.id,
        principleNode.id,
        "principle_reinforces",
        ontology.extractionConfidence,
        { reason: "shared_canonical_concept", cross_source: true },
      );
    }
  }

  const typedValues: Array<[string, string[]]> = [
    ["objection", ontology.objectionTypes],
    ["hidden_cause", ontology.hiddenCauses],
    ["buying_stage", ontology.buyingStages],
    ["psychology", ontology.psychologicalMechanisms],
    ["intended_outcome", ontology.intendedOutcomes],
    ["strategy", ontology.strategies],
    ["technique", ontology.techniques],
    ["contraindication", ontology.contraindications],
    ["language_pattern", ontology.languagePatterns],
    ["trigger", ontology.triggers],
    ["example", ontology.examples],
  ];

  const nodesByType = new Map<string, any[]>();
  for (const [nodeType, values] of typedValues) {
    const nodes: any[] = [];
    for (const value of values) {
      const concept = await upsertConcept(input.supabase, input.userId, workspaceId, nodeType, value);
      const node = await upsertNode(input.supabase, input, nodeType, value, concept?.id || null, ontology);
      if (!node) continue;
      nodes.push(node);
    }
    nodesByType.set(nodeType, nodes);
  }

  const allowedRelationships = new Set([
    "objection_has_possible_cause", "cause_increases_emotion",
    "technique_handles_cause", "technique_handles_objection",
    "technique_requires_stage", "technique_contraindicated_when",
    "technique_sequences_before", "strategy_uses_technique",
    "trigger_activates_technique", "technique_produces_outcome",
    "language_pattern_expresses_technique", "example_demonstrates_principle",
    "principle_recommends_technique", "principle_recommends_strategy",
  ]);
  const nodeLookup = new Map<string, any>([[`principle:${normalizeSalesKey(input.principleName)}`, principleNode]]);
  for (const [nodeType, nodes] of nodesByType.entries()) {
    for (const node of nodes) nodeLookup.set(`${nodeType}:${node.canonical_key}`, node);
  }
  const relationshipHints = Array.isArray(input.learning.knowledge_relationships)
    ? input.learning.knowledge_relationships as Array<Record<string, unknown>>
    : [];
  let explicitRelationshipCount = 0;
  for (const hint of relationshipHints.slice(0, 40)) {
    const typeAlias = (value: unknown) => {
      const key = normalizeSalesKey(value);
      return ({
        cause: "hidden_cause",
        stage: "buying_stage",
        outcome: "intended_outcome",
        psychological_mechanism: "psychology",
        language: "language_pattern",
      } as Record<string, string>)[key] || key;
    };
    const fromType = typeAlias(hint.from_type);
    const toType = typeAlias(hint.to_type);
    const relationship = normalizeSalesKey(hint.relationship);
    const fromNode = nodeLookup.get(`${fromType}:${normalizeSalesKey(hint.from)}`);
    const toNode = nodeLookup.get(`${toType}:${normalizeSalesKey(hint.to)}`);
    if (!fromNode || !toNode || !allowedRelationships.has(relationship)) continue;
    await upsertEdge(
      input.supabase,
      input,
      fromNode.id,
      toNode.id,
      relationship,
      confidence(hint.confidence ?? ontology.extractionConfidence),
      { source: "explicit_relationship_extraction" },
    );
    explicitRelationshipCount += 1;
  }

  if (explicitRelationshipCount === 0) {
    for (const objection of nodesByType.get("objection") || []) {
      for (const cause of nodesByType.get("hidden_cause") || []) {
        await upsertEdge(input.supabase, input, objection.id, cause.id, "objection_has_possible_cause", ontology.extractionConfidence);
      }
    }
    for (const cause of nodesByType.get("hidden_cause") || []) {
      for (const psychology of nodesByType.get("psychology") || []) {
        await upsertEdge(input.supabase, input, cause.id, psychology.id, "cause_increases_emotion", ontology.extractionConfidence);
      }
    }
  }

  const techniqueNodes = nodesByType.get("technique") || [];
  const strategyNodes = nodesByType.get("strategy") || [];
  for (const strategy of strategyNodes) {
    await upsertEdge(
      input.supabase,
      input,
      principleNode.id,
      strategy.id,
      "principle_recommends_strategy",
      ontology.extractionConfidence,
      { source: "structured_extraction" },
    );
    if (explicitRelationshipCount === 0) {
      for (const technique of techniqueNodes) {
        await upsertEdge(input.supabase, input, strategy.id, technique.id, "strategy_uses_technique", ontology.extractionConfidence);
      }
    }
  }
  for (const technique of techniqueNodes) {
    await upsertEdge(
      input.supabase,
      input,
      principleNode.id,
      technique.id,
      "principle_recommends_technique",
      ontology.extractionConfidence,
      { source: "structured_extraction" },
    );
    if (explicitRelationshipCount === 0) {
      for (const objection of nodesByType.get("objection") || []) {
        await upsertEdge(input.supabase, input, technique.id, objection.id, "technique_handles_objection", ontology.extractionConfidence);
      }
      for (const cause of nodesByType.get("hidden_cause") || []) {
        await upsertEdge(input.supabase, input, technique.id, cause.id, "technique_handles_cause", ontology.extractionConfidence);
      }
      for (const stage of nodesByType.get("buying_stage") || []) {
        await upsertEdge(input.supabase, input, technique.id, stage.id, "technique_requires_stage", ontology.extractionConfidence);
      }
      for (const contraindication of nodesByType.get("contraindication") || []) {
        await upsertEdge(input.supabase, input, technique.id, contraindication.id, "technique_contraindicated_when", ontology.extractionConfidence);
      }
      for (const outcome of nodesByType.get("intended_outcome") || []) {
        await upsertEdge(input.supabase, input, technique.id, outcome.id, "technique_produces_outcome", ontology.extractionConfidence);
      }
      for (const trigger of nodesByType.get("trigger") || []) {
        await upsertEdge(input.supabase, input, trigger.id, technique.id, "trigger_activates_technique", ontology.extractionConfidence);
      }
      for (const languagePattern of nodesByType.get("language_pattern") || []) {
        await upsertEdge(input.supabase, input, languagePattern.id, technique.id, "language_pattern_expresses_technique", ontology.extractionConfidence);
      }
    }
  }
  for (let index = 0; index < techniqueNodes.length - 1; index += 1) {
    await upsertEdge(
      input.supabase,
      input,
      techniqueNodes[index].id,
      techniqueNodes[index + 1].id,
      "technique_sequences_before",
      ontology.extractionConfidence,
      { extracted_order: index + 1 },
    );
  }
  for (const example of nodesByType.get("example") || []) {
    await upsertEdge(input.supabase, input, example.id, principleNode.id, "example_demonstrates_principle", ontology.extractionConfidence);
  }
  for (const psychology of nodesByType.get("psychology") || []) {
    await upsertEdge(input.supabase, input, psychology.id, principleNode.id, "principle_reinforces", ontology.extractionConfidence);
  }

  const evidenceChunk = input.evidenceChunk || null;
  const evidenceLinks = [
    input.principleChunkId
      ? {
        id: input.principleChunkId,
        locator: input.learning.evidence_locator || input.learning._chapter || null,
        content: input.summary,
        kind: "principle_summary",
      }
      : null,
    evidenceChunk
      ? {
        id: String(evidenceChunk.id || ""),
        locator: evidenceChunk.locator || input.learning.evidence_locator || null,
        content: String(evidenceChunk.content || ""),
        kind: "source_passage",
      }
      : null,
  ].filter((entry): entry is Record<string, any> => Boolean(entry?.id));

  for (const evidence of evidenceLinks) {
    const { error } = await input.supabase.from("knowledge_evidence_links").upsert({
      user_id: input.userId,
      workspace_id: workspaceId,
      node_id: principleNode.id,
      sales_brain_id: input.salesBrainId,
      knowledge_chunk_id: evidence.id,
      source_id: input.sourceId,
      locator: evidence.locator || null,
      speaker: ontology.speaker || null,
      // A source passage is preserved evidence. The extracted claim can still
      // be inferred, so retain that distinction in metadata rather than
      // presenting an inferred sentence as a verbatim quote.
      evidence_mode: evidence.kind === "source_passage" ? "verbatim" : "paraphrased",
      supports_or_contradicts: "supports",
      quoted_text: evidence.kind === "source_passage"
        ? String(evidence.content || "").slice(0, 6000) || null
        : ontology.evidenceQuote || null,
      extraction_confidence: ontology.extractionConfidence,
      metadata: {
        chunk_kind: evidence.kind,
        claim_evidence_mode: ontology.evidenceMode,
        extracted_quote: ontology.evidenceQuote || null,
      },
    }, {
      onConflict: "user_id,node_id,knowledge_chunk_id,supports_or_contradicts",
    });
    if (error) console.warn("knowledge_evidence_links upsert skipped:", error.message);
    if (evidence.kind === "source_passage") {
      const evidenceNode = await upsertNode(
        input.supabase,
        input,
        "evidence",
        `Evidence ${evidence.id}`,
        null,
        ontology,
      );
      if (evidenceNode) {
        await upsertEdge(
          input.supabase,
          input,
          principleNode.id,
          evidenceNode.id,
          "principle_supported_by_passage",
          ontology.extractionConfidence,
          { knowledge_chunk_id: evidence.id, locator: evidence.locator || null },
        );
      }
    }
  }

  return principleNode.id;
}

const SCALAR_FACT_KEYS = [
  "segment", "experience_level", "sales_status", "result_verification_status",
  "mentor_status", "current_strategy", "motivation", "intent", "tangible_goal",
  "why_goal_matters", "problem_gap", "problem_status", "root_cause", "consequences",
  "need_for_change_reason", "inaction_pattern", "detailed_future_outcome", "doubt_cause",
  "certainty_gap", "readiness", "contact_status", "next_best_action",
];

const LIST_FACT_KEYS: Record<string, string> = {
  interests: "interest",
  desires: "desire",
  pain_points: "pain_point",
  objections: "objection",
  questions_already_answered: "answered_question",
  objections_handled: "handled_objection",
  strategies_attempted: "attempted_strategy",
  past_experiences: "past_experience",
  evidence: "conversation_evidence",
};

export async function persistProspectFactLedger(input: {
  supabase: any;
  userId: string;
  workspaceId: string;
  prospectId: string;
  threadType: string;
  profile: Record<string, unknown>;
  sourceMessageId?: string | null;
  sourceDirection?: string | null;
  sourceMessages?: Array<{ id?: string | null; direction?: string | null; content?: string | null }>;
}): Promise<void> {
  const now = new Date().toISOString();
  const confidenceValue = confidence(input.profile.confidence || input.profile.learning_confidence);
  const facts: Array<{ key: string; value: unknown; normalized: string }> = [];
  for (const key of SCALAR_FACT_KEYS) {
    const value = cleanText(input.profile[key], 900);
    if (!value) continue;
    facts.push({ key, value, normalized: normalizeSalesKey(value) });
  }
  for (const [profileKey, factKey] of Object.entries(LIST_FACT_KEYS)) {
    for (const value of cleanList(input.profile[profileKey], 20, 500)) {
      facts.push({ key: factKey, value, normalized: normalizeSalesKey(value) });
    }
  }

  for (const fact of facts) {
    if (!fact.normalized) continue;
    const factTokens = new Set(fact.normalized.split("_").filter((token) => token.length > 3));
    const matchedSource = (input.sourceMessages || []).map((message) => {
      const normalizedContent = normalizeSalesKey(message.content || "");
      const messageTokens = new Set(normalizedContent.split("_").filter((token) => token.length > 3));
      const overlap = [...factTokens].filter((token) => messageTokens.has(token)).length;
      const score = factTokens.size ? overlap / factTokens.size : 0;
      return { message, score };
    }).sort((a, b) => b.score - a.score)[0];
    const sourceMessage = matchedSource?.score >= 0.34 ? matchedSource.message : null;
    const { data: existing } = await input.supabase.from("prospect_fact_ledger")
      .select("id, normalized_value, status")
      .eq("user_id", input.userId)
      .eq("prospect_id", input.prospectId)
      .eq("thread_type", input.threadType)
      .eq("fact_key", fact.key)
      .eq("status", "current");

    const { data: saved, error } = await input.supabase.from("prospect_fact_ledger").upsert({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      prospect_id: input.prospectId,
      thread_type: input.threadType,
      fact_key: fact.key,
      fact_value: { value: fact.value },
      normalized_value: fact.normalized,
      confidence: confidenceValue,
      source_message_id: sourceMessage?.id || input.sourceMessageId || null,
      source_direction: sourceMessage?.direction || input.sourceDirection || null,
      status: "current",
      last_confirmed_at: now,
      updated_at: now,
      metadata: {
        source_match_score: matchedSource?.score || 0,
        source_assignment: sourceMessage ? "fact_message_match" : "latest_inbound_fallback",
      },
    }, {
      onConflict: "user_id,prospect_id,thread_type,fact_key,normalized_value",
    }).select("id").single();
    if (error) {
      console.warn("prospect_fact_ledger upsert skipped:", error.message);
      continue;
    }

    const scalarFact = SCALAR_FACT_KEYS.includes(fact.key);
    if (scalarFact && saved?.id) {
      const staleIds = (existing || [])
        .filter((row: any) => row.id !== saved.id && row.normalized_value !== fact.normalized)
        .map((row: any) => row.id);
      if (staleIds.length) {
        await input.supabase.from("prospect_fact_ledger").update({
          status: "contradicted",
          contradicts_fact_id: saved.id,
          invalidated_at: now,
          updated_at: now,
        }).in("id", staleIds);
      }
    }
  }
}

export async function loadProspectDecisionHistory(
  supabase: any,
  userId: string,
  prospectId: string,
  threadType: string,
): Promise<string> {
  const [{ data: facts }, { data: attempts }] = await Promise.all([
    supabase.from("prospect_fact_ledger")
      .select("fact_key, fact_value, confidence, source_message_id, last_confirmed_at")
      .eq("user_id", userId)
      .eq("prospect_id", prospectId)
      .eq("thread_type", threadType)
      .eq("status", "current")
      .order("last_confirmed_at", { ascending: false })
      .limit(80),
    supabase.from("sales_strategy_attempts")
      .select("strategy_name, strategy_key, funnel_stage, reply_act, generated_message, status, prospect_reaction, final_outcome, created_at")
      .eq("user_id", userId)
      .eq("prospect_id", prospectId)
      .eq("thread_type", threadType)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  const factLines = (facts || []).map((fact: any) => {
    const value = fact.fact_value?.value ?? fact.fact_value;
    return `- ${fact.fact_key}: ${typeof value === "string" ? value : JSON.stringify(value)} (confidence ${fact.confidence})`;
  });
  const attemptLines = (attempts || []).map((attempt: any) =>
    `- ${attempt.funnel_stage || "unknown"}: ${attempt.strategy_name || attempt.strategy_key} [${attempt.status}]`
    + `${attempt.final_outcome ? ` outcome=${attempt.final_outcome}` : ""}`
    + ` — ${(attempt.generated_message || "").slice(0, 220)}`
  );
  return `[FACT-LEVEL PROSPECT LEDGER]\n${factLines.join("\n") || "- No ledger facts yet."}\n\n`
    + `[PREVIOUS STRATEGIES — do not repeat failed or already-answered moves]\n${attemptLines.join("\n") || "- No strategy attempts yet."}`;
}

export async function recordInboundOutcomeSignals(input: {
  supabase: any;
  userId: string;
  workspaceId: string;
  prospectId: string;
  threadType: string;
  messageId?: string | null;
  message: string;
}): Promise<void> {
  const text = cleanText(input.message, 4000);
  if (!text) return;
  const { data: attempts, error } = await input.supabase.from("sales_strategy_attempts")
    .select("id, decision_id, strategy_key, funnel_stage, metadata")
    .eq("user_id", input.userId)
    .eq("prospect_id", input.prospectId)
    .eq("thread_type", input.threadType)
    .in("status", ["copied", "used"])
    .is("replied_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !attempts?.length) return;
  const attempt = attempts[0];
  const eventTypes = new Set<string>(["prospect_replied"]);
  if (/\b(?:thank(?:s| you)|yes|yeah|interested|sounds good|that helps|love that|makes sense)\b/i.test(text)) {
    eventTypes.add("positive_sentiment");
  }
  if (/\b(?:doesn'?t help|not helpful|confused|frustrated|annoyed|disappointed|still not sure)\b/i.test(text)) {
    eventTypes.add("negative_sentiment");
  }
  if (/\b(?:struggl|stuck|not (?:making|getting)|no sales|inconsistent sales|problem|hard(?:est)? part|can'?t)\b/i.test(text)) {
    eventTypes.add("problem_admitted");
  }
  if (/\b(?:can you help|need help|want help|how (?:did|do|can)|what helped|show me|tell me more)\b/i.test(text)) {
    eventTypes.add("help_requested");
  }
  if (/\b(?:yes|yeah|sure|okay|ok|please)\b.{0,45}\b(?:share|send|tell|introduce|link|expert|team)\b/i.test(text)) {
    eventTypes.add("permission_given");
  }
  if (/\b(?:messaged|contacted|reached out to|spoke to|talked to)\b.{0,55}\b(?:the )?(?:expert|team|coach|mentor)\b/i.test(text)) {
    eventTypes.add("expert_contacted");
  }
  if (/\b(?:booked|scheduled|set up)\b.{0,45}\b(?:a )?(?:call|consultation|meeting|session)\b/i.test(text)) {
    eventTypes.add("call_booked");
  }
  if (/\b(?:i (?:paid|bought|purchased|joined|enrolled)|payment (?:went through|is done)|i'?m in)\b/i.test(text)) {
    eventTypes.add("purchase_completed");
  }
  if (/\b(?:not interested|don'?t contact|leave me alone|stop messaging|no thanks|don'?t want)\b/i.test(text)) {
    eventTypes.add("refused");
  }

  const events = [...eventTypes].map((eventType) => ({
    user_id: input.userId,
    workspace_id: input.workspaceId,
    prospect_id: input.prospectId,
    decision_id: attempt.decision_id || null,
    strategy_attempt_id: attempt.id,
    message_id: input.messageId || null,
    event_type: eventType,
    prospect_segment: attempt.metadata?.prospect_segment || null,
    funnel_stage: attempt.funnel_stage || null,
    strategy_key: attempt.strategy_key || null,
    model_provider: attempt.metadata?.model_provider || null,
    model_name: attempt.metadata?.model_name || null,
    workspace_offer: attempt.metadata?.workspace_offer || null,
    metadata: { inferred_from_inbound: true, message_excerpt: text.slice(0, 500) },
  }));
  const { error: insertError } = await input.supabase.from("sales_outcome_events").insert(events);
  if (insertError) console.warn("Inbound outcome event capture skipped:", insertError.message);
}

export async function loadStrategyPerformance(input: {
  supabase: any;
  userId: string;
  workspaceId: string;
  prospectId: string;
  prospectSegment?: string | null;
  funnelStage?: string | null;
  objectionType?: string | null;
  salesBrainIds: string[];
}): Promise<StrategyPerformanceRow[]> {
  if (!input.salesBrainIds.length) return [];
  const { data, error } = await input.supabase.rpc("rank_sales_strategy_candidates", {
    p_user_id: input.userId,
    p_workspace_id: input.workspaceId,
    p_prospect_id: input.prospectId,
    p_prospect_segment: input.prospectSegment || null,
    p_funnel_stage: input.funnelStage || null,
    p_objection_type: input.objectionType || null,
    p_sales_brain_ids: input.salesBrainIds,
  });
  if (error) {
    console.warn("Strategy performance rank unavailable; using retrieval rank:", error.message);
    return [];
  }
  return data || [];
}

export function applyOutcomeAwareStrategyRank<T extends Record<string, any>>(
  principles: T[],
  performanceRows: StrategyPerformanceRow[],
  context: { funnelStage?: string | null; objectionType?: string | null; prospectText?: string | null } = {},
): T[] {
  const byId = new Map(performanceRows.map((row) => [row.sales_brain_id, row]));
  return principles.map((principle, index) => {
    const row = byId.get(principle.id);
    const effectiveness = Number(row?.effectiveness_score || 0);
    const attempts = Number(row?.previous_attempt_count || 0);
    const failures = Number(row?.previous_failure_count || 0);
    const relevance = Number(principle._decisionScore ?? principle.matchScore ?? principle.relevance_score ?? principle.similarity ?? 0);
    const outcomeBoost = Math.max(-12, Math.min(18, effectiveness * 4));
    const repetitionPenalty = Math.min(10, attempts * 1.5);
    const failurePenalty = Math.min(18, failures * 5);
    const stages = cleanList(principle.buying_stages, 12, 80).map(normalizeSalesKey);
    const objections = cleanList(principle.objection_types, 12, 120).map(normalizeSalesKey);
    const stageKey = normalizeSalesKey(context.funnelStage);
    const objectionKey = normalizeSalesKey(context.objectionType);
    const stageCompatibility = stageKey && stages.some((stage) => stage === stageKey || stage.includes(stageKey) || stageKey.includes(stage)) ? 8 : 0;
    const objectionCompatibility = objectionKey && objections.some((objection) => objection === objectionKey || objection.includes(objectionKey) || objectionKey.includes(objection)) ? 8 : 0;
    const prospectKey = normalizeSalesKey(context.prospectText);
    const contraindicationMatches = cleanList(principle.contraindications, 12, 320)
      .map(normalizeSalesKey)
      .filter((warning) => warning && prospectKey && warning.split("_").filter((token) => token.length > 4).some((token) => prospectKey.includes(token)))
      .length;
    const contraindicationPenalty = Math.min(24, contraindicationMatches * 12);
    return {
      ...principle,
      _retrievalIndex: index,
      _outcomeScore: relevance + outcomeBoost + stageCompatibility + objectionCompatibility
        - repetitionPenalty - failurePenalty - contraindicationPenalty,
      _strategyPerformance: row || null,
      _strategyRankBreakdown: {
        relevance,
        outcomeBoost,
        stageCompatibility,
        objectionCompatibility,
        repetitionPenalty,
        failurePenalty,
        contraindicationPenalty,
      },
    };
  }).sort((a, b) => Number(b._outcomeScore || 0) - Number(a._outcomeScore || 0));
}

export async function loadKnowledgeGraphContext(
  supabase: any,
  userId: string,
  salesBrainIds: string[],
  maxEdges = 36,
): Promise<{ text: string; paths: Array<Record<string, unknown>>; nodeByPrinciple: Record<string, string> }> {
  if (!salesBrainIds.length) return { text: "(no graph candidates)", paths: [], nodeByPrinciple: {} };
  try {
    const { data: roots, error: rootError } = await supabase.from("sales_knowledge_nodes")
      .select("id, sales_brain_id, title, node_type, confidence")
      .eq("user_id", userId)
      .in("sales_brain_id", salesBrainIds)
      .eq("node_type", "principle");
    if (rootError || !roots?.length) return { text: "(graph not indexed for these principles yet)", paths: [], nodeByPrinciple: {} };
    const rootIds = roots.map((root: any) => root.id);
    const nodeByPrinciple = Object.fromEntries(roots.map((root: any) => [root.sales_brain_id, root.id]));
    const { data: edges, error: edgeError } = await supabase.from("sales_knowledge_edges")
      .select("id, from_node_id, to_node_id, relationship_type, confidence, metadata")
      .eq("user_id", userId)
      .in("from_node_id", rootIds)
      .order("confidence", { ascending: false })
      .limit(maxEdges);
    if (edgeError || !edges?.length) return { text: "(no graph relationships for these principles yet)", paths: [], nodeByPrinciple };
    const relatedIds = [...new Set(edges.map((edge: any) => edge.to_node_id))];
    const { data: related } = await supabase.from("sales_knowledge_nodes")
      .select("id, title, node_type, confidence, metadata")
      .in("id", relatedIds);
    const nodeMap = new Map((related || []).map((node: any) => [node.id, node]));
    const rootMap = new Map(roots.map((node: any) => [node.id, node]));
    const paths = edges.map((edge: any) => ({
      from_node_id: edge.from_node_id,
      from: rootMap.get(edge.from_node_id)?.title || "principle",
      relationship: edge.relationship_type,
      to_node_id: edge.to_node_id,
      to: nodeMap.get(edge.to_node_id)?.title || "related concept",
      to_type: nodeMap.get(edge.to_node_id)?.node_type || "concept",
      confidence: edge.confidence,
    }));
    const text = paths.map((path) =>
      `- ${path.from} --${path.relationship}--> ${path.to} [${path.to_type}; confidence ${path.confidence}]`
    ).join("\n");
    return { text: text || "(no graph paths)", paths, nodeByPrinciple };
  } catch (error) {
    console.warn("Knowledge graph retrieval skipped:", error);
    return { text: "(knowledge graph unavailable; use RAG evidence)", paths: [], nodeByPrinciple: {} };
  }
}

export async function traverseSalesKnowledgeGraph(
  supabase: any,
  userId: string,
  decisionQuery: string,
  maxConcepts = 6,
): Promise<{ text: string; paths: Array<Record<string, unknown>>; candidateSalesBrainIds: string[] }> {
  try {
    const queryTokens = new Set(normalizeSalesKey(decisionQuery).split("_").filter((token) => token.length > 3));
    const { data: concepts, error: conceptError } = await supabase.from("sales_concepts")
      .select("id, concept_type, canonical_key, name")
      .eq("user_id", userId)
      .in("concept_type", ["objection", "hidden_cause", "buying_stage", "psychology", "trigger", "intended_outcome"])
      .limit(300);
    if (conceptError || !concepts?.length) return { text: "(no matching graph concepts)", paths: [], candidateSalesBrainIds: [] };
    const rankedConcepts = concepts.map((concept: any) => {
      const tokens = String(concept.canonical_key || "").split("_");
      const overlap = tokens.filter((token: string) => queryTokens.has(token)).length;
      const exact = decisionQuery.toLowerCase().includes(String(concept.name || "").toLowerCase()) ? 4 : 0;
      return { ...concept, score: overlap + exact };
    }).filter((concept: any) => concept.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, maxConcepts);
    if (!rankedConcepts.length) return { text: "(no decision-matched graph concepts)", paths: [], candidateSalesBrainIds: [] };

    const { data: seedNodes } = await supabase.from("sales_knowledge_nodes")
      .select("id, title, node_type, sales_brain_id, concept_id")
      .eq("user_id", userId)
      .in("concept_id", rankedConcepts.map((concept: any) => concept.id))
      .limit(60);
    if (!seedNodes?.length) return { text: "(matched concepts have no indexed nodes)", paths: [], candidateSalesBrainIds: [] };
    const seedIds = seedNodes.map((node: any) => node.id);
    const [{ data: outgoing }, { data: incoming }] = await Promise.all([
      supabase.from("sales_knowledge_edges")
        .select("from_node_id, to_node_id, relationship_type, confidence")
        .eq("user_id", userId).in("from_node_id", seedIds).order("confidence", { ascending: false }).limit(60),
      supabase.from("sales_knowledge_edges")
        .select("from_node_id, to_node_id, relationship_type, confidence")
        .eq("user_id", userId).in("to_node_id", seedIds).order("confidence", { ascending: false }).limit(60),
    ]);
    const edges = [...(outgoing || []), ...(incoming || [])];
    const allIds = [...new Set(edges.flatMap((edge: any) => [edge.from_node_id, edge.to_node_id]))];
    const { data: allNodes } = allIds.length
      ? await supabase.from("sales_knowledge_nodes")
        .select("id, title, node_type, sales_brain_id")
        .eq("user_id", userId).in("id", allIds)
      : { data: seedNodes };
    const nodeMap = new Map((allNodes || seedNodes).map((node: any) => [node.id, node]));
    const paths = edges.slice(0, 48).map((edge: any) => ({
      from_node_id: edge.from_node_id,
      from: nodeMap.get(edge.from_node_id)?.title || "concept",
      from_type: nodeMap.get(edge.from_node_id)?.node_type || "concept",
      relationship: edge.relationship_type,
      to_node_id: edge.to_node_id,
      to: nodeMap.get(edge.to_node_id)?.title || "concept",
      to_type: nodeMap.get(edge.to_node_id)?.node_type || "concept",
      confidence: edge.confidence,
    }));
    const candidateSalesBrainIds = [...new Set((allNodes || [])
      .map((node: any) => node.sales_brain_id)
      .filter(Boolean))];
    return {
      text: paths.map((path) => `- ${path.from} --${path.relationship}--> ${path.to} [confidence ${path.confidence}]`).join("\n") || "(no traversable paths)",
      paths,
      candidateSalesBrainIds,
    };
  } catch (error) {
    console.warn("Decision graph traversal skipped:", error);
    return { text: "(decision graph unavailable; use RAG evidence)", paths: [], candidateSalesBrainIds: [] };
  }
}

export async function persistSalesDecision(input: {
  supabase: any;
  userId: string;
  workspaceId: string;
  prospectId: string;
  threadType: string;
  inputMessageId?: string | null;
  inputText: string;
  analysis: Record<string, any>;
  selectedPrinciple?: Record<string, any> | null;
  selectedKnowledgeNodeId?: string | null;
  graphPath?: unknown[];
  scoreBreakdown?: Record<string, unknown>;
  modelProvider?: string | null;
  modelName?: string | null;
  workspaceOffer?: string | null;
  generationStatus?: "generated" | "fallback" | "failed";
  variants: Array<Record<string, any>>;
}): Promise<{ decisionId: string | null; attemptIds: string[] }> {
  const selected = input.selectedPrinciple || null;
  const { data: decision, error: decisionError } = await input.supabase.from("sales_decisions").insert({
    user_id: input.userId,
    workspace_id: input.workspaceId,
    prospect_id: input.prospectId,
    thread_type: input.threadType,
    input_message_id: input.inputMessageId || null,
    input_text: input.inputText,
    funnel_stage: input.analysis.stage || null,
    earliest_missing_checkpoint: input.analysis.earliest_missing_checkpoint || null,
    objection_type: input.analysis.objection_detected || input.analysis.objection_bucket || null,
    hidden_cause_hypothesis: input.analysis.root_cause || input.analysis.doubt_cause || null,
    prospect_fact_used: input.analysis.problem_gap || input.analysis.tangible_goal || null,
    next_best_action: input.analysis.next_best_action || input.analysis.next_objective || null,
    selected_sales_brain_id: selected?.id || null,
    selected_knowledge_node_id: input.selectedKnowledgeNodeId || null,
    selected_graph_path: input.graphPath || [],
    score_breakdown: input.scoreBreakdown || {},
    analysis_snapshot: input.analysis,
    model_provider: input.modelProvider || null,
    model_name: input.modelName || null,
    generation_status: input.generationStatus || "generated",
  }).select("id").single();
  if (decisionError) {
    console.warn("sales_decisions insert skipped:", decisionError.message);
    return { decisionId: null, attemptIds: [] };
  }

  const attempts = input.variants.map((variant, index) => {
    const knowledge = variant.knowledge_application || variant.knowledgeApplication || {};
    const principleName = knowledge.principle_name || knowledge.principleName
      || variant.principle_applied || variant.principleUsed || selected?.principle_name || "natural_peer_move";
    return {
      user_id: input.userId,
      workspace_id: input.workspaceId,
      prospect_id: input.prospectId,
      decision_id: decision.id,
      suggestion_id: String(variant.id ?? variant.variant ?? index + 1),
      thread_type: input.threadType,
      funnel_stage: input.analysis.stage || null,
      reply_act: variant.move_used || input.analysis.reply_act || null,
      strategy_key: normalizeSalesKey(principleName) || "natural_peer_move",
      strategy_name: principleName,
      selected_sales_brain_id: selected?.id || null,
      selected_knowledge_node_id: input.selectedKnowledgeNodeId || null,
      prospect_fact_used: input.analysis.problem_gap || input.analysis.tangible_goal || null,
      hidden_cause_hypothesis: input.analysis.root_cause || input.analysis.doubt_cause || null,
      generated_message: variant.message || variant.text || "",
      rationale: variant.why_this_works || variant.whyThisWorks || null,
      status: "suggested",
      metadata: {
        variant: variant.variant || variant.type || null,
        knowledge_application: knowledge,
        prospect_segment: input.analysis.segment || null,
        model_provider: input.modelProvider || null,
        model_name: input.modelName || null,
        workspace_offer: input.workspaceOffer || null,
      },
    };
  }).filter((attempt) => attempt.generated_message);

  if (!attempts.length) return { decisionId: decision.id, attemptIds: [] };
  const { data: savedAttempts, error: attemptError } = await input.supabase.from("sales_strategy_attempts")
    .insert(attempts).select("id, strategy_key, suggestion_id");
  if (attemptError) {
    console.warn("sales_strategy_attempts insert skipped:", attemptError.message);
    return { decisionId: decision.id, attemptIds: [] };
  }

  const variantBySuggestion = new Map(input.variants.map((variant, index) => [
    String(variant.id ?? variant.variant ?? index + 1),
    variant,
  ]));
  const events = (savedAttempts || []).map((attempt: any) => {
    const variant = variantBySuggestion.get(String(attempt.suggestion_id || "")) || {};
    return {
      user_id: input.userId,
      workspace_id: input.workspaceId,
      prospect_id: input.prospectId,
      decision_id: decision.id,
      strategy_attempt_id: attempt.id,
      event_type: "suggested",
      prospect_segment: input.analysis.segment || null,
      funnel_stage: input.analysis.stage || null,
      objection_type: input.analysis.objection_detected || input.analysis.objection_bucket || null,
      strategy_key: attempt.strategy_key,
      reply_style: variant.type || variant.variant || null,
      model_provider: input.modelProvider || null,
      model_name: input.modelName || null,
      workspace_offer: input.workspaceOffer || null,
      metadata: {
        earliest_missing_checkpoint: input.analysis.earliest_missing_checkpoint || null,
        next_best_action: input.analysis.next_best_action || input.analysis.next_objective || null,
      },
    };
  });
  if (events.length) await input.supabase.from("sales_outcome_events").insert(events);
  return { decisionId: decision.id, attemptIds: (savedAttempts || []).map((attempt: any) => attempt.id) };
}
