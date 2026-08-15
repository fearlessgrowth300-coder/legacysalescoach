export type SalesEvaluationCase = {
  input_conversation: unknown;
  expected_stage?: string | null;
  expected_facts?: Record<string, unknown> | null;
  expected_knowledge?: unknown[] | null;
  expected_reply_constraints?: Record<string, unknown> | null;
};

export type SalesEvaluationResult = {
  metrics: Record<string, number>;
  totalScore: number;
  passed: boolean;
  failureReasons: string[];
};

function normalized(value: unknown): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function flattenValues(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(flattenValues);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(flattenValues);
  const cleaned = normalized(value);
  return cleaned ? [cleaned] : [];
}

function conversationText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((turn: any) => `${turn?.direction || turn?.role || "turn"}: ${turn?.content || turn?.text || ""}`).join("\n");
  }
  return JSON.stringify(value || "");
}

function questions(value: string): string[] {
  return value.split(/(?<=[?.!])\s+/)
    .filter((line) => line.includes("?"))
    .map((line) => normalized(line.replace(/\?+/g, "")))
    .filter(Boolean);
}

function similarity(a: string, b: string): number {
  const left = new Set(normalized(a).split(" ").filter((token) => token.length > 3));
  const right = new Set(normalized(b).split(" ").filter((token) => token.length > 3));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.min(left.size, right.size);
}

export function evaluateSalesCase(input: {
  evaluationCase: SalesEvaluationCase;
  generatedDecision: Record<string, unknown>;
  generatedReply: string;
  retrievedKnowledge?: unknown[];
}): SalesEvaluationResult {
  const testCase = input.evaluationCase;
  const decision = input.generatedDecision || {};
  const reply = String(input.generatedReply || "").trim();
  const conversation = conversationText(testCase.input_conversation);
  const constraints = testCase.expected_reply_constraints || {};
  const failureReasons: string[] = [];

  const expectedStage = normalized(testCase.expected_stage);
  const actualStage = normalized(decision.stage || decision.funnel_stage || decision.questioningPattern);
  const stageAccuracy = !expectedStage ? 1 : expectedStage === actualStage ? 1 : 0;
  if (!stageAccuracy) failureReasons.push(`Expected stage ${expectedStage || "unspecified"}, got ${actualStage || "missing"}.`);

  const expectedFactValues = flattenValues(testCase.expected_facts || {});
  const decisionText = normalized(JSON.stringify(decision));
  const recalledFacts = expectedFactValues.filter((fact) => decisionText.includes(fact) || similarity(fact, decisionText) >= 0.7);
  const factRecall = expectedFactValues.length ? recalledFacts.length / expectedFactValues.length : 1;
  if (factRecall < 0.8) failureReasons.push("Prospect fact recall is below 80%.");

  const expectedKnowledge = flattenValues(testCase.expected_knowledge || []);
  const retrievedText = normalized(JSON.stringify(input.retrievedKnowledge || decision.selected_knowledge || []));
  const matchedKnowledge = expectedKnowledge.filter((knowledge) => retrievedText.includes(knowledge) || similarity(knowledge, retrievedText) >= 0.6);
  const retrievalRelevance = expectedKnowledge.length ? matchedKnowledge.length / expectedKnowledge.length : 1;
  if (retrievalRelevance < 0.6) failureReasons.push("Expected sales knowledge was not retrieved.");

  const application = (decision.knowledge_application || decision.knowledgeApplication || {}) as Record<string, unknown>;
  const messageEvidence = String(application.message_evidence || application.messageEvidence || "").trim();
  const knowledgeApplied = expectedKnowledge.length === 0
    ? 1
    : messageEvidence && normalized(reply).includes(normalized(messageEvidence)) ? 1 : 0;
  if (!knowledgeApplied) failureReasons.push("Retrieved knowledge is not visibly applied in the reply.");

  const priorQuestions = questions(conversation);
  const replyQuestions = questions(reply);
  const repeatsQuestion = replyQuestions.some((current) => priorQuestions.some((prior) => similarity(current, prior) >= 0.78));
  const repeatedQuestionRate = repeatsQuestion ? 1 : 0;
  if (repeatsQuestion) failureReasons.push("Reply repeats a previously answered question.");

  const explicitBoundary = /\b(?:do not contact|don'?t contact|leave me alone|stop messaging|not interested)\b/i.test(conversation);
  const pushesAfterBoundary = explicitBoundary && /\?|\b(?:expert|team|offer|link|help you|would you like)\b/i.test(reply);
  const boundaryRespect = pushesAfterBoundary ? 0 : 1;
  if (!boundaryRespect) failureReasons.push("Reply does not respect an explicit boundary.");

  const requiresPermission = Boolean(constraints.requires_permission)
    || normalized(testCase.expected_stage) === "pitch";
  const permissionLanguage = /\b(?:would you like|want me to|open to|would it help|can i share|want to hear)\b/i.test(reply);
  const permissionAccuracy = requiresPermission ? (permissionLanguage ? 1 : 0) : 1;
  if (!permissionAccuracy) failureReasons.push("Pitch-stage reply does not ask permission.");

  const approvedClaims = normalized(JSON.stringify(constraints.approved_claims || []));
  const numericalClaims = reply.match(/(?:[$£€]\s?\d[\d,.]*|\b\d+(?:\.\d+)?%|\b\d+[kKmM]\b)/g) || [];
  const unsupportedClaim = numericalClaims.some((claim) => !approvedClaims.includes(normalized(claim)) && !normalized(conversation).includes(normalized(claim)));
  const unsupportedClaimRate = unsupportedClaim ? 1 : 0;
  if (unsupportedClaim) failureReasons.push("Reply contains an unsupported numerical claim.");

  const metrics = {
    stage_detection_accuracy: stageAccuracy,
    prospect_fact_recall: Number(factRecall.toFixed(4)),
    retrieval_relevance: Number(retrievalRelevance.toFixed(4)),
    knowledge_application_accuracy: knowledgeApplied,
    repeated_question_rate: repeatedQuestionRate,
    unsupported_claim_rate: unsupportedClaimRate,
    boundary_respect_accuracy: boundaryRespect,
    permission_transition_accuracy: permissionAccuracy,
  };
  const positive = stageAccuracy + factRecall + retrievalRelevance + knowledgeApplied + boundaryRespect + permissionAccuracy;
  const penalties = repeatedQuestionRate + unsupportedClaimRate;
  const totalScore = Math.max(0, Math.min(100, Math.round(((positive / 6) - (penalties * 0.15)) * 1000) / 10));
  return { metrics, totalScore, passed: totalScore >= 80 && failureReasons.length === 0, failureReasons };
}
