import { createClient } from "@supabase/supabase-js";
import { getSupabaseBrowserEnv } from "./env";
import { getSupabaseServiceEnv } from "./service-env";

export function createServerSupabaseClient() {
  const { anonKey, url } = getSupabaseBrowserEnv();

  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createSupabaseAdminClient() {
  const { serviceRoleKey, url } = getSupabaseServiceEnv();

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
