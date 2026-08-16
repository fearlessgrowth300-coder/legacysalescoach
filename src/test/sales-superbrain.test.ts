import { describe, expect, it } from "vitest";
import {
  applyOutcomeAwareStrategyRank,
  extractSalesOntology,
  normalizeSalesKey,
} from "../../supabase/functions/_shared/sales-superbrain";
import { evaluateSalesCase } from "../../supabase/functions/_shared/sales-evaluation";

describe("Sales Superbrain ontology", () => {
  it("normalizes rich extracted intelligence into typed arrays", () => {
    const ontology = extractSalesOntology({
      knowledge_types: ["Technique", "Psychology"],
      objection_types: ["Trust", "Risk"],
      hidden_causes: ["Previous financial loss"],
      buying_stages: ["Evaluation"],
      psychological_mechanisms: ["Loss aversion"],
      intended_outcomes: ["Diagnose uncertainty"],
      strategies: ["Diagnose before resolving"],
      techniques: ["Ask what went wrong previously"],
      contraindications: ["Do not counter with stronger promises"],
      language_patterns: ["What part still feels uncertain?"],
      evidence_quote: "Find out what they are actually uncertain about.",
      evidence_mode: "verbatim",
      extraction_confidence: 92,
    });

    expect(ontology.objectionTypes).toEqual(["Trust", "Risk"]);
    expect(ontology.hiddenCauses).toEqual(["Previous financial loss"]);
    expect(ontology.strategies).toEqual(["Diagnose before resolving"]);
    expect(ontology.evidenceMode).toBe("verbatim");
    expect(ontology.extractionConfidence).toBe(0.92);
    expect(normalizeSalesKey(ontology.techniques[0])).toBe("ask_what_went_wrong_previously");
  });

  it("uses verified outcomes without allowing them to overpower relevance", () => {
    const ranked = applyOutcomeAwareStrategyRank([
      { id: "relevant", matchScore: 80, principle_name: "Diagnose trust" },
      { id: "weak", matchScore: 30, principle_name: "Use urgency" },
    ], [
      { sales_brain_id: "relevant", effectiveness_score: 2, previous_attempt_count: 0, previous_failure_count: 0 },
      { sales_brain_id: "weak", effectiveness_score: 5, previous_attempt_count: 0, previous_failure_count: 0 },
    ]);
    expect(ranked[0].id).toBe("relevant");
  });

  it("penalizes a strategy that already failed for this prospect", () => {
    const ranked = applyOutcomeAwareStrategyRank([
      { id: "repeat", matchScore: 70, principle_name: "Repeated probe" },
      { id: "fresh", matchScore: 66, principle_name: "Fresh reframe" },
    ], [
      { sales_brain_id: "repeat", effectiveness_score: 1, previous_attempt_count: 3, previous_failure_count: 2 },
    ]);
    expect(ranked[0].id).toBe("fresh");
  });

  it("uses stage and objection compatibility and penalizes contraindications", () => {
    const ranked = applyOutcomeAwareStrategyRank([
      {
        id: "trust-fit",
        matchScore: 55,
        buying_stages: ["logical certainty"],
        objection_types: ["trust"],
        contraindications: [],
      },
      {
        id: "pushy",
        matchScore: 60,
        buying_stages: ["decision"],
        objection_types: ["urgency"],
        contraindications: ["previous financial loss"],
      },
    ], [], {
      funnelStage: "logical certainty",
      objectionType: "trust",
      prospectText: "I had a previous financial loss and do not trust another company.",
    });
    expect(ranked[0].id).toBe("trust-fit");
    expect((ranked[0] as any)._strategyRankBreakdown.objectionCompatibility).toBe(8);
  });
});

describe("Sales Superbrain evaluation", () => {
  const evaluationCase = {
    input_conversation: [
      { direction: "inbound", content: "I paid another company $2,000 and got nothing." },
      { direction: "outbound", content: "What happened when you worked with them?" },
      { direction: "inbound", content: "They promised leads but never explained the process." },
    ],
    expected_stage: "logical_certainty",
    expected_facts: { past_loss: "$2,000", root_cause: "never explained the process" },
    expected_knowledge: ["diagnose previous failure"],
    expected_reply_constraints: { requires_permission: false, approved_claims: [] },
  };

  it("passes a grounded, non-repeating decision", () => {
    const result = evaluateSalesCase({
      evaluationCase,
      generatedDecision: {
        stage: "logical_certainty",
        past_loss: "$2,000",
        root_cause: "They never explained the process",
        selected_knowledge: ["diagnose previous failure"],
        knowledge_application: { message_evidence: "not knowing what was happening" },
      },
      generatedReply: "Yeah, not knowing what was happening would make it hard to trust another team. Was the bigger issue the missing communication or that no leads showed up?",
      retrievedKnowledge: ["diagnose previous failure"],
    });
    expect(result.metrics.stage_detection_accuracy).toBe(1);
    expect(result.metrics.knowledge_application_accuracy).toBe(1);
    expect(result.metrics.repeated_question_rate).toBe(0);
  });

  it("fails repeated questions and unsupported numerical claims", () => {
    const result = evaluateSalesCase({
      evaluationCase,
      generatedDecision: { stage: "intent", selected_knowledge: [] },
      generatedReply: "What happened when you worked with them? We guarantee 95% more leads.",
      retrievedKnowledge: [],
    });
    expect(result.metrics.stage_detection_accuracy).toBe(0);
    expect(result.metrics.repeated_question_rate).toBe(1);
    expect(result.metrics.unsupported_claim_rate).toBe(1);
    expect(result.passed).toBe(false);
  });
});
