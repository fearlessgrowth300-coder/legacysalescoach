import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SuggestionCard, { type Suggestion } from "@/components/SuggestionCard";

const baseSuggestion: Suggestion = {
  id: 1,
  type: "primary",
  text: "Hey — what's the actual pain right now?",
  whyThisWorks: "Mirrors back the prospect's last words.",
  warmthPrediction: 62,
};

const noop = () => {};

describe("SuggestionCard citation pill", () => {
  it("renders the cited principle and source when both are present", () => {
    const s: Suggestion = {
      ...baseSuggestion,
      citedPrincipleName: "Tactical Empathy Mirror",
      citedSourceName: "Chris Voss — Never Split the Difference",
    };

    render(
      <SuggestionCard
        suggestion={s}
        analysis={null}
        copiedId={null}
        onCopy={noop}
        onUse={noop}
        onFeedback={noop}
      />,
    );

    expect(screen.getByText(/Used: Tactical Empathy Mirror/i)).toBeInTheDocument();
    expect(screen.getByText(/From: Chris Voss/i)).toBeInTheDocument();
  });

  it("renders the principle alone when only it is provided", () => {
    const s: Suggestion = {
      ...baseSuggestion,
      citedPrincipleName: "Pre-Frame",
      citedSourceName: null,
    };

    render(
      <SuggestionCard
        suggestion={s}
        analysis={null}
        copiedId={null}
        onCopy={noop}
        onUse={noop}
        onFeedback={noop}
      />,
    );

    expect(screen.getByText(/Used: Pre-Frame/)).toBeInTheDocument();
    expect(screen.queryByText(/From:/)).not.toBeInTheDocument();
  });

  it("does NOT render the citation pill when no citation fields are present", () => {
    render(
      <SuggestionCard
        suggestion={baseSuggestion}
        analysis={null}
        copiedId={null}
        onCopy={noop}
        onUse={noop}
        onFeedback={noop}
      />,
    );

    expect(screen.queryByText(/Used:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/From:/)).not.toBeInTheDocument();
  });
});
