import type { ContinueRequest } from "./continue-types.ts";

export interface ContinueResult {
  ok: boolean;
  error?: string;
  childExitCode?: number;
}

// Stub — Task 10 fills in the real implementation.
export async function executeContinue(_req: ContinueRequest): Promise<ContinueResult> {
  return { ok: false, error: "executeContinue not yet implemented" };
}
