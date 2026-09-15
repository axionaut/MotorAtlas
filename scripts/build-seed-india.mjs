// Generates the India seed from Bharat NCAP's published vehicle assessments.
// Run: pnpm run seed  (network required)
import { mkdir, writeFile } from "node:fs/promises";

const API = "https://www.bncap.in/wp-json/wp/v2/vehicle?per_page=100";
const OUT = new URL("../public/seed/india-bncap.json", import.meta.url);

const response = await fetch(API, { signal: AbortSignal.timeout(90000), headers: { "User-Agent": "MotorAtlas seed builder" } });
if (!response.ok) throw new Error(`Bharat NCAP returned HTTP ${response.status}`);
const vehicles = await response.json();
if (!Array.isArray(vehicles) || !vehicles.length) throw new Error("Malformed Bharat NCAP payload");

const clean = (value) => String(value || "").replace(/&#8211;/g, "-").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const text = (html) => clean(String(html || "").replace(/<style[^]*?<\/style>/g, " ").replace(/<script[^]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "));

// Titles are inconsistent: "TATA - NEXON", "CITROEN-BASALT", "TATA ALTROZ",
// "MARUTI SUZUKI - e VITARA". Match the longest known make first, then fall back.
const MAKES = ["MARUTI SUZUKI", "MARUTI", "TATA", "MAHINDRA", "HYUNDAI", "TOYOTA", "HONDA", "NISSAN",
  "RENAULT", "CITROEN", "SKODA", "VOLKSWAGEN", "KIA", "VINFAST", "MG", "JEEP"];

function split(title) {
  const name = clean(title);
  for (const make of MAKES) {
    if (!name.toUpperCase().startsWith(make)) continue;
    const model = name.slice(make.length).replace(/^[\s-–]+/, "").trim();
    if (model) return { make, model };
  }
  const parts = name.split(/\s*[-–]\s*/);
  if (parts.length >= 2) return { make: parts[0], model: parts.slice(1).join(" - ") };
  const words = name.split(" ");
  return { make: words[0], model: words.slice(1).join(" ") || words[0] };
}

// Bharat NCAP writes names in caps; the corpus matches on a normalised slug, so case only
// affects display. "MARUTI" and "MARUTI SUZUKI" are the same manufacturer.
const ALIASES = { MARUTI: "Maruti Suzuki", "MARUTI SUZUKI": "Maruti Suzuki", CITROEN: "Citroën" };
const titleCase = (value) => value.toLowerCase().replace(/\b([a-z])/g, (_, letter) => letter.toUpperCase())
  .replace(/\bEv\b/g, "EV").replace(/\bSuv\b/g, "SUV");
const displayMake = (make) => ALIASES[make.toUpperCase()] || titleCase(make);
const records = [];
for (const vehicle of vehicles) {
  const body = text(vehicle.content?.rendered);
  const { make, model } = split(vehicle.title?.rendered);
  const adult = body.match(/([\d.]+)\s*\/\s*([\d.]+)\s*Adult/i);
  const child = body.match(/([\d.]+)\s*\/\s*([\d.]+)\s*Child/i);
  const year = body.match(/Year of Publication\s*(\d{4})/i);
  const bodyType = body.match(/Body Type\s*(.+?)\s*Crash Test/i);
  const weight = body.match(/Crash Test Weight \(kg\)\s*([\d.]+)\s*kg/i);
  const variant = body.match(/Tested Vehicle Model (?:&amp;|&)? ?Variant\s*(.+?)\s*Body Type/i);
  if (!make || !model || !adult || !year) continue;
  records.push({
    make: displayMake(make), model: titleCase(model), variant: variant ? clean(variant[1]) : null,
    body: bodyType ? clean(bodyType[1]) : null,
    year: Number(year[1]),
    adult: Number(adult[1]), adultMax: Number(adult[2]),
    child: child ? Number(child[1]) : null, childMax: child ? Number(child[2]) : null,
    weightKg: weight ? Number(weight[1]) : null,
    url: vehicle.link,
  });
}
if (!records.length) throw new Error("Bharat NCAP page structure changed: no assessments parsed.");
records.sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.year - b.year);

await mkdir(new URL("./", OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({
  format: "motoratlas-seed", version: 1, source: "bharat-ncap", market: "IN",
  generatedAt: new Date().toISOString(), records,
}));
console.error(`wrote ${records.length} Bharat NCAP assessments (${new Set(records.map((r) => r.make)).size} makes)`);
