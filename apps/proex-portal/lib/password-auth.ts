import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { drizzle } from 'drizzle-orm/d1';
import { authSchema } from '@/db/auth-schema';
import { HttpError } from './errors';

export interface PasswordAuthEnvironment {
  BETTER_AUTH_URL?: unknown;
  BETTER_AUTH_SECRET?: unknown;
}

export interface PasswordAuthOptions {
  /** Server-only injection for isolated tests; never populate from a request. */
  runtimeEnv?: PasswordAuthEnvironment;
  /** Internal local QA only; never populate from request input or production env. */
  allowInsecureDevelopment?: boolean;
  /**
   * Configure only for an already authorized administrator recovery request.
   * A recovery URL is a credential: do not log it or return it from public APIs.
   * Normal factory instances intentionally cannot request password reset links.
   */
  captureReset?: (url: string, token: string) => void | Promise<void>;
}

function configuration(environment: PasswordAuthEnvironment, allowInsecureDevelopment: boolean) {
  const { BETTER_AUTH_URL: configuredUrl, BETTER_AUTH_SECRET: secret } = environment;
  if (typeof secret !== 'string' || secret.trim().length < 32) {
    throw new HttpError(503, 'O acesso por senha ainda precisa ser configurado.', 'password_auth_unavailable');
  }
  if (typeof configuredUrl !== 'string' || !configuredUrl.trim()) {
    throw new HttpError(503, 'O endereço seguro de acesso ainda precisa ser configurado.', 'password_auth_unavailable');
  }
  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new HttpError(503, 'O endereço seguro de acesso está inválido.', 'password_auth_unavailable');
  }
  const localHttp = allowInsecureDevelopment && url.protocol === 'http:'
    && ['localhost', '127.0.0.1', 'terminal.local'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new HttpError(503, 'O endereço de acesso precisa ser uma origem HTTPS válida.', 'password_auth_unavailable');
  }
  return { baseURL: url.origin, secret, secureCookies: !localHttp };
}

/**
 * Request-scoped authentication; never cache a D1 binding or recovery callback
 * globally. Memberships and identity linking remain the portal's responsibility.
 * Await the factory before using .api or .handler. HTTP responses must preserve
 * Better Auth's Set-Cookie headers (use asResponse: true for sign-in/sign-out).
 */
export async function passwordAuth(db: D1Database, options: PasswordAuthOptions = {}) {
  // Defer the Worker-only module until runtime, so importing this module in Node
  // tests/build tooling does not require a Cloudflare execution context.
  const runtimeEnv = options.runtimeEnv ?? (await import('cloudflare:workers')).env;
  const { baseURL, secret, secureCookies } = configuration(runtimeEnv as PasswordAuthEnvironment, options.allowInsecureDevelopment === true);
  const captureReset = options.captureReset;

  return betterAuth({
    appName: 'PROEX Gestão',
    baseURL,
    basePath: '/api/auth',
    secret,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(drizzle(db, { schema: authSchema }), {
      provider: 'sqlite',
      schema: authSchema,
      // Cloudflare D1 has no interactive transaction API. The portal must make
      // invitation consumption and identity grants atomic in its own D1 batch.
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      // Accounts are activated by a controlled invitation, not an email proof.
      // Never treat their email/emailVerified as a source of PROEX privileges.
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 30 * 60,
      revokeSessionsOnPasswordReset: true,
      ...(captureReset ? {
        sendResetPassword: async ({ url, token }: { url: string; token: string }) => {
          await captureReset(url, token);
        },
      } : {}),
    },
    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: false },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    account: {
      accountLinking: { enabled: false, disableImplicitLinking: true },
    },
    verification: { storeIdentifier: 'hashed' },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/reset-password': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: 'proex',
      useSecureCookies: secureCookies,
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
  });
}

export type PasswordAuth = Awaited<ReturnType<typeof passwordAuth>>;
