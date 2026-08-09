import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AiTypingIndicator from "@/components/AiTypingIndicator";

describe("AiTypingIndicator", () => {
  it("renders an accessible branded three-dot typing state", () => {
    const { container } = render(<AiTypingIndicator label="AI Brain is typing" />);

    expect(screen.getByRole("status", { name: "AI Brain is typing" })).toBeInTheDocument();
    expect(container.querySelectorAll(".ai-typing-dot")).toHaveLength(3);
    expect(container.querySelector("img")).toHaveAttribute("src", "/legacy-coach-192.png");
  });
});
