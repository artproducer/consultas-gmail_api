import { createClient } from 'jsr:@supabase/supabase-js@2';

export function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

export function createServiceClient() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function getAllowedWebOrigins() {
  return (Deno.env.get('ALLOWED_WEB_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getDefaultAppUrl() {
  const origins = getAllowedWebOrigins();
  return origins[0] ?? 'http://127.0.0.1:5500';
}

export function assertAllowedRedirect(redirectTo: string) {
  const url = new URL(redirectTo);
  const allowedOrigins = getAllowedWebOrigins();
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) {
    throw new Error('redirect_to no permitido');
  }
  return url;
}

export function buildRedirectUrl(redirectTo: string, params: Record<string, string>) {
  const url = new URL(redirectTo);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
