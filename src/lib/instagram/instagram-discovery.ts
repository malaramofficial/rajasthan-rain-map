export type DiscoveredInstagramMedia = {
  id: string;
  media_type?: string | null;
  media_product_type?: string | null;
  timestamp?: string | null;
  permalink?: string | null;
  caption?: string | null;
  media_url?: string | null;
  thumbnail_url?: string | null;
  discovery_hashtag?: string | null;
};

const GRAPH_VERSION = process.env["META_GRAPH_VERSION"] ?? "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const RAIN_HASHTAGS = [
  "rajasthanbarish", "rajasthanrain", "राजस्थानबारिश", "राजस्थानबरसात",
  "barishrajasthan", "monsoonrajasthan", "jaipurbarish", "jodhpurbarish",
  "udaipurbarish", "kotabarish", "bikanerbarish", "barmerbarish",
];

async function graphGet(path: string, token: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(`Meta Graph ${response.status}: ${body?.error?.message ?? JSON.stringify(body)}`);
  return body;
}

const MAX_PAGES_PER_HASHTAG = 3;
const MAX_MEDIA_PER_HASHTAG = 150;

function isReelMedia(item: DiscoveredInstagramMedia): boolean {
  return item.media_product_type === "REELS" || item.media_type === "VIDEO";
}

function isOlderThanCutoff(timestamp: string | null | undefined, cutoffMs: number): boolean {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed < cutoffMs;
}

export function getRainHashtags(): string[] { return [...RAIN_HASHTAGS]; }

export async function discoverHashtagMedia(token: string, igUserId: string, hashtags = RAIN_HASHTAGS): Promise<DiscoveredInstagramMedia[]> {
  const result: DiscoveredInstagramMedia[] = [];
  const seen = new Set<string>();
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;

  for (const hashtag of hashtags) {
    const search = await graphGet("ig_hashtag_search", token, { user_id: igUserId, q: hashtag });
    const hashtagId = search?.data?.[0]?.id;
    if (!hashtagId) continue;

    let nextUrl: string | null = null;
    let pageCount = 0;
    let collectedForHashtag = 0;

    do {
      const media = nextUrl
        ? await graphGet(nextUrl.replace(`${GRAPH_BASE}/`, ""), token, {})
        : await graphGet(`${hashtagId}/recent_media`, token, {
            user_id: igUserId,
            fields: "id,caption,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url",
            limit: "50",
          });

      const items = Array.isArray(media?.data) ? media.data : [];
      let reachedOlderContent = false;

      for (const item of items) {
        if (!item?.id) continue;
        if (isOlderThanCutoff(item.timestamp, cutoffMs)) {
          reachedOlderContent = true;
          continue;
        }
        if (!isReelMedia(item) || seen.has(item.id)) continue;

        seen.add(item.id);
        result.push({
          id: String(item.id),
          caption: item.caption ?? null,
          media_type: item.media_type ?? null,
          media_product_type: item.media_product_type ?? null,
          permalink: item.permalink ?? null,
          timestamp: item.timestamp ?? null,
          media_url: item.media_url ?? null,
          thumbnail_url: item.thumbnail_url ?? null,
          discovery_hashtag: hashtag,
        });
        collectedForHashtag++;
        if (collectedForHashtag >= MAX_MEDIA_PER_HASHTAG) break;
      }

      pageCount++;
      const pagingNext = typeof media?.paging?.next === "string" ? media.paging.next : null;
      nextUrl = !reachedOlderContent && pageCount < MAX_PAGES_PER_HASHTAG && collectedForHashtag < MAX_MEDIA_PER_HASHTAG
        ? pagingNext
        : null;
    } while (nextUrl);
  }

  return result;
}xport type DiscoveredInstagramMedia = {
  id: string;
  media_type?: string | null;
  media_product_type?: string | null;
  timestamp?: string | null;
  permalink?: string | null;
  caption?: string | null;
  media_url?: string | null;
  thumbnail_url?: string | null;
  discovery_hashtag?: string | null;
};

const GRAPH_VERSION = process.env["META_GRAPH_VERSION"] ?? "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const RAIN_HASHTAGS = [
  "rajasthanbarish", "rajasthanrain", "राजस्थानबारिश", "राजस्थानबरसात",
  "barishrajasthan", "monsoonrajasthan", "jaipurbarish", "jodhpurbarish",
  "udaipurbarish", "kotabarish", "bikanerbarish", "barmerbarish",
];

async function graphGet(path: string, token: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(`Meta Graph ${response.status}: ${body?.error?.message ?? JSON.stringify(body)}`);
  return body;
}

const MAX_PAGES_PER_HASHTAG = 3;
const MAX_MEDIA_PER_HASHTAG = 150;

function isReelMedia(item: DiscoveredInstagramMedia): boolean {
  return item.media_product_type === "REELS" || item.media_type === "VIDEO";
}

function isOlderThanCutoff(timestamp: string | null | undefined, cutoffMs: number): boolean {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed < cutoffMs;
}

export function getRainHashtags(): string[] { return [...RAIN_HASHTAGS]; }

export async function discoverHashtagMedia(token: string, igUserId: string, hashtags = RAIN_HASHTAGS): Promise<DiscoveredInstagramMedia[]> {
  const result: DiscoveredInstagramMedia[] = [];
  const seen = new Set<string>();
  for (const hashtag of hashtags) {
    const search = await graphGet("ig_hashtag_search", token, { user_id: igUserId, q: hashtag });
    const hashtagId = search?.data?.[0]?.id;
    if (!hashtagId) continue;
    const media = await graphGet(`${hashtagId}/recent_media`, token, {
      user_id: igUserId,
      fields: "id,caption,media_type,media_product_type,permalink,timestamp,media_url,thumbnail_url",
      limit: "50",
    });
    for (const item of media?.data ?? []) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      result.push({
        id: String(item.id), caption: item.caption ?? null,
        media_type: item.media_type ?? null, media_product_type: item.media_product_type ?? null,
        permalink: item.permalink ?? null, timestamp: item.timestamp ?? null,
        media_url: item.media_url ?? null, thumbnail_url: item.thumbnail_url ?? null,
        discovery_hashtag: hashtag,
      });
    }
  }
  return result;
}
