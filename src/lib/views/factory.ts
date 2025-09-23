import { env as publicEnv } from "$env/dynamic/public";
import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";

/**
 * SPA-only Supabase client factory.
 * - Uses PUBLIC anon key; session persisted in the browser.
 * - This module never reads private env directly to avoid accidental secret exposure.
 * - Designed for SPA (Single Page Application) architecture only.
 * - Follows official Supabase JS documentation patterns.
 *
 * Other modules should import ONLY this adapter, not the raw SDK.
 */

export type SupabaseAdapter = {
  /** Returns a Supabase client for browser environment. */
  getClient: () => SupabaseClient;
};

function createSupabaseClient(): SupabaseClient {
  const url = publicEnv.PUBLIC_SUPABASE_URL;
  const anonKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Log metadata only; never log actual keys
    console.warn("[supabase] Missing PUBLIC env for browser client");
    throw new Error("Supabase URL and anon key are required");
  }

  const clientOptions: SupabaseClientOptions<any> = {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      headers: {
        'X-Client-Info': 'supaview@0.0.1',
      },
    },
  };

  return createClient(url as string, anonKey as string, clientOptions);
}

/**
 * Tiny integration adapter surface for SPA applications.
 * Usage:
 *   import { supabase } from '$lib/views/factory';
 *   const client = supabase.getClient();
 */
export const supabase: SupabaseAdapter = {
  getClient: createSupabaseClient,
};
