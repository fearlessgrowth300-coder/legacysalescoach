import { describe, expect, it } from "vitest";
import { cleanConversationExamples, friendHygieneIssues } from "../../supabase/functions/_shared/friend-conversation-engine";

// Lines copied from the workspace's real example conversations (2026-10-05).
const sample = `Ronnie:
 Yeah. How you do that? Just post reel?
You:
 Yeah, yesterday, my total earnings amounted to a substantial $30,545.97. In just five short months, my total earnings have amounted to a grand total of over $500,000, an impressive figure that is a testament to the success of my marketing efforts.
You:
 I could connect you to my email marketing specialist, he’s awesome 💯
You:
 Are you going to contact him now if I send you the link to his page because he’s active and the link will expire?
Ronnie:
 Ok.`;

describe("owner conversation examples", () => {
  it("keeps the flow and voice but drops the expiring-link urgency and 'yesterday' earnings", () => {
    const cleaned = cleanConversationExamples(sample);
    expect(cleaned).not.toMatch(/link will expire/);
    expect(cleaned).not.toMatch(/yesterday/);
    expect(cleaned).toContain("In just five short months");
    expect(cleaned).toContain("I could connect you to my email marketing specialist");
    expect(cleaned).toContain("Just post reel?");
  });

  it("asks for a rewrite when a reply repeats those claims", () => {
    expect(friendHygieneIssues("Send it now, the link will expire soon!", []).some((i) => i.startsWith("repeats a claim"))).toBe(true);
    expect(friendHygieneIssues("Yesterday I made $30,545.97 from it", []).some((i) => i.startsWith("repeats a claim"))).toBe(true);
    expect(friendHygieneIssues("Over five months it really added up for me", []).some((i) => i.startsWith("repeats a claim"))).toBe(false);
  });
});
