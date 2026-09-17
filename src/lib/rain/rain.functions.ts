import { createServerFn } from "@tanstack/react-start";

import { MOCK_EVIDENCE, OBSERVATION_DATE } from "./mock-evidence";
import { toPublicPoints } from "./projection";
import type { PublicRainSnapshot } from "./types";

/**
 * Public read for the full-screen map.
 *
 * Swap the MOCK_EVIDENCE source for a Supabase query later:
 *   supabase.from('rain_evidence').select(...).eq('observation_date', date)
 * The projection layer already guarantees nothing internal leaks out.
 */
export const getPublicRainSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicRainSnapshot> => {
    return {
      observation_date: OBSERVATION_DATE,
      updated_at: new Date().toISOString(),
      points: toPublicPoints(MOCK_EVIDENCE),
    };
  },
);
