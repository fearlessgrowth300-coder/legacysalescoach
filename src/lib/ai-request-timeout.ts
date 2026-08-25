// Friend replies can include retrieval, prospect-memory updates, graph
// reasoning, generation and a quality repair. The old 45-second client race
// rejected a healthy backend response before it could return, then encouraged
// the user to retry and create duplicate suggestions. Keep this aligned with
// the 90-second AI Chat deadline while still allowing the UI to recover from a
// genuinely stalled request.
export const CONVERSATION_AI_TIMEOUT_MS = 90000;

export class AiRequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The AI took longer than ${Math.round(timeoutMs / 1000)} seconds. Please try again.`);
    this.name = "AiRequestTimeoutError";
  }
}

export function withAiRequestTimeout<T>(
  request: PromiseLike<T>,
  timeoutMs = CONVERSATION_AI_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(
      () => reject(new AiRequestTimeoutError(timeoutMs)),
      timeoutMs,
    );
    Promise.resolve(request).then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}
