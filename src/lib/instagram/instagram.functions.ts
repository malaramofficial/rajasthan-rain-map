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
      return { configured: false, valid: false, error: "INSTAGRAM_ACCESS_TOKEN is not configured." };
    }

    const url = new URL(INSTAGRAM_GRAPH_URL);
    url.searchParams.set("fields", "id,username");

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: "no-store",
      });

      const payload = (await response.json()) as {
        id?: string;
        username?: string;
        error?: { message?: string };
      };

      if (!response.ok || !payload.id) {
        return {
          configured: true,
          valid: false,
          error: payload.error?.message || `Instagram API returned ${response.status}.`,
        };
      }

      return {
        configured: true,
        valid: true,
        userId: payload.id,
        username: payload.username,
      };
    } catch (error) {
      return {
        configured: true,
        valid: false,
        error: error instanceof Error ? error.message : "Instagram API request failed.",
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
  .handler(async ({ data }): Promise<{ accessToken: string; userId?: string }> => {
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
      user_id?: string;
      error_message?: string;
      error_type?: string;
      code?: number;
    };

    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.error_message ||
          `Instagram token exchange failed (${response.status})`,
      );
    }

    return {
      accessToken: payload.access_token,
      userId: payload.user_id,
    };
  });
