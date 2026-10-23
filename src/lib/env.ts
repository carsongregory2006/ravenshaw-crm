import "server-only";

/** Which integrations are configured (by env var presence). Never exposes values. */
export const integrations = {
  supabase: () => !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  openrouter: () => !!process.env.OPENROUTER_API_KEY,
  resend: () => !!process.env.RESEND_API_KEY,
  telnyx: () => !!process.env.TELNYX_API_KEY,
  telnyxVoice: () => !!(process.env.TELNYX_API_KEY && (process.env.TELNYX_CONNECTION_ID || process.env.TELNYX_CREDENTIAL_ID)),
  calendly: () => !!process.env.CALENDLY_API_TOKEN,
  pandadoc: () => !!process.env.PANDADOC_API_KEY,
  mercury: () => !!process.env.MERCURY_API_KEY,
  stripe: () => !!process.env.STRIPE_SECRET_KEY,
  google: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
};

export type IntegrationKey = keyof typeof integrations;

export class IntegrationNotConfigured extends Error {
  constructor(public integration: string, envVar: string) {
    super(`${integration} is not configured. Add ${envVar} in Vercel → Settings → Environment Variables.`);
  }
}

export function need(name: string, integration: string): string {
  const v = process.env[name];
  if (!v) throw new IntegrationNotConfigured(integration, name);
  return v;
}
