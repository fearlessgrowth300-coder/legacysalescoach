export type ExternalMessage = { role: "prospect" | "agent"; content: string };

export type ExternalBrainInput = {
  message: string;
  conversation: ExternalMessage[];
  mode: "context" | "generate";
};

const MAX_MESSAGE = 8000;
const MAX_TURNS = 12;
const MAX_TURN = 2000;

export function parseExternalBrainInput(value: unknown): ExternalBrainInput {
  if (!value || typeof value !== "object") throw new Error("A JSON object is required");
  const input = value as Record<string, unknown>;
  if (typeof input.message !== "string" || !input.message.trim() || input.message.length > MAX_MESSAGE) {
    throw new Error(`message must contain 1-${MAX_MESSAGE} characters`);
  }
  if (input.mode !== undefined && input.mode !== "context" && input.mode !== "generate") {
    throw new Error("mode must be context or generate");
  }
  if (input.conversation !== undefined && (!Array.isArray(input.conversation) || input.conversation.length > MAX_TURNS)) {
    throw new Error(`conversation must contain at most ${MAX_TURNS} messages`);
  }
  const conversation = (input.conversation || []).map((turn: unknown) => {
    if (!turn || typeof turn !== "object") throw new Error("Invalid conversation message");
    const row = turn as Record<string, unknown>;
    if ((row.role !== "prospect" && row.role !== "agent") || typeof row.content !== "string" ||
      !row.content.trim() || row.content.length > MAX_TURN) {
      throw new Error(`Each conversation message needs role prospect/agent and 1-${MAX_TURN} characters of content`);
    }
    return { role: row.role, content: row.content.trim() } as ExternalMessage;
  });
  return { message: input.message.trim(), conversation, mode: input.mode === "generate" ? "generate" : "context" };
}

export type Situation = {
  summary: string;
  stated_facts: string[];
  possible_state: string;
  immediate_need: string;
  next_objective: string;
  retrieval_query: string;
  certainty: "inferred" | "model_assessed";
};

export function fallbackSituation(input: ExternalBrainInput): Situation {
  const message = input.message;
  const resistance = /not interested|don't trust|do not trust|stop messaging|no thanks|not buying/i.test(message);
  const question = /\?|how much|how does|what is|who is/i.test(message);
  const problem = /struggl|can't|cannot|not working|not getting|difficult|problem|stuck/i.test(message);
  const possible_state = resistance ? "Possible resistance or request to exit" :
    question ? "Asking for information" : problem ? "Describing a problem" : "Continuing the conversation";
  const immediate_need = resistance ? "Acknowledge the concern or boundary" :
    question ? "Answer the question directly" : problem ? "Understand the stated difficulty" : "Respond to what was actually said";
  const next_objective = resistance ? "Clarify only if welcome; otherwise respect the no" :
    question ? "Provide a clear, truthful answer" : problem ? "Explore the specific bottleneck" : "Advance one natural step";
  return {
    summary: message.slice(0, 300),
    stated_facts: [message.slice(0, 500)],
    possible_state,
    immediate_need,
    next_objective,
    retrieval_query: `${problem ? "sales discovery diagnosis " : "sales conversation response "}${message}`.slice(0, 900),
    certainty: "inferred",
  };
}

export function parseSituation(text: string, fallback: Situation): Situation {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const data = JSON.parse(match?.[0] || "") as Record<string, unknown>;
    const field = (key: string, previous: string) =>
      typeof data[key] === "string" && (data[key] as string).trim()
        ? (data[key] as string).trim().slice(0, 900) : previous;
    const facts = Array.isArray(data.stated_facts)
      ? data.stated_facts.filter((item): item is string => typeof item === "string" && !!item.trim()).slice(0, 8).map((item) => item.slice(0, 400))
      : fallback.stated_facts;
    return {
      summary: field("summary", fallback.summary), stated_facts: facts,
      possible_state: field("possible_state", fallback.possible_state),
      immediate_need: field("immediate_need", fallback.immediate_need),
      next_objective: field("next_objective", fallback.next_objective),
      retrieval_query: field("retrieval_query", fallback.retrieval_query),
      certainty: "model_assessed",
    };
  } catch {
    return fallback;
  }
}
