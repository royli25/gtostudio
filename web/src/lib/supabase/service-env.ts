import { getSupabaseBrowserEnv } from "./env";

export function getSupabaseServiceEnv() {
  const { url } = getSupabaseBrowserEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return { serviceRoleKey, url };
}
