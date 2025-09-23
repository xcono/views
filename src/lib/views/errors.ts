import type { PostgrestError } from "@supabase/supabase-js";

export function toPostgrestError(
  input: { message: string; details?: unknown; hint?: string; code?: string }
): PostgrestError {
  return {
    message: input.message,
    details: input.details == null
      ? null
      : typeof input.details === "string"
        ? input.details
        : (() => {
            try { return JSON.stringify(input.details); } catch { return String(input.details); }
          })(),
    hint: input.hint ?? null,
    code: input.code ?? "ERROR"
  } as PostgrestError;
}
