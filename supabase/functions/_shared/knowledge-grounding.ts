export function readGroundingVerdict(raw: string, draft: string, unknownSources: (text: string) => string[]) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const verdict = JSON.parse(cleaned);
  if (!verdict || !Array.isArray(verdict.issues)) throw new Error("Invalid grounding verdict schema");
  const issues: string[] = Array.isArray(verdict.issues) ? verdict.issues.map(String) : [];
  const corrected = typeof verdict.corrected_response === "string" ? verdict.corrected_response.trim() : "";
  if (verdict.pass !== true && verdict.pass !== false) throw new Error("Invalid grounding verdict");
  if (verdict.pass === false && !corrected) throw new Error("The draft was not supported by its sources");
  if (verdict.pass === true && issues.length) throw new Error("Grounding verdict has unresolved issues");
  const response = verdict.pass === false ? corrected : draft;
  if (verdict.pass === false && response === draft) throw new Error("Rejected draft was not repaired");
  if (response.length < 24 || unknownSources(response).length) throw new Error("The checked answer contains an unsupported source");
  return { response, repaired: verdict.pass === false, issues: [], resolvedIssues: issues };
}
