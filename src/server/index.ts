import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential
} from '@simplewebauthn/server';
import { createClient } from '@supabase/supabase-js';
import { Elysia, redirect, t } from 'elysia';
import QRCode from 'qrcode';
import { Resend } from 'resend';

type User = {
  id: string;
  email: string;
  passkey_prompt_dismissed_at?: string | null;
};

type Passkey = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: AuthenticatorTransportFuture[] | null;
  device_type: string | null;
  backed_up: boolean;
};

type Card = {
  id: string;
  owner_id: string | null;
  link_1_url: string | null;
  link_2_url: string | null;
  link_1_kind?: 'custom' | 'connection' | null;
  link_2_kind?: 'custom' | 'connection' | null;
  link_1_connection_id?: string | null;
  link_2_connection_id?: string | null;
  claim_code?: string | null;
  claimed_at: string | null;
  created_at: string;
};

type Connection = {
  id: string;
  owner_id: string;
  label: string;
  provider: string;
  url: string;
  provider_account_id?: string | null;
  created_at: string;
};

const env = {
  supabaseUrl: Bun.env.SUPABASE_URL || 'https://example.supabase.co',
  supabaseServiceRoleKey: Bun.env.SUPABASE_SERVICE_ROLE_KEY || 'missing-service-role-key',
  resendApiKey: Bun.env.RESEND_API_KEY ?? '',
  resendFrom: Bun.env.RESEND_FROM ?? 'Aurealize <verify@example.com>',
  appOrigin: (Bun.env.APP_ORIGIN ?? 'http://localhost:5173').replace(/\/$/, ''),
  adminEmail: (Bun.env.ADMIN_EMAIL ?? '').trim().toLowerCase(),
  port: Number(Bun.env.PORT ?? 3000)
};
const supabaseConfigured = Boolean(Bun.env.SUPABASE_URL && Bun.env.SUPABASE_SERVICE_ROLE_KEY);
const rpName = 'Aurealize';
const rpID = new URL(env.appOrigin).hostname;

if (!supabaseConfigured) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. API calls will fail until .env is configured.');
}

const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false }
});
const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

const hour = 60 * 60 * 1000;
const sessionDays = 30;

function nowPlus(ms: number) {
  return new Date(Date.now() + ms).toISOString();
}

function randomCode(bytes = 32) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

async function hashSecret(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return Buffer.from(digest).toString('hex');
}

function parseCookies(header?: string) {
  return Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sessionCookie(token: string, expires: Date) {
  const secure = Bun.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `aurealize_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure}`;
}

function clearSessionCookie() {
  return 'aurealize_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function bytesToBase64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64url');
}

function base64UrlToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function normalizeUrl(url: string) {
  const input = url.trim();
  if (input.startsWith('mailto:')) return input;
  const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https links are allowed.');
  }
  return parsed.toString();
}

function normalizeCustomUrl(url: string) {
  const input = url.trim();
  const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http and https links are allowed.');
  return parsed.toString();
}

function normalizeEmail(email: string) {
  const value = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('Enter a valid email address.');
  return `mailto:${value}`;
}

function normalizeTrustedConnection(provider: string, value: string) {
  if (provider === 'Email') return normalizeEmail(value);

  const url = normalizeCustomUrl(value);
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');

  if (provider === 'LinkedIn' && hostname !== 'linkedin.com') {
    throw new Error('LinkedIn connections must use linkedin.com.');
  }

  if (provider === 'X' && !['x.com', 'twitter.com'].includes(hostname)) {
    throw new Error('X connections must use x.com or twitter.com.');
  }

  if (!['LinkedIn', 'X'].includes(provider)) {
    throw new Error('Unsupported connection type.');
  }

  return url;
}

async function normalizeCardTarget(
  userId: string,
  kind: 'custom' | 'connection',
  url: string | undefined,
  connectionId: string | null | undefined
) {
  if (kind === 'connection') {
    if (!connectionId) throw new Error('Choose a connection.');
    const { data, error } = await supabase
      .from('user_connections')
      .select('id')
      .eq('id', connectionId)
      .eq('owner_id', userId)
      .maybeSingle();
    if (error || !data) throw new Error('Connection not found.');
    return { kind, url: null, connectionId };
  }

  return { kind, url: normalizeCustomUrl(url ?? ''), connectionId: null };
}

async function currentUser(headers: Record<string, string | undefined>): Promise<User | null> {
  if (!supabaseConfigured) return null;

  const token = parseCookies(headers.cookie).aurealize_session;
  if (!token) return null;

  const tokenHash = await hashSecret(token);
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('user_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (sessionError || !session || new Date(session.expires_at).getTime() <= Date.now()) return null;

  const { data: user, error: userError } = await supabase
    .from('aurealize_users')
    .select('id, email, passkey_prompt_dismissed_at')
    .eq('id', session.user_id)
    .maybeSingle();

  if (userError || !user) return null;
  return user;
}

async function requireUser(headers: Record<string, string | undefined>) {
  if (!supabaseConfigured) {
    return {
      user: null,
      response: new Response(JSON.stringify({ error: 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.' }), {
        status: 500
      })
    };
  }

  const user = await currentUser(headers);
  if (!user) {
    return { user: null, response: new Response(JSON.stringify({ error: 'Authentication required.' }), { status: 401 }) };
  }
  return { user, response: null };
}

async function createSession(userId: string, set: { headers: Record<string, string | number> }) {
  const sessionToken = randomCode();
  const expires = new Date(Date.now() + sessionDays * 24 * hour);
  const { error: sessionError } = await supabase.from('sessions').insert({
    user_id: userId,
    token_hash: await hashSecret(sessionToken),
    expires_at: expires.toISOString()
  });
  if (sessionError) throw new Error(sessionError.message);

  set.headers['Set-Cookie'] = sessionCookie(sessionToken, expires);
}

async function passkeyCount(userId: string) {
  const { count, error } = await supabase
    .from('passkeys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function storeChallenge(userId: string, purpose: 'registration' | 'authentication', challenge: string) {
  await supabase.from('passkey_challenges').delete().eq('user_id', userId).eq('purpose', purpose);
  const { error } = await supabase.from('passkey_challenges').insert({
    user_id: userId,
    purpose,
    challenge_hash: await hashSecret(challenge),
    expires_at: nowPlus(5 * 60 * 1000)
  });
  if (error) throw new Error(error.message);
}

async function consumeChallenge(userId: string, purpose: 'registration' | 'authentication', challenge: string) {
  const challengeHash = await hashSecret(challenge);
  const { data, error } = await supabase
    .from('passkey_challenges')
    .select('id, expires_at')
    .eq('user_id', userId)
    .eq('purpose', purpose)
    .eq('challenge_hash', challengeHash)
    .maybeSingle();

  if (error || !data || new Date(data.expires_at).getTime() <= Date.now()) return false;
  await supabase.from('passkey_challenges').delete().eq('id', data.id);
  return true;
}

function toWebAuthnCredential(passkey: Passkey): WebAuthnCredential {
  return {
    id: passkey.credential_id,
    publicKey: base64UrlToBytes(passkey.public_key),
    counter: passkey.counter,
    transports: passkey.transports ?? undefined
  };
}

function expectedOrigins(request: Request) {
  return Array.from(new Set([env.appOrigin, new URL(request.url).origin]));
}

async function requireAdmin(headers: Record<string, string | undefined>) {
  const auth = await requireUser(headers);
  if (!auth.user) return auth;

  if (!env.adminEmail || auth.user.email.toLowerCase() !== env.adminEmail) {
    return {
      user: null,
      response: new Response(JSON.stringify({ error: 'Admin access required.' }), { status: 403 })
    };
  }

  return auth;
}

function nextCardId(cards: Pick<Card, 'id'>[]) {
  const max = cards.reduce((largest, card) => {
    const match = card.id.match(/^AC(\d+)$/i);
    return match ? Math.max(largest, Number(match[1])) : largest;
  }, 0);
  return `AC${String(max + 1).padStart(5, '0')}`;
}

async function sendVerificationEmail(email: string, verificationUrl: string) {
  if (!resend) {
    console.info(`Aurealize verification link for ${email}: ${verificationUrl}`);
    return;
  }

  await resend.emails.send({
    from: env.resendFrom,
    to: email,
    subject: 'Verify your Aurealize account',
    html: `
      <div style="font-family:Inter,Arial,sans-serif;background:#08090d;color:#f6f7fb;padding:32px">
        <div style="max-width:520px;margin:auto;background:#11131a;border:1px solid #262a36;border-radius:16px;padding:28px">
          <h1 style="font-size:24px;margin:0 0 12px">Verify your Aurealize account</h1>
          <p style="line-height:1.5;color:#c7cad4">This link expires in 1 hour.</p>
          <a href="${verificationUrl}" style="display:inline-block;margin-top:16px;padding:12px 18px;background:#f6f7fb;color:#08090d;border-radius:10px;text-decoration:none;font-weight:700">Verify account</a>
        </div>
      </div>
    `
  });
}

const app = new Elysia()
  .use(cors({ origin: env.appOrigin, credentials: true }))
  .use(staticPlugin({ assets: 'dist', prefix: '/' }))
  .get('/api/auth/session', async ({ headers }) => {
    const user = await currentUser(headers);
    return { user, isAdmin: Boolean(user && env.adminEmail && user.email.toLowerCase() === env.adminEmail) };
  })
  .post(
    '/api/auth/request',
    async ({ body }) => {
      if (!supabaseConfigured) {
        return new Response(JSON.stringify({ error: 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.' }), {
          status: 500
        });
      }

      const email = body.email.trim().toLowerCase();
      if (body.mode === 'signin') {
        const { data: existingUser, error: existingError } = await supabase
          .from('aurealize_users')
          .select('id')
          .eq('email', email)
          .maybeSingle();
        if (existingError) return new Response(JSON.stringify({ error: existingError.message }), { status: 500 });
        if (!existingUser) return new Response(JSON.stringify({ error: 'No Aurealize account exists for that email.' }), { status: 404 });
      }

      const code = randomCode();
      const codeHash = await hashSecret(code);
      const verificationUrl = `${env.appOrigin}/verify?code=${encodeURIComponent(code)}`;

      const { error: upsertError } = await supabase
        .from('aurealize_users')
        .upsert({ email }, { onConflict: 'email', ignoreDuplicates: false });
      if (upsertError) return new Response(JSON.stringify({ error: upsertError.message }), { status: 500 });

      const { error: insertError } = await supabase.from('verification_codes').insert({
        email,
        code_hash: codeHash,
        expires_at: nowPlus(hour)
      });
      if (insertError) return new Response(JSON.stringify({ error: insertError.message }), { status: 500 });

      await sendVerificationEmail(email, verificationUrl);
      return { ok: true, devVerificationUrl: resend ? undefined : verificationUrl };
    },
    { body: t.Object({ email: t.String({ format: 'email' }), mode: t.Optional(t.Union([t.Literal('register'), t.Literal('signin')])) }) }
  )
  .post(
    '/api/auth/verify',
    async ({ body, set }) => {
      if (!supabaseConfigured) {
        return new Response(JSON.stringify({ error: 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.' }), {
          status: 500
        });
      }

      const codeHash = await hashSecret(body.code);
      const { data: verification, error } = await supabase
        .from('verification_codes')
        .select('id, email, expires_at, consumed_at')
        .eq('code_hash', codeHash)
        .maybeSingle();

      if (error || !verification) return new Response(JSON.stringify({ error: 'Invalid verification link.' }), { status: 400 });
      if (verification.consumed_at) return new Response(JSON.stringify({ error: 'Verification link has already been used.' }), { status: 400 });
      if (new Date(verification.expires_at).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ error: 'Verification link expired.' }), { status: 400 });
      }

      const { data: user, error: userError } = await supabase
        .from('aurealize_users')
        .select('id, email, passkey_prompt_dismissed_at')
        .eq('email', verification.email)
        .maybeSingle();
      if (userError || !user) return new Response(JSON.stringify({ error: 'Could not load user.' }), { status: 500 });

      try {
        await createSession(user.id, set);
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Could not create session.' }), { status: 500 });
      }

      await supabase.from('verification_codes').update({ consumed_at: new Date().toISOString() }).eq('id', verification.id);
      return { user, passkeyCount: await passkeyCount(user.id) };
    },
    { body: t.Object({ code: t.String({ minLength: 16 }) }) }
  )
  .post('/api/auth/passkeys/register/options', async ({ headers }) => {
    const auth = await requireUser(headers);
    if (!auth.user) return auth.response;

    const { data: passkeys, error } = await supabase
      .from('passkeys')
      .select('credential_id, transports')
      .eq('user_id', auth.user.id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(auth.user.id),
      userName: auth.user.email,
      userDisplayName: auth.user.email,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred'
      },
      excludeCredentials: (passkeys ?? []).map((passkey) => ({
        id: passkey.credential_id,
        transports: passkey.transports ?? undefined
      }))
    });

    await storeChallenge(auth.user.id, 'registration', options.challenge);
    return options;
  })
  .post(
    '/api/auth/passkeys/register/verify',
    async ({ body, headers, request }) => {
      const auth = await requireUser(headers);
      if (!auth.user) return auth.response;

      let verified;
      try {
        const response = body.response as RegistrationResponseJSON;
        verified = await verifyRegistrationResponse({
          response,
          expectedOrigin: expectedOrigins(request),
          expectedRPID: rpID,
          expectedChallenge: (challenge) => consumeChallenge(auth.user.id, 'registration', challenge)
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Could not verify passkey.' }), { status: 400 });
      }

      if (!verified.verified) return new Response(JSON.stringify({ error: 'Could not verify passkey.' }), { status: 400 });

      const response = body.response as RegistrationResponseJSON;
      const credential = verified.registrationInfo.credential;
      const { error } = await supabase.from('passkeys').insert({
        user_id: auth.user.id,
        credential_id: credential.id,
        public_key: bytesToBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: response.response.transports ?? null,
        device_type: verified.registrationInfo.credentialDeviceType,
        backed_up: verified.registrationInfo.credentialBackedUp
      });
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

      await supabase.from('aurealize_users').update({ passkey_prompt_dismissed_at: null }).eq('id', auth.user.id);
      return { ok: true };
    },
    { body: t.Object({ response: t.Any() }) }
  )
  .post('/api/auth/passkeys/skip', async ({ headers }) => {
    const auth = await requireUser(headers);
    if (!auth.user) return auth.response;

    const { error } = await supabase
      .from('aurealize_users')
      .update({ passkey_prompt_dismissed_at: new Date().toISOString() })
      .eq('id', auth.user.id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return { ok: true };
  })
  .post(
    '/api/auth/passkeys/login/options',
    async ({ body }) => {
      if (!supabaseConfigured) {
        return new Response(JSON.stringify({ error: 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.' }), {
          status: 500
        });
      }

      const email = body.email.trim().toLowerCase();
      const { data: user, error: userError } = await supabase
        .from('aurealize_users')
        .select('id, email')
        .eq('email', email)
        .maybeSingle();
      if (userError) return new Response(JSON.stringify({ error: userError.message }), { status: 500 });
      if (!user) return new Response(JSON.stringify({ error: 'No Aurealize account exists for that email.' }), { status: 404 });

      const { data: passkeys, error: passkeyError } = await supabase
        .from('passkeys')
        .select('credential_id, transports')
        .eq('user_id', user.id);
      if (passkeyError) return new Response(JSON.stringify({ error: passkeyError.message }), { status: 500 });
      if (!passkeys?.length) return new Response(JSON.stringify({ error: 'No passkey is registered for that account.' }), { status: 404 });

      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: passkeys.map((passkey) => ({
          id: passkey.credential_id,
          transports: passkey.transports ?? undefined
        })),
        userVerification: 'preferred'
      });

      await storeChallenge(user.id, 'authentication', options.challenge);
      return { userId: user.id, options };
    },
    { body: t.Object({ email: t.String({ format: 'email' }) }) }
  )
  .post(
    '/api/auth/passkeys/login/verify',
    async ({ body, set, request }) => {
      if (!supabaseConfigured) {
        return new Response(JSON.stringify({ error: 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.' }), {
          status: 500
        });
      }

      const response = body.response as AuthenticationResponseJSON;
      const { data: passkey, error: passkeyError } = await supabase
        .from('passkeys')
        .select('id, user_id, credential_id, public_key, counter, transports, device_type, backed_up')
        .eq('credential_id', response.id)
        .maybeSingle();
      if (passkeyError || !passkey) return new Response(JSON.stringify({ error: 'Passkey not found.' }), { status: 404 });

      let verified;
      try {
        verified = await verifyAuthenticationResponse({
          response,
          expectedOrigin: expectedOrigins(request),
          expectedRPID: rpID,
          credential: toWebAuthnCredential(passkey as Passkey),
          expectedChallenge: (challenge) => consumeChallenge(passkey.user_id, 'authentication', challenge)
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Could not verify passkey.' }), { status: 400 });
      }

      if (!verified.verified) return new Response(JSON.stringify({ error: 'Could not verify passkey.' }), { status: 400 });

      const { error: updateError } = await supabase
        .from('passkeys')
        .update({
          counter: verified.authenticationInfo.newCounter,
          backed_up: verified.authenticationInfo.credentialBackedUp,
          device_type: verified.authenticationInfo.credentialDeviceType
        })
        .eq('id', passkey.id);
      if (updateError) return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });

      try {
        await createSession(passkey.user_id, set);
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Could not create session.' }), { status: 500 });
      }

      return { ok: true };
    },
    { body: t.Object({ response: t.Any() }) }
  )
  .post('/api/auth/logout', async ({ headers, set }) => {
    const token = parseCookies(headers.cookie).aurealize_session;
    if (token) await supabase.from('sessions').delete().eq('token_hash', await hashSecret(token));
    set.headers['Set-Cookie'] = clearSessionCookie();
    return { ok: true };
  })
  .get('/api/cards', async ({ headers }) => {
    const auth = await requireUser(headers);
    if (!auth.user) return auth.response;
    const { data, error } = await supabase
      .from('cards')
      .select('id, owner_id, link_1_url, link_2_url, link_1_kind, link_2_kind, link_1_connection_id, link_2_connection_id, claimed_at, created_at')
      .eq('owner_id', auth.user.id)
      .order('created_at', { ascending: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return { cards: data as Card[] };
  })
  .get('/api/connections', async ({ headers }) => {
    const auth = await requireUser(headers);
    if (!auth.user) return auth.response;

    const { data, error } = await supabase
      .from('user_connections')
      .select('id, owner_id, label, provider, url, provider_account_id, created_at')
      .eq('owner_id', auth.user.id)
      .order('created_at', { ascending: true });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return { connections: data as Connection[] };
  })
  .post(
    '/api/connections',
    async ({ body, headers }) => {
      const auth = await requireUser(headers);
      if (!auth.user) return auth.response;

      let url: string;
      try {
        url = normalizeTrustedConnection(body.provider, body.url);
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid URL.' }), { status: 400 });
      }

      const { data, error } = await supabase
        .from('user_connections')
        .insert({
          owner_id: auth.user.id,
          label: body.label.trim(),
          provider: body.provider.trim(),
          url
        })
        .select('id, owner_id, label, provider, url, provider_account_id, created_at')
        .single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return { connection: data as Connection };
    },
    { body: t.Object({ label: t.String({ minLength: 1 }), provider: t.String({ minLength: 1 }), url: t.String() }) }
  )
  .delete('/api/connections/:id', async ({ params, headers }) => {
    const auth = await requireUser(headers);
    if (!auth.user) return auth.response;

    const { error } = await supabase.from('user_connections').delete().eq('id', params.id).eq('owner_id', auth.user.id);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return { ok: true };
  })
  .post(
    '/api/cards/claim',
    async ({ body, headers }) => {
      const auth = await requireUser(headers);
      if (!auth.user) return auth.response;

      const claimHash = await hashSecret(body.code);
      const { data: card, error: loadError } = await supabase
        .from('cards')
        .select('id, owner_id')
        .eq('claim_code_hash', claimHash)
        .maybeSingle();
      if (loadError || !card) return new Response(JSON.stringify({ error: 'Invalid card claim code.' }), { status: 400 });
      if (card.owner_id && card.owner_id !== auth.user.id) {
        return new Response(JSON.stringify({ error: 'This card has already been claimed.' }), { status: 409 });
      }

      const { data, error } = await supabase
        .from('cards')
        .update({ owner_id: auth.user.id, claimed_at: new Date().toISOString() })
        .eq('id', card.id)
        .select('id, owner_id, link_1_url, link_2_url, link_1_kind, link_2_kind, link_1_connection_id, link_2_connection_id, claimed_at, created_at')
        .single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      return { card: data as Card };
    },
    { body: t.Object({ code: t.String({ minLength: 16 }) }) }
  )
  .patch(
    '/api/cards/:id',
    async ({ params, body, headers }) => {
      const auth = await requireUser(headers);
      if (!auth.user) return auth.response;

      let link1: Awaited<ReturnType<typeof normalizeCardTarget>>;
      let link2: Awaited<ReturnType<typeof normalizeCardTarget>>;
      try {
        link1 = await normalizeCardTarget(auth.user.id, body.link1Kind, body.link1Url, body.link1ConnectionId);
        link2 = await normalizeCardTarget(auth.user.id, body.link2Kind, body.link2Url, body.link2ConnectionId);
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid URL.' }), { status: 400 });
      }

      const { data, error } = await supabase
        .from('cards')
        .update({
          link_1_kind: link1.kind,
          link_1_url: link1.url,
          link_1_connection_id: link1.connectionId,
          link_2_kind: link2.kind,
          link_2_url: link2.url,
          link_2_connection_id: link2.connectionId
        })
        .eq('id', params.id)
        .eq('owner_id', auth.user.id)
        .select('id, owner_id, link_1_url, link_2_url, link_1_kind, link_2_kind, link_1_connection_id, link_2_connection_id, claimed_at, created_at')
        .maybeSingle();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
      if (!data) return new Response(JSON.stringify({ error: 'Card not found.' }), { status: 404 });
      return { card: data as Card };
    },
    {
      body: t.Object({
        link1Kind: t.Union([t.Literal('custom'), t.Literal('connection')]),
        link1Url: t.Optional(t.String()),
        link1ConnectionId: t.Optional(t.Nullable(t.String())),
        link2Kind: t.Union([t.Literal('custom'), t.Literal('connection')]),
        link2Url: t.Optional(t.String()),
        link2ConnectionId: t.Optional(t.Nullable(t.String()))
      })
    }
  )
  .get('/api/admin/cards', async ({ headers }) => {
    const auth = await requireAdmin(headers);
    if (!auth.user) return auth.response;

      const { data, error } = await supabase
        .from('cards')
        .select('id, owner_id, link_1_url, link_2_url, link_1_kind, link_2_kind, link_1_connection_id, link_2_connection_id, claim_code, claimed_at, created_at')
      .order('created_at', { ascending: false });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    const cards = await Promise.all(
      ((data ?? []) as Card[]).map(async (card) => {
        const claimUrl = card.claim_code ? `${env.appOrigin}/claim?card=${encodeURIComponent(card.claim_code)}` : null;
        return {
          ...card,
          claimUrl,
          qrSvg: !card.owner_id && claimUrl ? await QRCode.toString(claimUrl, { type: 'svg', margin: 2, width: 256 }) : null
        };
      })
    );

    return { cards, nextId: nextCardId(cards) };
  })
  .get('/api/admin/cards/next-id', async ({ headers }) => {
    const auth = await requireAdmin(headers);
    if (!auth.user) return auth.response;

    const { data, error } = await supabase.from('cards').select('id');
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return { nextId: nextCardId((data ?? []) as Pick<Card, 'id'>[]) };
  })
  .post(
    '/api/admin/cards',
    async ({ body, headers }) => {
      const auth = await requireAdmin(headers);
      if (!auth.user) return auth.response;

      const code = randomCode();
      const claimUrl = `${env.appOrigin}/claim?card=${encodeURIComponent(code)}`;
      let defaultLink1: string | null = null;
      let defaultLink2: string | null = null;
      try {
        defaultLink1 = body.defaultLink1 ? normalizeCustomUrl(body.defaultLink1) : null;
        defaultLink2 = body.defaultLink2 ? normalizeCustomUrl(body.defaultLink2) : null;
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid URL.' }), { status: 400 });
      }
      const { data, error } = await supabase
        .from('cards')
        .insert({
          id: body.cardId,
          claim_code: code,
          claim_code_hash: await hashSecret(code),
          link_1_kind: 'custom',
          link_2_kind: 'custom',
          link_1_url: defaultLink1,
          link_2_url: defaultLink2
        })
        .select('id, owner_id, link_1_url, link_2_url, link_1_kind, link_2_kind, link_1_connection_id, link_2_connection_id, claim_code, claimed_at, created_at')
        .single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

      return {
        card: data,
        claimUrl,
        qrSvg: await QRCode.toString(claimUrl, { type: 'svg', margin: 2, width: 512 })
      };
    },
    {
      body: t.Object({
        cardId: t.String({ minLength: 2 }),
        defaultLink1: t.Optional(t.String()),
        defaultLink2: t.Optional(t.String())
      })
    }
  )
  .get('/card_*', async ({ request }) => {
    if (!supabaseConfigured) {
      return new Response('Aurealize is not configured yet.', { status: 500 });
    }

    const match = new URL(request.url).pathname.match(/^\/card_(.+)_([12])$/);
    if (!match) return new Response('Unknown Aurealize card link.', { status: 404 });

    const [, cardId, rawSlot] = match;
    const slot = Number(rawSlot);
    if (![1, 2].includes(slot)) return new Response('Unknown Aurealize card link.', { status: 404 });

    const { data: card, error } = await supabase
      .from('cards')
      .select('id, owner_id, link_1_url, link_2_url, link_1_kind, link_2_kind, link_1_connection_id, link_2_connection_id')
      .eq('id', cardId)
      .maybeSingle();
    if (error || !card) return new Response('Unknown Aurealize card.', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    if (!card.owner_id) {
      return new Response(`Card ${card.id} isnt claimed! Please claim it with the QR code`, {
        status: 404,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    const kind = slot === 1 ? card.link_1_kind : card.link_2_kind;
    const connectionId = slot === 1 ? card.link_1_connection_id : card.link_2_connection_id;
    let destination = slot === 1 ? card.link_1_url : card.link_2_url;

    if (kind === 'connection' && connectionId) {
      const { data: connection, error: connectionError } = await supabase
        .from('user_connections')
        .select('url')
        .eq('id', connectionId)
        .eq('owner_id', card.owner_id)
        .maybeSingle();
      if (connectionError || !connection) return redirect(`${env.appOrigin}/`);
      destination = connection.url;
      return redirect(destination);
    }

    if (!destination) {
      return redirect(`${env.appOrigin}/`);
    }

    return redirect(`${env.appOrigin}/leaving?to=${encodeURIComponent(destination)}`);
  })
  .get('*', () => Bun.file('dist/index.html'))
  .listen(env.port);

console.log(`Aurealize server running on http://localhost:${app.server?.port}`);
