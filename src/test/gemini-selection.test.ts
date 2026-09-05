import { beforeEach, describe, expect, it } from "vitest";
import { GEMINI_MODEL_STORAGE_KEY, getSelectedGeminiModel, setSelectedGeminiModel } from "../hooks/useActiveAiModel";

describe("Gemini 3.8 selection upgrade", () => {
  beforeEach(() => localStorage.clear());
  it("uses 3.8 for new sessions", () => {
    expect(getSelectedGeminiModel()).toBe("gemini-3.8-flash");
  });
  it("upgrades a saved 3.7 default so the actual request uses 3.8", () => {
    localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, "gemini-3.7-flash");
    expect(getSelectedGeminiModel()).toBe("gemini-3.8-flash");
    expect(localStorage.getItem(GEMINI_MODEL_STORAGE_KEY)).toBe("gemini-3.8-flash");
  });
  it("preserves deliberate model choices after the upgrade", () => {
    getSelectedGeminiModel();
    setSelectedGeminiModel("gemini-3.7-flash");
    expect(getSelectedGeminiModel()).toBe("gemini-3.7-flash");
  });
});
