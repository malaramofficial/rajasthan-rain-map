import { createServerFn } from "@tanstack/react-start";

const INSTAGRAM_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const INSTAGRAM_GRAPH_URL = "https://graph.instagram.com/me";

function getEnv(name: string): string | undefined {
  return process.env[name];
}

export const getInstagramAuthorizeUrl = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ url: string | null; configured: boolean }> => {
    const clientId = getEnv("INSTAGRAM_CLIENT_ID");
    const redirectUri = getEnv("INSTAGRAM_REDIRECT_URI");

    if (!clientId || !redirectUri) {
      return { url: null, configured: false };
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "instagram_business_basic",
    });

    return {
      url: `${INSTAGRAM_AUTHORIZE_URL}?${params.toString()}`,
      configured: true,
    };
  },
);

async function readInstagramProfile(accessToken: string) {
  const url = new URL(INSTAGRAM_GRAPH_URL);
  url.searchParams.set("fields", "id,username");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  const payload = (await response.json()) as {
    id?: string;
    username?: string;
    error?: { message?: string };
  };

  if (!response.ok || !payload.id) {
    throw new Error(
      payload.error?.message || `Instagram API returned ${response.status}.`,
    );
  }

  return { userId: payload.id, username: payload.username };
}

export const verifyConfiguredInstagramToken = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    configured: boolean;
    valid: boolean;
    userId?: string;
    username?: string;
    error?: string;
  }> => {
    const accessToken = getEnv("INSTAGRAM_ACCESS_TOKEN");

    if (!accessToken) {
      return {
        configured: false,
        valid: false,
        error: "INSTAGRAM_ACCESS_TOKEN is not configured.",
      };
    }

    try {
      const profile = await readInstagramProfile(accessToken);
      return { configured: true, valid: true, ...profile };
    } catch (error) {
      return {
        configured: true,
        valid: false,
        error: error instanceof Error ? error.message : "Instagram API request failed.",
      };
    }
  },
);

export const testInstagramMediaAccess = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    configured: boolean;
    valid: boolean;
    mediaEndpoint: "success" | "failed" | "not_tested";
    mediaCount?: number;
    reelsCount?: number;
    latestTimestamp?: string;
    error?: string;
  }> => {
    const accessToken = getEnv("INSTAGRAM_ACCESS_TOKEN");

    if (!accessToken) {
      return {
        configured: false,
        valid: false,
        mediaEndpoint: "not_tested",
        error: "INSTAGRAM_ACCESS_TOKEN is not configured.",
      };
    }

    try {
      await readInstagramProfile(accessToken);

      const url = new URL("https://graph.instagram.com/me/media");
      url.searchParams.set(
        "fields",
        "id,media_type,media_product_type,timestamp,permalink,caption",
      );
      url.searchParams.set("limit", "10");

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });

      const payload = (await response.json()) as {
        data?: Array<{
          media_type?: string;
          timestamp?: string;
        }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(
          payload.error?.message || `Instagram media API returned ${response.status}.`,
        );
      }

      const media = payload.data ?? [];
      const reelsCount = media.filter(
        (item) =>
          item.media_type === "VIDEO" || item.media_product_type === "REELS",
      ).length;

      return {
        configured: true,
        valid: true,
        mediaEndpoint: "success",
        mediaCount: media.length,
        reelsCount,
        latestTimestamp: media[0]?.timestamp,
      };
    } catch (error) {
      return {
        configured: true,
        valid: false,
        mediaEndpoint: "failed",
        error: error instanceof Error ? error.message : "Instagram media API request failed.",
      };
    }
  },
);

export const exchangeInstagramCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object" || !("code" in input)) {
      throw new Error("Missing Instagram authorization code");
    }

    const code = (input as { code?: unknown }).code;
    if (typeof code !== "string" || !code.trim()) {
      throw new Error("Invalid Instagram authorization code");
    }

    return { code: code.trim() };
  })
  .handler(async ({ data }): Promise<{ userId: string; username?: string }> => {
    const clientId = getEnv("INSTAGRAM_CLIENT_ID");
    const clientSecret = getEnv("INSTAGRAM_CLIENT_SECRET");
    const redirectUri = getEnv("INSTAGRAM_REDIRECT_URI");

    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Instagram OAuth is not configured on the server");
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code: data.code,
    });

    const response = await fetch(INSTAGRAM_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const payload = (await response.json()) as {
      access_token?: string;
      error_message?: string;
      error_type?: string;
    };

    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.error_message ||
          `Instagram token exchange failed (${response.status})`,
      );
    }

    // Never send the access token to the browser. Verify it server-side and discard it.
    return readInstagramProfile(payload.access_token);
  });
