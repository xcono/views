import { browser } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';
import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';

/**
 * Minimal, SSR-safe Supabase client factory.
 * - Client-side: uses PUBLIC anon key; session persisted in the browser.
 * - Server-side: uses PUBLIC anon key by default; no session persistence.
 *   Optionally allow passing a different key (e.g., service role) via options
 *   from server-only code. This module never reads private env directly to
 *   avoid accidental secret exposure in browser bundles.
 *
 * Other modules should import ONLY this adapter, not the raw SDK.
 */

export type ServerClientOptions = {
	/** Optional override for server-side key (e.g., service role). */
	serverSupabaseKey?: string;
	/**
	 * Optional extra headers to attach to every request (server only).
	 * For example, forward an Authorization bearer to respect user RLS.
	 */
	globalHeaders?: Record<string, string>;
};

export type SupabaseAdapter = {
	/** Returns a Supabase client appropriate for the current environment. */
	getClient: (options?: ServerClientOptions) => SupabaseClient;
};

function createBrowserClient(): SupabaseClient {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const anonKey = publicEnv.PUBLIC_SUPABASE_ANON_KEY;

	if (!url || !anonKey) {
		// Log metadata only; never log actual keys
		console.warn('[supabase] Missing PUBLIC env for browser client');
	}

	const clientOptions: SupabaseClientOptions<any> = {
		auth: {
			persistSession: true
		}
	};

	return createClient(url as string, anonKey as string, clientOptions);
}

function createServerClient(options?: ServerClientOptions): SupabaseClient {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	// Default to anon key unless explicitly overridden by server-only caller
	const key = options?.serverSupabaseKey ?? publicEnv.PUBLIC_SUPABASE_ANON_KEY;

	if (!url || !key) {
		console.warn('[supabase] Missing env for server client (url/key)');
	}

	const clientOptions: SupabaseClientOptions<any> = {
		auth: {
			persistSession: false
		},
		global: options?.globalHeaders ? { headers: options.globalHeaders } : undefined
	};

	return createClient(url as string, key as string, clientOptions);
}

/**
 * Tiny integration adapter surface.
 * Usage:
 *   import { supabase } from '$lib/views/factory';
 *   const client = supabase.getClient();
 */
export const supabase: SupabaseAdapter = {
	getClient: (options?: ServerClientOptions) => {
		return browser ? createBrowserClient() : createServerClient(options);
	}
};

/** Convenience named exports if preferred. */
export const createSupabaseClient = (options?: ServerClientOptions) =>
	browser ? createBrowserClient() : createServerClient(options);

