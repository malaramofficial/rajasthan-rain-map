export interface ExtractedRajasthanLocation {
  place: string | null;
  district: string | null;
  evidence: string | null;
  confidence: number;
}

// Deliberately conservative: a place name is a clue, not proof of the exact coordinates.
// Coordinates are only assigned when the clue matches this fixed district-centre map.
const DISTRICTS: Record<string, { district: string; latitude: number; longitude: number; aliases: string[] }> = {
  ajmer: { district: "Ajmer", latitude: 26.4499, longitude: 74.6399, aliases: ["ajmer", "अजमेर"] },
  alwar: { district: "Alwar", latitude: 27.55299, longitude: 76.63457, aliases: ["alwar", "अलवर"] },
  banswara: { district: "Banswara", latitude: 23.5461, longitude: 74.4338, aliases: ["banswara", "बांसवाड़ा", "बांसवाड़ा"] },
  baran: { district: "Baran", latitude: 25.1011, longitude: 76.5132, aliases: ["baran", "बारां"] },
  barmer: { district: "Barmer", latitude: 25.7536, longitude: 71.3895, aliases: ["barmer", "बाड़मेर", "बाड़मेर"] },
  bharatpur: { district: "Bharatpur", latitude: 27.2152, longitude: 77.5030, aliases: ["bharatpur", "भरतपुर"] },
  bhilwara: { district: "Bhilwara", latitude: 25.3407, longitude: 74.6313, aliases: ["bhilwara", "भीलवाड़ा", "भीलवाड़ा"] },
  bikaner: { district: "Bikaner", latitude: 28.0229, longitude: 73.3119, aliases: ["bikaner", "बीकानेर"] },
  bundi: { district: "Bundi", latitude: 25.4305, longitude: 75.6499, aliases: ["bundi", "बूंदी"] },
  chittorgarh: { district: "Chittorgarh", latitude: 24.8887, longitude: 74.6269, aliases: ["chittorgarh", "चित्तौड़गढ़", "चित्तोडगढ़", "चित्तौड़"] },
  churu: { district: "Churu", latitude: 28.2920, longitude: 74.9618, aliases: ["churu", "चूरू"] },
  dausa: { district: "Dausa", latitude: 26.8932, longitude: 76.3375, aliases: ["dausa", "दौसा"] },
  dholpur: { district: "Dholpur", latitude: 26.7025, longitude: 77.8934, aliases: ["dholpur", "धौलपुर"] },
  dungarpur: { district: "Dungarpur", latitude: 23.8431, longitude: 73.7147, aliases: ["dungarpur", "डूंगरपुर"] },
  hanumangarh: { district: "Hanumangarh", latitude: 29.5815, longitude: 74.3294, aliases: ["hanumangarh", "हनुमानगढ़", "हनुमानगढ़"] },
  jaipur: { district: "Jaipur", latitude: 26.9124, longitude: 75.7873, aliases: ["jaipur", "जयपुर"] },
  jaisalmer: { district: "Jaisalmer", latitude: 26.9157, longitude: 70.9083, aliases: ["jaisalmer", "जैसलमेर"] },
  jalore: { district: "Jalore", latitude: 25.3456, longitude: 72.6269, aliases: ["jalore", "जालौर", "जालोर"] },
  jhalawar: { district: "Jhalawar", latitude: 24.5973, longitude: 76.1609, aliases: ["jhalawar", "झालावाड़", "झालावाड़"] },
  jhunjhunu: { district: "Jhunjhunu", latitude: 28.1289, longitude: 75.3997, aliases: ["jhunjhunu", "झुंझुनूं", "झुंझुनू"] },
  jodhpur: { district: "Jodhpur", latitude: 26.2389, longitude: 73.0243, aliases: ["jodhpur", "जोधपुर"] },
  karauli: { district: "Karauli", latitude: 26.4970, longitude: 77.0152, aliases: ["karauli", "करौली"] },
  kota: { district: "Kota", latitude: 25.2138, longitude: 75.8648, aliases: ["kota", "कोटा"] },
  nagaur: { district: "Nagaur", latitude: 27.2020, longitude: 73.7339, aliases: ["nagaur", "नागौर"] },
  pali: { district: "Pali", latitude: 25.7711, longitude: 73.3234, aliases: ["pali", "पाली"] },
  pratapgarh: { district: "Pratapgarh", latitude: 24.0311, longitude: 74.7813, aliases: ["pratapgarh", "प्रतापगढ़", "प्रतापगढ़"] },
  rajsamand: { district: "Rajsamand", latitude: 25.0715, longitude: 73.8798, aliases: ["rajsamand", "राजसमंद"] },
  sawai_madhopur: { district: "Sawai Madhopur", latitude: 26.0378, longitude: 76.3381, aliases: ["sawai madhopur", "sawai", "सवाई माधोपुर"] },
  sri_ganganagar: { district: "Sri Ganganagar", latitude: 29.9038, longitude: 73.8772, aliases: ["sri ganganagar", "ganganagar", "श्रीगंगानगर", "गंगानगर"] },
  sikar: { district: "Sikar", latitude: 27.6094, longitude: 75.1399, aliases: ["sikar", "सीकर"] },
  sirohi: { district: "Sirohi", latitude: 24.8850, longitude: 72.8580, aliases: ["sirohi", "सिरोही"] },
  tonk: { district: "Tonk", latitude: 26.1664, longitude: 75.7885, aliases: ["tonk", "टोंक"] },
  udaipur: { district: "Udaipur", latitude: 24.5854, longitude: 73.7125, aliases: ["udaipur", "उदयपुर"] },
};

function cleanText(input: string): string {
  return input.toLowerCase().replace(/[|,.;:!?()[\]{}]/g, " ").replace(/\s+/g, " ").trim();
}

export function extractRajasthanLocation(input: {
  caption_text?: string | null;
  speech_text?: string | null;
  location_evidence?: string | null;
}): ExtractedRajasthanLocation {
  const parts = [input.location_evidence, input.caption_text, input.speech_text].filter(Boolean) as string[];
  const text = cleanText(parts.join(" "));

  for (const entry of Object.values(DISTRICTS)) {
    for (const alias of entry.aliases) {
      const normalizedAlias = cleanText(alias);
      if (!text.includes(normalizedAlias)) continue;

      return {
        place: entry.district,
        district: entry.district,
        evidence: `Text/location clue matched: ${alias}`,
        confidence: 0.7,
      };
    }
  }

  return { place: null, district: null, evidence: null, confidence: 0 };
}

export function districtCoordinates(district: string | null | undefined): { latitude: number; longitude: number } | null {
  if (!district) return null;
  const normalized = cleanText(district);
  const entry = Object.values(DISTRICTS).find((item) => item.district.toLowerCase() === normalized);
  return entry ? { latitude: entry.latitude, longitude: entry.longitude } : null;
}
