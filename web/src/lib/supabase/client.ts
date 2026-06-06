"use client";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseBrowserEnv } from "./env";

export function createBrowserSupabaseClient() {
  const { anonKey, url } = getSupabaseBrowserEnv();

  return createClient(url, anonKey);
}
