// Friend replies can include retrieval, prospect-memory updates, graph
// reasoning, generation and a quality repair. Give the backend enough time to
// finish its bounded retries, while still recovering the UI from a stalled
// request and retaining the user's draft for an explicit retry.
export const CONVERSATION_AI_TIMEOUT_MS = 120000;

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
