const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const districts = [
  ["Ajmer", 26.4499, 74.6399],
  ["Alwar", 27.5530, 76.6346],
  ["Balotara", 25.8326, 72.2400],
  ["Banswara", 23.5461, 74.4349],
  ["Baran", 25.1011, 76.5132],
  ["Barmer", 25.7532, 71.4181],
  ["Beawar", 26.1007, 74.3191],
  ["Bharatpur", 27.2170, 77.4895],
  ["Bhilwara", 25.3407, 74.6313],
  ["Bikaner", 28.0229, 73.3119],
  ["Bundi", 25.4386, 75.6377],
  ["Chittorgarh", 24.8887, 74.6269],
  ["Churu", 28.2920, 74.9618],
  ["Dausa", 26.8932, 76.3375],
  ["Deeg", 27.4729, 77.3280],
  ["Dholpur", 26.7025, 77.8934],
  ["Didwana-Kuchaman", 27.4020, 74.5750],
  ["Dungarpur", 23.8431, 73.7147],
  ["Hanumangarh", 29.5818, 74.3294],
  ["Jaipur", 26.9124, 75.7873],
  ["Jaisalmer", 26.9157, 70.9083],
  ["Jalore", 25.3456, 72.6204],
  ["Jhalawar", 24.5973, 76.1609],
  ["Jhunjhunu", 28.1289, 75.3997],
  ["Jodhpur", 26.2389, 73.0243],
  ["Karauli", 26.4980, 77.0151],
  ["Khairthal-Tijara", 27.8228, 76.7890],
  ["Kota", 25.2138, 75.8648],
  ["Kotputli-Behror", 27.4274, 76.1350],
  ["Nagaur", 27.1991, 73.7409],
  ["Pali", 25.7711, 73.3234],
  ["Phalodi", 27.1310, 72.3683],
  ["Pratapgarh", 24.0322, 74.7819],
  ["Rajsamand", 25.0715, 73.8798],
  ["Salumbar", 24.1356, 74.8250],
  ["Sawai Madhopur", 26.0378, 76.3522],
  ["Sikar", 27.6094, 75.1399],
  ["Sirohi", 24.8850, 72.8570],
  ["Sri Ganganagar", 29.9038, 73.8772],
  ["Tonk", 26.1664, 75.7882],
  ["Udaipur", 24.5854, 73.7125],
];

function istDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function classify(probability, precipitation) {
  const p = Number.isFinite(probability) ? probability : 0;
  const mm = Number.isFinite(precipitation) ? precipitation : 0;

  if (p >= 70 || mm >= 2) return { status: "high", confidence: 0.85 };
  if (p >= 50 || mm >= 0.5) return { status: "likely", confidence: 0.70 };
  if (p >= 30 || mm >= 0.1) return { status: "possible", confidence: 0.55 };
  return { status: "none", confidence: 0.50 };
}

async function openMeteo() {
  const latitude = districts.map((d) => d[1]).join(",");
  const longitude = districts.map((d) => d[2]).join(",");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("current", "precipitation,rain,showers,weather_code");
  url.searchParams.set("hourly", "precipitation_probability,precipitation,rain");
  url.searchParams.set("forecast_hours", "6");
  url.searchParams.set("timezone", "Asia/Kolkata");
  url.searchParams.set("models", "ecmwf_ifs025");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo ${response.status}: ${await response.text()}`);
  return { url: url.toString(), data: await response.json() };
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  return response;
}

const observationDate = istDate();
const { url: sourceUrl, data } = await openMeteo();
const locations = Array.isArray(data) ? data : [data];

await supabase(`rain_observations?observation_date=eq.${observationDate}&source_type=eq.weather`, {
  method: "DELETE",
});

const rows = [];
for (let i = 0; i < districts.length; i += 1) {
  const district = districts[i];
  const weather = locations[i];
  if (!weather) continue;

  const current = weather.current ?? {};
  const hourly = weather.hourly ?? {};
  const probabilities = hourly.precipitation_probability ?? [];
  const precipitation = hourly.precipitation ?? [];
  const nextProbabilities = probabilities.slice(0, 6).map(Number).filter(Number.isFinite);
  const nextPrecipitation = precipitation.slice(0, 6).map(Number).filter(Number.isFinite);

  const probability = Math.max(0, ...nextProbabilities);
  const forecastMm = Math.max(0, Number(current.precipitation) || 0, ...nextPrecipitation);
  const classification = classify(probability, forecastMm);

  if (classification.status === "none") continue;

  rows.push({
    observation_date: observationDate,
    event_time: current.time ?? new Date().toISOString(),
    place: district[0],
    district: district[0],
    latitude: district[1],
    longitude: district[2],
    rain_observed: false,
    forecast_status: classification.status,
    confidence: classification.confidence,
    source_url: sourceUrl,
    source_type: "weather",
    original_or_repost: "unknown",
    verification_status: "verified",
  });
}

if (rows.length) {
  await supabase("rain_observations", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
}

console.log(JSON.stringify({ observationDate, districts: districts.length, forecastPoints: rows.length }));
