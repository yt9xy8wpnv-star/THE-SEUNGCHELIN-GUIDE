import { createClient } from "@supabase/supabase-js";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const authStorageKey = "seungchelin-guide-auth-token";

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && isHttpUrl(supabaseUrl),
);

function migrateAuthStorage() {
  if (!isSupabaseConfigured || typeof window === "undefined") return;

  try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    const defaultStorageKey = `sb-${projectRef}-auth-token`;
    const oldValue = window.localStorage.getItem(defaultStorageKey);
    const currentValue = window.localStorage.getItem(authStorageKey);

    if (oldValue && !currentValue) {
      window.localStorage.setItem(authStorageKey, oldValue);
    }
  } catch {
    // If storage is unavailable, Supabase falls back to its own handling.
  }
}

migrateAuthStorage();

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        storageKey: authStorageKey,
      },
    })
  : null;
