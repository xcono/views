import { supabase } from "./factory.js";

export type LiveEvent = "INSERT" | "UPDATE" | "DELETE";

export function subscribeTable(params: {
  table: string;
  schema?: string;
  events?: LiveEvent[];
  filter?: string; // e.g., "id=eq.123"
  onEvent: (payload: unknown) => void;
}): () => Promise<void> {
  const client = supabase.getClient();
  const schema = params.schema ?? "public";
  const events = params.events ?? ["INSERT", "UPDATE", "DELETE"];

  const channel = client.channel(
    `live:${schema}:${params.table}:${Math.random().toString(36).slice(2)}`
  );

  for (const event of events) {
    (channel as any).on(
      "postgres_changes",
      { event, schema, table: params.table, filter: params.filter },
      (payload: unknown) => params.onEvent(payload)
    );
  }

  (channel as any).subscribe();

  return async () => {
    await client.removeChannel(channel as any);
  };
}
