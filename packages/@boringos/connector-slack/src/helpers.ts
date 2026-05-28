// SPDX-License-Identifier: AGPL-3.0-or-later

export type TokenSource = string | (() => Promise<string>);

export async function resolveToken(src: TokenSource): Promise<string> {
  return typeof src === "function" ? src() : src;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchSlack(
  getToken: () => Promise<string>,
  fetchImpl: Fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetchImpl(url, { ...init, headers });
  if (res.status !== 401) {
    // Slack returns 200 even on auth errors; check body for invalid_auth/token_expired
    const text = await res.clone().text();
    if (text.includes("invalid_auth") || text.includes("token_expired")) {
      const fresh = await getToken();
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("Authorization", `Bearer ${fresh}`);
      return fetchImpl(url, { ...init, headers: retryHeaders });
    }
  }
  return res;
}
