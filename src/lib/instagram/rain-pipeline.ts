export type CandidateDecision = "candidate" | "uncertain" | "rejected";
export interface InstagramCandidateInput {
  source_url: string; external_post_id?: string | null; posted_at?: string | null; event_date?: string | null; event_time?: string | null;
  place?: string | null; district?: string | null; latitude?: number | null; longitude?: number | null;
  caption_text?: string | null; speech_text?: string | null; visual_analysis?: string | null; location_evidence?: string | null;
  original_or_repost?: "original" | "repost" | "unknown";
}
export interface InstagramPipelineResult {
  decision: CandidateDecision; rain_observed: boolean; verification_status: "pending" | "uncertain" | "rejected";
  confidence: number; rejection_reason: string | null; reasons: string[];
}
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RAIN_TERMS = ["rain", "raining", "rainfall", "barish", "baarish", "barsaat", "varsha", "वर्षा", "बारिश", "बरसात", "मूसलाधार", "झमाझम"];
const OLD_EVENT_TERMS = ["old video", "old rain", "purana video", "पुराना वीडियो", "पुरानी बारिश", "throwback", "archive", "पुराना"];
function normalizedText(input: InstagramCandidateInput): string { return [input.caption_text, input.speech_text, input.visual_analysis, input.location_evidence].filter(Boolean).join(" ").toLowerCase(); }
export function isPostedWithin24Hours(postedAt: string | null | undefined, now = new Date()): boolean { if (!postedAt) return false; const t = Date.parse(postedAt); if (!Number.isFinite(t)) return false; const age = now.getTime() - t; return age >= 0 && age <= MAX_AGE_MS; }
export function hasRainEvidence(input: InstagramCandidateInput): boolean { const text = normalizedText(input); if (RAIN_TERMS.some((term) => text.includes(term.toLowerCase()))) return true; const visual = (input.visual_analysis ?? "").toLowerCase(); return visual.includes("rain visible") || visual.includes("visible rain") || visual.includes("rainfall visible") || visual.includes("wet road"); }
export function hasOldEventSignal(input: InstagramCandidateInput): boolean { const text = normalizedText(input); return OLD_EVENT_TERMS.some((term) => text.includes(term)); }
export function isRajasthanCoordinate(latitude: number | null | undefined, longitude: number | null | undefined): boolean { return typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= 23 && latitude <= 30.5 && longitude >= 69 && longitude <= 78.5; }
function isSameCalendarDate(eventDate: string, postedAt: string): boolean { const posted = new Date(postedAt); if (!Number.isFinite(posted.getTime())) return false; const postedIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(posted); return eventDate === postedIst; }
export function runRainEvidencePipeline(input: InstagramCandidateInput, now = new Date()): InstagramPipelineResult {
  const reasons: string[] = [];
  if (!input.source_url) return { decision: "rejected", rain_observed: false, verification_status: "rejected", confidence: 0, rejection_reason: "Missing source URL", reasons };
  if (!isPostedWithin24Hours(input.posted_at, now)) return { decision: "rejected", rain_observed: false, verification_status: "rejected", confidence: 0, rejection_reason: "Reel was not posted within the last 24 hours", reasons };
  reasons.push("posted_within_24h");
  if (hasOldEventSignal(input)) return { decision: "rejected", rain_observed: false, verification_status: "rejected", confidence: 0, rejection_reason: "Content contains an old/archive signal", reasons };
  if (input.event_date && input.posted_at && !isSameCalendarDate(input.event_date, input.posted_at)) return { decision: "uncertain", rain_observed: false, verification_status: "uncertain", confidence: 0.25, rejection_reason: null, reasons: [...reasons, "event_date_differs_from_post_date"] };
  if (!hasRainEvidence(input)) return { decision: "uncertain", rain_observed: false, verification_status: "uncertain", confidence: 0.2, rejection_reason: null, reasons: [...reasons, "no_clear_rain_evidence"] };
  reasons.push("rain_evidence_found");
  const hasLocation = Boolean(input.place || input.district || input.location_evidence) && isRajasthanCoordinate(input.latitude, input.longitude);
  if (!hasLocation) return { decision: "uncertain", rain_observed: false, verification_status: "uncertain", confidence: 0.45, rejection_reason: null, reasons: [...reasons, "location_not_verified_in_rajasthan"] };
  reasons.push("rajasthan_location_verified");
  if (input.original_or_repost === "repost") return { decision: "uncertain", rain_observed: false, verification_status: "uncertain", confidence: 0.5, rejection_reason: null, reasons: [...reasons, "repost_requires_duplicate_review"] };
  const confidence = input.original_or_repost === "original" ? 0.85 : 0.7;
  return { decision: "candidate", rain_observed: true, verification_status: "pending", confidence, rejection_reason: null, reasons };
}
