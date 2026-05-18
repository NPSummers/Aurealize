export type Session = {
  user: null | { id: string; email: string };
  isAdmin: boolean;
};

export type Card = {
  id: string;
  owner_id: string | null;
  link_1_url: string | null;
  link_2_url: string | null;
  claimed_at: string | null;
  created_at: string;
};

export type AdminCard = Card & {
  claim_code: string | null;
  claimUrl: string | null;
  qrSvg: string | null;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data as T;
}

export const api = {
  session: () => request<Session>('/api/auth/session'),
  requestLogin: (email: string, mode: 'register' | 'signin') =>
    request<{ ok: true; devVerificationUrl?: string }>('/api/auth/request', {
      method: 'POST',
      body: JSON.stringify({ email, mode })
    }),
  verify: (code: string) =>
    request<{ user: { id: string; email: string; passkey_prompt_dismissed_at?: string | null }; passkeyCount: number }>(
      '/api/auth/verify',
      {
        method: 'POST',
        body: JSON.stringify({ code })
      }
    ),
  passkeyRegisterOptions: () => request<unknown>('/api/auth/passkeys/register/options', { method: 'POST' }),
  passkeyRegisterVerify: (response: unknown) =>
    request<{ ok: true }>('/api/auth/passkeys/register/verify', {
      method: 'POST',
      body: JSON.stringify({ response })
    }),
  passkeySkip: () => request<{ ok: true }>('/api/auth/passkeys/skip', { method: 'POST' }),
  passkeyLoginOptions: (email: string) =>
    request<{ userId: string; options: unknown }>('/api/auth/passkeys/login/options', {
      method: 'POST',
      body: JSON.stringify({ email })
    }),
  passkeyLoginVerify: (response: unknown) =>
    request<{ ok: true }>('/api/auth/passkeys/login/verify', {
      method: 'POST',
      body: JSON.stringify({ response })
    }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  cards: () => request<{ cards: Card[] }>('/api/cards'),
  claim: (code: string) =>
    request<{ card: Card }>('/api/cards/claim', {
      method: 'POST',
      body: JSON.stringify({ code })
    }),
  updateCard: (id: string, link1: string, link2: string) =>
    request<{ card: Card }>(`/api/cards/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ link1, link2 })
    }),
  adminCards: () => request<{ cards: AdminCard[]; nextId: string }>('/api/admin/cards'),
  adminNextCardId: () => request<{ nextId: string }>('/api/admin/cards/next-id'),
  adminCreateCard: (cardId: string, defaultLink1: string, defaultLink2: string) =>
    request<{ card: AdminCard; claimUrl: string; qrSvg: string }>('/api/admin/cards', {
      method: 'POST',
      body: JSON.stringify({ cardId, defaultLink1, defaultLink2 })
    })
};
