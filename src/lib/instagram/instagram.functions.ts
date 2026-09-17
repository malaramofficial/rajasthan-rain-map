import { createServerFn } from "@tanstack/react-start";

const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com/me";
const META_GRAPH_VERSION = process.env["META_GRAPH_VERSION"] ?? "v25.0";
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const FACEBOOK_AUTHORIZE_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

function getEnv(name: string): string | undefined { return process.env[name]; }

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + padding;
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signFacebookState(payload: string): Promise<string> {
  const secret = getEnv("META_APP_SECRET");
  if (!secret) throw new Error("META_APP_SECRET is not configured on the server.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64Url(new Uint8Array(signature));
}

async function createFacebookState(): Promise<string> {
  const payload = JSON.stringify({ t: Date.now(), n: crypto.randomUUID() });
  const encoded = base64Url(payload);
  return `${encoded}.${await signFacebookState(encoded)}`;
}

async function verifyFacebookState(state: string): Promise<boolean> {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return false;
  try {
    const expected = await signFacebookState(payload);
    const a = fromBase64Url(signature);
    const b = fromBase64Url(expected);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) return false;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { t?: number };
    return typeof data.t === "number" && Date.now() - data.t >= 0 && Date.now() - data.t <= 10 * 60 * 1000;
  } catch { return false; }
}

export const getInstagramAuthorizeUrl = createServerFn({ method: "GET" }).handler(async (): Promise<{ url: string | null; configured: boolean }> => {
  const clientId = getEnv("INSTAGRAM_CLIENT_ID");
  const redirectUri = getEnv("INSTAGRAM_REDIRECT_URI");
  if (!clientId || !redirectUri) return { url: null, configured: false };
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "instagram_business_basic" });
  return { url: `${INSTAGRAM_AUTHORIZE_URL}?${params.toString()}`, configured: true };
});

export const getFacebookBusinessAuthorizeUrl = createServerFn({ method: "GET" }).handler(async (): Promise<{ url: string | null; configured: boolean; error?: string }> => {
  const appId = getEnv("META_APP_ID") ?? getEnv("INSTAGRAM_CLIENT_ID");
  const configId = getEnv("META_FACEBOOK_CONFIG_ID");
  const redirectUri = getEnv("META_FACEBOOK_REDIRECT_URI");
  if (!appId || !configId || !redirectUri || !getEnv("META_APP_SECRET")) {
    return { url: null, configured: false, error: "META_APP_ID, META_FACEBOOK_CONFIG_ID, META_FACEBOOK_REDIRECT_URI और META_APP_SECRET configure करना बाकी है।" };
  }
  const state = await createFacebookState();
  const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, config_id: configId, response_type: "code", override_default_response_type: "true", state });
  return { url: `${FACEBOOK_AUTHORIZE_URL}?${params.toString()}`, configured: true };
});

async function readInstagramProfile(accessToken: string) {
  const url = new URL(INSTAGRAM_GRAPH_URL);
  url.searchParams.set("fields", "id,username");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const payload = (await response.json()) as { id?: string; username?: string; error?: { message?: string } };
  if (!response.ok || !payload.id) throw new Error(payload.error?.message || `Instagram API returned ${response.status}.`);
  return { userId: payload.id, username: payload.username };
}

export const verifyConfiguredInstagramToken = createServerFn({ method: "GET" }).handler(async (): Promise<{ configured: boolean; valid: boolean; userId?: string; username?: string; error?: string }> => {
  const accessToken = getEnv("INSTAGRAM_ACCESS_TOKEN");
  if (!accessToken) return { configured: false, valid: false, error: "INSTAGRAM_ACCESS_TOKEN is not configured." };
  try { return { configured: true, valid: true, ...(await readInstagramProfile(accessToken)) }; }
  catch (error) { return { configured: true, valid: false, error: error instanceof Error ? error.message : "Instagram API request failed." }; }
});

export const testInstagramMediaAccess = createServerFn({ method: "GET" }).handler(async (): Promise<{ configured: boolean; valid: boolean; mediaEndpoint: "success" | "failed" | "not_tested"; mediaCount?: number; reelsCount?: number; latestTimestamp?: string; error?: string }> => {
  const accessToken = getEnv("INSTAGRAM_ACCESS_TOKEN");
  if (!accessToken) return { configured: false, valid: false, mediaEndpoint: "not_tested", error: "INSTAGRAM_ACCESS_TOKEN is not configured." };
  try {
    await readInstagramProfile(accessToken);
    const url = new URL("https://graph.instagram.com/me/media");
    url.searchParams.set("fields", "id,media_type,media_product_type,timestamp,permalink,caption");
    url.searchParams.set("limit", "10");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = (await response.json()) as { data?: Array<{ media_type?: string; media_product_type?: string; timestamp?: string }>; error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || `Instagram media API returned ${response.status}.`);
    const media = payload.data ?? [];
    return { configured: true, valid: true, mediaEndpoint: "success", mediaCount: media.length, reelsCount: media.filter((item) => item.media_type === "VIDEO" || item.media_product_type === "REELS").length, latestTimestamp: media[0]?.timestamp };
  } catch (error) { return { configured: true, valid: false, mediaEndpoint: "failed", error: error instanceof Error ? error.message : "Instagram media API request failed." }; }
});

export const exchangeFacebookBusinessCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Missing Facebook authorization response.");
    const value = input as { code?: unknown; state?: unknown };
    if (typeof value.code !== "string" || !value.code.trim()) throw new Error("Facebook authorization code missing.");
    if (typeof value.state !== "string" || !value.state.trim()) throw new Error("Facebook authorization state missing.");
    return { code: value.code.trim(), state: value.state.trim() };
  })
  .handler(async ({ data }): Promise<{ pageId: string; pageName?: string; instagramUserId: string; instagramUsername?: string }> => {
    if (!(await verifyFacebookState(data.state))) throw new Error("Facebook authorization state invalid or expired.");
    const appId = getEnv("META_APP_ID") ?? getEnv("INSTAGRAM_CLIENT_ID");
    const appSecret = getEnv("META_APP_SECRET") ?? getEnv("INSTAGRAM_CLIENT_SECRET");
    const redirectUri = getEnv("META_FACEBOOK_REDIRECT_URI");
    const supabaseUrl = getEnv("SUPABASE_URL");
    const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!appId || !appSecret || !redirectUri || !supabaseUrl || !serviceRoleKey) throw new Error("Meta OAuth or Supabase server configuration is incomplete.");

    const tokenUrl = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", data.code);
    const tokenResponse = await fetch(tokenUrl, { cache: "no-store" });
    const tokenPayload = (await tokenResponse.json()) as { access_token?: string; token_type?: string; expires_in?: number; error?: { message?: string } };
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload.error?.message || `Meta token exchange failed (${tokenResponse.status}).`);

    const pagesUrl = new URL(`${META_GRAPH_BASE}/me/accounts`);
    pagesUrl.searchParams.set("fields", "name,access_token,tasks,instagram_business_account");
    pagesUrl.searchParams.set("access_token", tokenPayload.access_token);
    const pagesResponse = await fetch(pagesUrl, { cache: "no-store" });
    const pagesPayload = (await pagesResponse.json()) as { data?: Array<{ id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string } }>; error?: { message?: string } };
    if (!pagesResponse.ok) throw new Error(pagesPayload.error?.message || `Meta Page lookup failed (${pagesResponse.status}).`);
    const page = (pagesPayload.data ?? []).find((item) => item.id && item.access_token && item.instagram_business_account?.id);
    if (!page?.id || !page.access_token || !page.instagram_business_account?.id) throw new Error("कोई ऐसा Facebook Page नहीं मिला जो Professional Instagram Account से linked हो।");

    const igUrl = new URL(`${META_GRAPH_BASE}/${page.instagram_business_account.id}`);
    igUrl.searchParams.set("fields", "id,username,name");
    igUrl.searchParams.set("access_token", page.access_token);
    const igResponse = await fetch(igUrl, { cache: "no-store" });
    const igPayload = (await igResponse.json()) as { id?: string; username?: string; error?: { message?: string } };
    if (!igResponse.ok || !igPayload.id) throw new Error(igPayload.error?.message || `Instagram account lookup failed (${igResponse.status}).`);

    const expiresAt = typeof tokenPayload.expires_in === "number" ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString() : null;
    const saveResponse = await fetch(`${supabaseUrl}/rest/v1/instagram_meta_connections?on_conflict=page_id,instagram_user_id`, {
      method: "POST",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ page_id: page.id, page_name: page.name ?? null, instagram_user_id: igPayload.id, instagram_username: igPayload.username ?? null, page_access_token: page.access_token, token_type: tokenPayload.token_type ?? "bearer", expires_at: expiresAt, updated_at: new Date().toISOString() }),
    });
    if (!saveResponse.ok) throw new Error(`Supabase Meta connection save failed (${saveResponse.status}): ${await saveResponse.text()}`);
    return { pageId: page.id, pageName: page.name, instagramUserId: igPayload.id, instagramUsername: igPayload.username };
  });

export const exchangeInstagramCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object" || !("code" in input)) throw new Error("Missing Instagram authorization code");
    const code = (input as { code?: unknown }).code;
    if (typeof code !== "string" || !code.trim()) throw new Error("Invalid Instagram authorization code");
    return { code: code.trim() };
  })
  .handler(async ({ data }): Promise<{ userId: string; username?: string }> => {
    const clientId = getEnv("INSTAGRAM_CLIENT_ID");
    const clientSecret = getEnv("INSTAGRAM_CLIENT_SECRET");
    const redirectUri = getEnv("INSTAGRAM_REDIRECT_URI");
    if (!clientId || !clientSecret || !redirectUri) throw new Error("Instagram OAuth is not configured on the server");
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code: data.code });
    const response = await fetch(INSTAGRAM_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const payload = (await response.json()) as { access_token?: string; error_message?: string; error_type?: string };
    if (!response.ok || !payload.access_token) throw new Error(payload.error_message || `Instagram token exchange failed (${response.status})`);
    return readInstagramProfile(payload.access_token);
  });
