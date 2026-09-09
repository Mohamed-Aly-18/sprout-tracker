import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Flame, Droplets, Plus, Sparkles, Loader2, Trash2, ChevronLeft, ChevronRight,
  Target, TrendingUp, X, UtensilsCrossed, Settings2, Leaf, Sunrise, Share2,
  Scale, Dumbbell, User, SlidersHorizontal, Bike, Activity, Calendar, Pencil,
} from "lucide-react";
import {
  ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, LineChart, Line, BarChart, Bar,
} from "recharts";
import { storage } from "./storage.js";

/* ---------------------------------------------------------------------- */
/*  Date / basic helpers                                                   */
/* ---------------------------------------------------------------------- */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function keyToDate(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(k, n) {
  const d = keyToDate(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
function todayKey() {
  return dateKey(new Date());
}
function timeNow() {
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function formatMl(v) {
  return v >= 1000 ? `${(v / 1000).toString().replace(/\.0$/, "")}L` : `${v}ml`;
}
function clampPct(n) {
  return Math.max(0, Math.min(100, n));
}
function formatDateLabel(key) {
  const d = keyToDate(key);
  return `${DOW_FULL[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function greetingFor(hour) {
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

/* ---------------------------------------------------------------------- */
/*  Day / data model                                                       */
/* ---------------------------------------------------------------------- */

function emptyDay() {
  return { entries: [], water: 0, weight: null, workouts: [] };
}
// Normalizes any previously-saved day shape (older versions had a boolean
// `workout` flag instead of a `workouts` array) into the current shape.
function normalizeDay(day) {
  return {
    entries: Array.isArray(day?.entries) ? day.entries : [],
    water: typeof day?.water === "number" ? day.water : 0,
    weight: typeof day?.weight === "number" ? day.weight : null,
    workouts: Array.isArray(day?.workouts) ? day.workouts : [],
  };
}
function getDay(data, key) {
  return normalizeDay(data.days[key] || emptyDay());
}
function dayTotals(day) {
  return day.entries.reduce(
    (acc, e) => ({
      calories: acc.calories + (e.calories || 0),
      protein: acc.protein + (e.protein || 0),
      carbs: acc.carbs + (e.carbs || 0),
      fat: acc.fat + (e.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}
function weekRows(data, numDays = 7) {
  const keys = [];
  for (let i = numDays - 1; i >= 0; i--) keys.push(addDays(todayKey(), -i));
  return keys.map((k) => {
    const d = keyToDate(k);
    const day = getDay(data, k);
    return { key: k, date: d, totals: dayTotals(day), water: day.water, weight: day.weight, workouts: day.workouts };
  });
}
// Buckets every logged day (from the first day with any activity, up to
// today) into 7-day windows for the Monthly view.
function monthlyBuckets(data) {
  const activeKeys = Object.keys(data.days || {})
    .filter((k) => {
      const d = getDay(data, k);
      return d.entries.length > 0 || d.water > 0 || d.weight != null || d.workouts.length > 0;
    })
    .sort();
  if (activeKeys.length === 0) return [];
  const todayK = todayKey();
  const buckets = [];
  let bucketStart = activeKeys[0];
  while (bucketStart <= todayK) {
    const bucketKeys = [];
    for (let i = 0; i < 7; i++) {
      const k = addDays(bucketStart, i);
      if (k > todayK) break;
      bucketKeys.push(k);
    }
    if (bucketKeys.length === 0) break;
    const rows = bucketKeys.map((k) => {
      const day = getDay(data, k);
      return { key: k, date: keyToDate(k), totals: dayTotals(day), water: day.water, weight: day.weight, workouts: day.workouts };
    });
    const withData = rows.filter((r) => r.totals.calories > 0 || r.water > 0);
    const avg = (fn) => (withData.length ? Math.round(withData.reduce((s, r) => s + fn(r), 0) / withData.length) : 0);
    const weighIns = rows.filter((r) => r.weight != null);
    buckets.push({
      startKey: bucketKeys[0],
      endKey: bucketKeys[bucketKeys.length - 1],
      startDate: keyToDate(bucketKeys[0]),
      endDate: keyToDate(bucketKeys[bucketKeys.length - 1]),
      avgCalories: avg((r) => r.totals.calories),
      avgProtein: avg((r) => r.totals.protein),
      avgCarbs: avg((r) => r.totals.carbs),
      avgFat: avg((r) => r.totals.fat),
      avgWater: avg((r) => r.water),
      startWeight: weighIns.length ? weighIns[0].weight : null,
      endWeight: weighIns.length ? weighIns[weighIns.length - 1].weight : null,
      weightChange: weighIns.length >= 2 ? Math.round((weighIns[weighIns.length - 1].weight - weighIns[0].weight) * 10) / 10 : null,
      workoutDays: rows.filter((r) => r.workouts.length > 0).length,
      workoutSessions: rows.reduce((s, r) => s + r.workouts.length, 0),
    });
    bucketStart = addDays(bucketStart, 7);
  }
  return buckets;
}

/* ---------------------------------------------------------------------- */
/*  Profile / goal-suggestion helpers                                      */
/* ---------------------------------------------------------------------- */

const DEFAULT_PROFILE = {
  calorieGoal: 2100,
  proteinGoal: 130,
  carbGoal: 240,
  fatGoal: 70,
  waterGoal: 2500,
  sex: "female",
  age: 28,
  heightCm: 165,
  weightGoalKg: 60,
  activityLevel: "moderate",
};

const ACTIVITY_LEVELS = [
  { value: "sedentary", label: "Sedentary (little/no exercise)", mult: 1.2 },
  { value: "light", label: "Light (1–3 days/week)", mult: 1.375 },
  { value: "moderate", label: "Moderate (3–5 days/week)", mult: 1.55 },
  { value: "active", label: "Active (6–7 days/week)", mult: 1.725 },
  { value: "very_active", label: "Very active (hard daily training)", mult: 1.9 },
];

function activityMultiplier(level) {
  return ACTIVITY_LEVELS.find((a) => a.value === level)?.mult || 1.55;
}
function latestLoggedWeight(data) {
  const keys = Object.keys(data.days || {}).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const w = data.days[keys[i]]?.weight;
    if (typeof w === "number" && w > 0) return w;
  }
  return null;
}
function suggestGoals({ sex, age, heightCm, weightKg, activityLevel }) {
  if (!weightKg || !heightCm || !age) return null;
  let bmr;
  if (sex === "male") bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  else if (sex === "female") bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
  else bmr = 10 * weightKg + 6.25 * heightCm - 5 * age - 78;
  const tdee = bmr * activityMultiplier(activityLevel);
  const calorieGoal = Math.max(1200, Math.round(tdee / 10) * 10);
  const proteinGoal = Math.round(weightKg * 1.8);
  const fatGoal = Math.round((calorieGoal * 0.25) / 9);
  const carbGoal = Math.max(50, Math.round((calorieGoal - proteinGoal * 4 - fatGoal * 9) / 4));
  const waterGoal = Math.round((weightKg * 33) / 10) * 10;
  return { calorieGoal, proteinGoal, carbGoal, fatGoal, waterGoal };
}

/* ---------------------------------------------------------------------- */
/*  Workout metadata                                                       */
/* ---------------------------------------------------------------------- */

const WORKOUT_TYPES = [
  { value: "weights", label: "Weights", icon: Dumbbell },
  { value: "treadmill", label: "Treadmill", icon: Activity },
  { value: "cycling", label: "Cycling", icon: Bike },
];
function describeWorkout(w) {
  if (w.type === "weights") return `${w.exercise || "Exercise"} — ${w.weight || "?"}kg × ${w.reps || "?"} reps${w.sets ? ` × ${w.sets} sets` : ""}`;
  if (w.type === "treadmill") return `Treadmill — ${w.time || "?"} min${w.incline ? `, ${w.incline}% incline` : ""}${w.pace ? `, ${w.pace}` : ""}`;
  if (w.type === "cycling") return `Cycling — ${w.time || "?"} min${w.laps ? `, ${w.laps} laps` : ""}${w.pace ? `, ${w.pace}` : ""}`;
  return "Workout";
}

/* ---------------------------------------------------------------------- */
/*  Local nutrition database (free, no API call needed for common foods)   */
/* ---------------------------------------------------------------------- */

const FOOD_DB = [
  { names: ["egg", "eggs", "boiled egg", "fried egg", "scrambled egg", "scrambled eggs"], unit: "each", cal: 78, p: 6.3, c: 0.6, f: 5.3 },
  { names: ["rice", "white rice", "cooked rice", "steamed rice"], unit: "g100", cal: 130, p: 2.7, c: 28, f: 0.3 },
  { names: ["brown rice"], unit: "g100", cal: 123, p: 2.6, c: 26, f: 1 },
  { names: ["chicken breast", "chicken", "grilled chicken", "cooked chicken"], unit: "g100", cal: 165, p: 31, c: 0, f: 3.6 },
  { names: ["milk", "whole milk"], unit: "ml100", cal: 61, p: 3.2, c: 4.8, f: 3.3 },
  { names: ["skim milk", "low fat milk"], unit: "ml100", cal: 34, p: 3.4, c: 5, f: 0.1 },
  { names: ["banana", "bananas"], unit: "each", cal: 105, p: 1.3, c: 27, f: 0.4 },
  { names: ["apple", "apples"], unit: "each", cal: 95, p: 0.5, c: 25, f: 0.3 },
  { names: ["bread", "white bread", "slice of bread", "toast"], unit: "each", cal: 79, p: 2.7, c: 15, f: 1 },
  { names: ["oats", "oatmeal", "rolled oats"], unit: "g100", cal: 389, p: 16.9, c: 66, f: 6.9 },
  { names: ["salmon", "grilled salmon", "cooked salmon"], unit: "g100", cal: 208, p: 20, c: 0, f: 13 },
  { names: ["broccoli"], unit: "g100", cal: 34, p: 2.8, c: 7, f: 0.4 },
  { names: ["potato", "potatoes", "baked potato", "boiled potato"], unit: "g100", cal: 87, p: 1.9, c: 20, f: 0.1 },
  { names: ["sweet potato"], unit: "g100", cal: 86, p: 1.6, c: 20, f: 0.1 },
  { names: ["pasta", "cooked pasta", "spaghetti"], unit: "g100", cal: 158, p: 5.8, c: 31, f: 0.9 },
  { names: ["yogurt", "plain yogurt"], unit: "g100", cal: 61, p: 3.5, c: 4.7, f: 3.3 },
  { names: ["greek yogurt", "nonfat greek yogurt"], unit: "g100", cal: 59, p: 10, c: 3.6, f: 0.4 },
  { names: ["cheese", "cheddar cheese", "cheddar"], unit: "g100", cal: 402, p: 25, c: 1.3, f: 33 },
  { names: ["almonds"], unit: "g100", cal: 579, p: 21, c: 22, f: 50 },
  { names: ["peanut butter"], unit: "g100", cal: 588, p: 25, c: 20, f: 50 },
  { names: ["olive oil"], unit: "ml100", cal: 884, p: 0, c: 0, f: 100 },
  { names: ["avocado", "avocados"], unit: "each", cal: 240, p: 3, c: 13, f: 22 },
  { names: ["orange", "oranges"], unit: "each", cal: 62, p: 1.2, c: 15, f: 0.2 },
  { names: ["tomato", "tomatoes"], unit: "each", cal: 22, p: 1.1, c: 4.8, f: 0.2 },
  { names: ["spinach"], unit: "g100", cal: 23, p: 2.9, c: 3.6, f: 0.4 },
  { names: ["tuna", "canned tuna"], unit: "g100", cal: 132, p: 28, c: 0, f: 1.3 },
  { names: ["beef", "ground beef", "lean beef"], unit: "g100", cal: 250, p: 26, c: 0, f: 17 },
  { names: ["black coffee", "coffee"], unit: "each", cal: 2, p: 0.3, c: 0, f: 0 },
  { names: ["butter"], unit: "g100", cal: 717, p: 0.9, c: 0.1, f: 81 },
  { names: ["honey"], unit: "g100", cal: 304, p: 0.3, c: 82, f: 0 },
];
const UNIT_TO_GRAMS = { cup: 240, tbsp: 15, tablespoon: 15, tsp: 5, teaspoon: 5, oz: 28, ounce: 28, slice: 30 };

function normName(s) {
  return s.toLowerCase().trim().replace(/[.,!]/g, "");
}
function splitFoodSegments(text) {
  return text.split(/,| and |;|\n/i).map((s) => s.trim()).filter(Boolean);
}
function parseSegmentQuantity(segment) {
  const m = segment.match(/^(\d+(?:\.\d+)?)\s*(g|grams?|ml|milliliters?|cups?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|slices?)?\s*(?:of\s+)?(.*)$/i);
  if (m) return { qty: parseFloat(m[1]), unit: (m[2] || "").toLowerCase(), rest: m[3].trim() };
  return { qty: null, unit: null, rest: segment.trim() };
}
function toGrams(qty, unit) {
  if (!unit) return qty;
  const u = unit.replace(/s$/, "");
  if (u === "g" || u === "gram" || u === "ml" || u === "milliliter") return qty;
  if (UNIT_TO_GRAMS[u]) return qty * UNIT_TO_GRAMS[u];
  return qty;
}
function matchFoodDB(segment) {
  const { qty, unit, rest } = parseSegmentQuantity(segment);
  const name = normName(rest || segment);
  if (!name) return null;

  // Prefer an exact alias match over a partial/substring one, and among
  // partial matches prefer the longest alias — otherwise "skim milk" or
  // "brown rice" would silently resolve to the generic "milk"/"rice" entry
  // just because that shorter entry happens to come first in the list.
  let exactEntry = null;
  let bestPartial = null;
  for (const entry of FOOD_DB) {
    for (const n of entry.names) {
      if (name === n) { exactEntry = entry; break; }
      if ((name.includes(n) || n.includes(name)) && (!bestPartial || n.length > bestPartial.alias.length)) {
        bestPartial = { entry, alias: n };
      }
    }
    if (exactEntry) break;
  }
  const entry = exactEntry || bestPartial?.entry;
  if (!entry) return null;
  let multiplier;
  if (entry.unit === "each") {
    multiplier = qty != null ? qty : 1;
  } else {
    const grams = qty != null ? toGrams(qty, unit) : 100;
    multiplier = grams / 100;
  }
  const label = entry.names[0];
  return {
    name: label.charAt(0).toUpperCase() + label.slice(1),
    calories: Math.max(0, Math.round(entry.cal * multiplier)),
    protein: Math.max(0, Math.round(entry.p * multiplier * 10) / 10),
    carbs: Math.max(0, Math.round(entry.c * multiplier * 10) / 10),
    fat: Math.max(0, Math.round(entry.f * multiplier * 10) / 10),
  };
}

/* ---------------------------------------------------------------------- */
/*  Anthropic API call (nutrition-estimation fallback only)                */
/* ---------------------------------------------------------------------- */

async function callClaude(system, userText, maxTokens = 800) {
  // Calls our own backend (api/claude.js) rather than Anthropic directly —
  // that's what keeps your API key off the device and out of the browser.
  let res;
  try {
    res = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, userText, maxTokens }),
    });
  } catch (e) {
    throw new Error("couldn't reach the server — check your internet connection.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `server returned status ${res.status}`);
  }
  return (json.text || "").trim();
}

// Local DB first (free, instant); Claude is only called as a fallback for
// whatever it couldn't recognize, and only for that leftover text.
async function estimateNutrition(text) {
  const segments = splitFoodSegments(text);
  const matched = [];
  const unmatched = [];
  segments.forEach((seg) => {
    const hit = matchFoodDB(seg);
    if (hit) matched.push(hit);
    else unmatched.push(seg);
  });
  if (unmatched.length === 0) return matched;

  const system =
    "You are a careful nutrition-estimation engine inside a food-logging app. " +
    "Given a free-text description of food or drink someone ate, respond with ONLY raw JSON " +
    "(no markdown fences, no prose, no explanation) in exactly this shape: " +
    '{"items":[{"name":"string","calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}]}. ' +
    "Split the description into distinct food items when reasonable. Use typical nutrition data and " +
    "any stated or implied portion sizes to give sensible estimates. Numbers only, no units inside numbers. " +
    "If the text isn't food at all, return {\"items\":[]}.";
  const textForApi = matched.length > 0 ? unmatched.join(", ") : text;
  const raw = await callClaude(system, textForApi, 800);
  const clean = raw.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    throw new Error("the response wasn't valid JSON — try rephrasing what you ate.");
  }
  if (!parsed.items) throw new Error("unexpected response shape from the model.");
  const apiItems = parsed.items.map((it) => ({
    name: String(it.name || "Item").slice(0, 80),
    calories: Math.max(0, Math.round(Number(it.calories) || 0)),
    protein: Math.max(0, Math.round(Number(it.protein_g) || 0)),
    carbs: Math.max(0, Math.round(Number(it.carbs_g) || 0)),
    fat: Math.max(0, Math.round(Number(it.fat_g) || 0)),
  }));
  return [...matched, ...apiItems];
}

/* ---------------------------------------------------------------------- */
/*  Shareable image rendering (native canvas, no libraries required)       */
/* ---------------------------------------------------------------------- */

const IMG = { bg: "#F4F6EE", surface: "#FFFFFF", ink: "#202B22", inkSoft: "#5B6B5A", border: "#E1E4D8", gold: "#D9A441", clay: "#B5533C", plum: "#8B6F9E", water: "#3E7CB1", good: "#4C8B5B" };

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function renderShareCard({ title, subtitle, rows = [], bars = [], listTitle, listLines = [] }) {
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (e) {}
  }
  const W = 1080;
  const H = 340 + rows.length * 46 + bars.length * 96 + (listLines.length ? 76 + Math.min(listLines.length, 10) * 40 : 0) + 90;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = IMG.bg;
  ctx.fillRect(0, 0, W, H);

  // header mark
  ctx.save();
  roundRect(ctx, 64, 56, 56, 56, 16);
  ctx.fillStyle = IMG.ink;
  ctx.fill();
  ctx.save();
  ctx.translate(92, 84);
  ctx.rotate(Math.PI / 4);
  ctx.beginPath();
  ctx.ellipse(0, 0, 17, 10, 0, 0, Math.PI * 2);
  ctx.fillStyle = IMG.gold;
  ctx.fill();
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = IMG.ink;
  ctx.font = "700 30px Fraunces, serif";
  ctx.fillText("Sprout", 138, 96);

  ctx.fillStyle = IMG.inkSoft;
  ctx.font = "600 20px Manrope, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(subtitle, W - 64, 96);
  ctx.textAlign = "left";

  ctx.fillStyle = IMG.ink;
  ctx.font = "700 44px Fraunces, serif";
  ctx.fillText(title, 64, 190);

  let y = 250;
  rows.forEach((r) => {
    ctx.font = "600 24px Manrope, sans-serif";
    ctx.fillStyle = IMG.inkSoft;
    ctx.fillText(r.label, 64, y);
    ctx.fillStyle = IMG.ink;
    ctx.font = "700 24px Manrope, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(r.value, W - 64, y);
    ctx.textAlign = "left";
    y += 46;
  });

  y += 20;
  bars.forEach((b) => {
    ctx.font = "700 24px Manrope, sans-serif";
    ctx.fillStyle = IMG.ink;
    ctx.fillText(b.label, 64, y);
    ctx.font = "600 20px Manrope, sans-serif";
    ctx.fillStyle = IMG.inkSoft;
    ctx.textAlign = "right";
    ctx.fillText(b.valueText, W - 64, y);
    ctx.textAlign = "left";
    y += 20;
    roundRect(ctx, 64, y, W - 128, 20, 10);
    ctx.fillStyle = "#EEF1E6";
    ctx.fill();
    const pctW = Math.max(6, ((W - 128) * Math.min(100, b.pct)) / 100);
    roundRect(ctx, 64, y, pctW, 20, 10);
    ctx.fillStyle = b.color;
    ctx.fill();
    y += 56;
  });

  if (listLines.length) {
    y += 10;
    ctx.font = "700 24px Manrope, sans-serif";
    ctx.fillStyle = IMG.ink;
    ctx.fillText(listTitle || "Details", 64, y);
    listLines.slice(0, 10).forEach((line) => {
      y += 40;
      ctx.font = "500 20px Manrope, sans-serif";
      ctx.fillStyle = IMG.inkSoft;
      ctx.fillText(line, 64, y);
    });
    if (listLines.length > 10) {
      y += 40;
      ctx.font = "500 20px Manrope, sans-serif";
      ctx.fillStyle = IMG.inkSoft;
      ctx.fillText(`+ ${listLines.length - 10} more`, 64, y);
    }
  }

  ctx.font = "500 18px Manrope, sans-serif";
  ctx.fillStyle = IMG.inkSoft;
  ctx.fillText("Shared from Sprout", 64, H - 40);

  return canvas;
}

async function shareCardImage(canvas, filename, title) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
  if (!blob) throw new Error("Couldn't render the image.");
  try {
    const file = new File([blob], `${filename}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "cancelled";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}

function dailyShareData(key, day, totals, profile) {
  return {
    title: "Daily Summary",
    subtitle: formatDateLabel(key),
    rows: [
      { label: "Weight", value: day.weight != null ? `${day.weight} kg` : "Not logged" },
      { label: "Workout", value: day.workouts.length ? `${day.workouts.length} logged` : "None logged" },
    ],
    bars: [
      { label: "Calories", valueText: `${totals.calories} / ${profile.calorieGoal} kcal`, pct: clampPct(profile.calorieGoal ? (totals.calories / profile.calorieGoal) * 100 : 0), color: IMG.gold },
      { label: "Protein", valueText: `${totals.protein} / ${profile.proteinGoal} g`, pct: clampPct(profile.proteinGoal ? (totals.protein / profile.proteinGoal) * 100 : 0), color: IMG.clay },
      { label: "Carbs", valueText: `${totals.carbs} / ${profile.carbGoal} g`, pct: clampPct(profile.carbGoal ? (totals.carbs / profile.carbGoal) * 100 : 0), color: IMG.gold },
      { label: "Fat", valueText: `${totals.fat} / ${profile.fatGoal} g`, pct: clampPct(profile.fatGoal ? (totals.fat / profile.fatGoal) * 100 : 0), color: IMG.plum },
      { label: "Water", valueText: `${day.water} / ${profile.waterGoal} ml`, pct: clampPct(profile.waterGoal ? (day.water / profile.waterGoal) * 100 : 0), color: IMG.water },
    ],
    listTitle: "Meals logged",
    listLines: day.entries.map((e) => `${e.time}  ${e.name} — ${e.calories} kcal`),
  };
}
function weeklyShareData(data, rows, streak) {
  const daysWithData = rows.filter((r) => r.totals.calories > 0 || r.water > 0);
  const avg = (fn) => (daysWithData.length ? Math.round(daysWithData.reduce((s, r) => s + fn(r), 0) / daysWithData.length) : 0);
  const avgCalories = avg((r) => r.totals.calories);
  const avgProtein = avg((r) => r.totals.protein);
  const avgCarbs = avg((r) => r.totals.carbs);
  const avgFat = avg((r) => r.totals.fat);
  const avgWater = avg((r) => r.water);
  const weighIns = rows.filter((r) => r.weight != null);
  const weightChange = weighIns.length >= 2 ? Math.round((weighIns[weighIns.length - 1].weight - weighIns[0].weight) * 10) / 10 : null;
  return {
    title: "Weekly Summary",
    subtitle: `${MONTHS[rows[0].date.getMonth()]} ${rows[0].date.getDate()} – ${MONTHS[rows[6].date.getMonth()]} ${rows[6].date.getDate()}`,
    rows: [
      { label: "Weight change", value: weightChange != null ? `${weightChange > 0 ? "+" : ""}${weightChange} kg` : "Not enough data" },
      { label: "Streak", value: `${streak} days` },
    ],
    bars: [
      { label: "Avg calories", valueText: `${avgCalories} / ${data.profile.calorieGoal} kcal`, pct: clampPct(data.profile.calorieGoal ? (avgCalories / data.profile.calorieGoal) * 100 : 0), color: IMG.gold },
      { label: "Avg protein", valueText: `${avgProtein} / ${data.profile.proteinGoal} g`, pct: clampPct(data.profile.proteinGoal ? (avgProtein / data.profile.proteinGoal) * 100 : 0), color: IMG.clay },
      { label: "Avg carbs", valueText: `${avgCarbs} / ${data.profile.carbGoal} g`, pct: clampPct(data.profile.carbGoal ? (avgCarbs / data.profile.carbGoal) * 100 : 0), color: IMG.gold },
      { label: "Avg fat", valueText: `${avgFat} / ${data.profile.fatGoal} g`, pct: clampPct(data.profile.fatGoal ? (avgFat / data.profile.fatGoal) * 100 : 0), color: IMG.plum },
      { label: "Avg water", valueText: `${avgWater} / ${data.profile.waterGoal} ml`, pct: clampPct(data.profile.waterGoal ? (avgWater / data.profile.waterGoal) * 100 : 0), color: IMG.water },
    ],
    listTitle: "Day by day",
    listLines: rows.map((r) => `${DOW[r.date.getDay()]} ${MONTHS[r.date.getMonth()]} ${r.date.getDate()}: ${r.totals.calories} kcal${r.weight != null ? `, ${r.weight}kg` : ""}`),
  };
}
function monthlyShareData(data, buckets) {
  const avgOf = (fn) => Math.round(buckets.reduce((s, b) => s + fn(b), 0) / buckets.length);
  const weighInBuckets = buckets.filter((b) => b.weightChange != null);
  const totalWeightChange = weighInBuckets.length ? Math.round(weighInBuckets.reduce((s, b) => s + b.weightChange, 0) * 10) / 10 : null;
  const first = buckets[0], last = buckets[buckets.length - 1];
  return {
    title: "Monthly Summary",
    subtitle: `${MONTHS[first.startDate.getMonth()]} ${first.startDate.getDate()} – ${MONTHS[last.endDate.getMonth()]} ${last.endDate.getDate()}`,
    rows: [
      { label: "Weight change", value: totalWeightChange != null ? `${totalWeightChange > 0 ? "+" : ""}${totalWeightChange} kg` : "Not enough data" },
      { label: "Weeks tracked", value: `${buckets.length}` },
    ],
    bars: [
      { label: "Avg calories", valueText: `${avgOf((b) => b.avgCalories)} / ${data.profile.calorieGoal} kcal`, pct: clampPct(data.profile.calorieGoal ? (avgOf((b) => b.avgCalories) / data.profile.calorieGoal) * 100 : 0), color: IMG.gold },
      { label: "Avg protein", valueText: `${avgOf((b) => b.avgProtein)} / ${data.profile.proteinGoal} g`, pct: clampPct(data.profile.proteinGoal ? (avgOf((b) => b.avgProtein) / data.profile.proteinGoal) * 100 : 0), color: IMG.clay },
      { label: "Avg water", valueText: `${avgOf((b) => b.avgWater)} / ${data.profile.waterGoal} ml`, pct: clampPct(data.profile.waterGoal ? (avgOf((b) => b.avgWater) / data.profile.waterGoal) * 100 : 0), color: IMG.water },
    ],
    listTitle: "Week by week",
    listLines: buckets.map((b, i) => `Week ${i + 1} (${MONTHS[b.startDate.getMonth()]} ${b.startDate.getDate()}–${MONTHS[b.endDate.getMonth()]} ${b.endDate.getDate()}): ${b.avgCalories} kcal avg${b.endWeight != null ? `, ${b.endWeight}kg` : ""}`),
  };
}

/* ---------------------------------------------------------------------- */
/*  Small hooks                                                            */
/* ---------------------------------------------------------------------- */

function useCountUp(target, duration = 650) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  useEffect(() => {
    const start = prevRef.current;
    const startTime = performance.now();
    let raf;
    function tick(now) {
      const p = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + (target - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else prevRef.current = target;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return display;
}

/* ---------------------------------------------------------------------- */
/*  Visual atoms                                                           */
/* ---------------------------------------------------------------------- */

function CalorieRing({ consumed, goal }) {
  const pct = clampPct(goal > 0 ? (consumed / goal) * 100 : 0);
  const over = consumed > goal;
  const r = 78;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const shown = useCountUp(consumed);
  const remaining = goal - consumed;
  return (
    <div className="ring-wrap">
      <svg viewBox="0 0 180 180" className="ring-svg">
        <circle cx="90" cy="90" r={r} className="ring-track" />
        <circle cx="90" cy="90" r={r} className="ring-progress" style={{ strokeDasharray: c, strokeDashoffset: offset, stroke: over ? "var(--clay)" : "var(--gold)" }} />
      </svg>
      <div className="ring-center">
        <span className="ring-number">{shown.toLocaleString()}</span>
        <span className="ring-label">kcal eaten</span>
        <span className="ring-sub" style={{ color: over ? "var(--clay)" : "var(--ink-soft)" }}>
          {over ? `${Math.abs(remaining).toLocaleString()} over goal` : `${remaining.toLocaleString()} left of ${goal.toLocaleString()}`}
        </span>
      </div>
    </div>
  );
}
function MacroBar({ label, consumed, goal, color, unit = "g" }) {
  const pct = clampPct(goal > 0 ? (consumed / goal) * 100 : 0);
  return (
    <div className="macro-row">
      <div className="macro-row-top">
        <span className="macro-label">{label}</span>
        <span className="macro-value">{Math.round(consumed)}<span className="macro-unit">/{Math.round(goal)}{unit}</span></span>
      </div>
      <div className="macro-track"><div className="macro-fill" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

const WATER_PRESETS = [500, 1000, 2000, 4000];

function WaterWidget({ ml, goal, onQuickAdd, onCustomAdd }) {
  const pct = clampPct(goal > 0 ? (ml / goal) * 100 : 0);
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState("");
  return (
    <div className="water-card">
      <div className="water-visual">
        <div className="jar"><div className="jar-fill" style={{ height: `${pct}%` }}><div className="jar-wave" /></div></div>
        <div className="water-readout">
          <Droplets size={16} className="water-icon" />
          <div>
            <div className="water-ml">{ml.toLocaleString()} <span className="water-unit">ml</span></div>
            <div className="water-goal">of {goal.toLocaleString()} ml goal</div>
          </div>
        </div>
      </div>
      <div className="water-actions">
        {WATER_PRESETS.map((amt) => (
          <button key={amt} className="chip" onClick={() => onQuickAdd(amt)}><Plus size={13} /> {formatMl(amt)}</button>
        ))}
        <button className="chip chip-ghost" onClick={() => setCustomOpen((v) => !v)}>Custom</button>
      </div>
      {customOpen && (
        <form className="custom-water-form" onSubmit={(e) => { e.preventDefault(); const n = parseInt(customVal, 10); if (n > 0) { onCustomAdd(n); setCustomVal(""); setCustomOpen(false); } }}>
          <input autoFocus type="number" inputMode="numeric" placeholder="Amount in ml" value={customVal} onChange={(e) => setCustomVal(e.target.value)} className="text-input" />
          <button type="submit" className="btn-primary btn-small">Add</button>
        </form>
      )}
    </div>
  );
}

function WeightWidget({ day, updateDay, showToast }) {
  const [weightInput, setWeightInput] = useState(day.weight != null ? String(day.weight) : "");
  const [editing, setEditing] = useState(day.weight == null);
  function handleSave() {
    const val = parseFloat(weightInput);
    if (!val || val <= 0) { showToast("Enter a valid weight first.", "warn"); return; }
    const rounded = Math.round(val * 10) / 10;
    updateDay((d) => ({ ...d, weight: rounded }));
    setWeightInput(String(rounded));
    setEditing(false);
    showToast(`Weight logged: ${rounded} kg`, "good");
  }
  return (
    <div className="card body-card">
      <div className="card-title"><Scale size={15} /> Weight</div>
      <div className="weight-row">
        {editing ? (
          <>
            <div className="weight-input-group">
              <input type="number" inputMode="decimal" step="0.1" placeholder="Weight" value={weightInput} onChange={(e) => setWeightInput(e.target.value)} className="weight-input" autoFocus={day.weight != null} />
              <span className="goal-field-unit">kg</span>
            </div>
            <button className="btn-primary btn-small" onClick={handleSave}>{day.weight != null ? "Update" : "Log"}</button>
          </>
        ) : (
          <>
            <div className="weight-logged-pill"><Scale size={13} /> {day.weight} kg logged</div>
            <button className="btn-ghost btn-small" onClick={() => setEditing(true)}>Edit</button>
          </>
        )}
      </div>
    </div>
  );
}

function MealLogger({ day, updateDay, showToast }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function handleLog() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const items = await estimateNutrition(trimmed);
      if (!items.length) {
        showToast("Couldn't find anything to log there — try describing a food or drink.", "warn");
      } else {
        const time = timeNow();
        updateDay((d) => ({ ...d, entries: [...d.entries, ...items.map((it) => ({ id: uid(), time, ...it }))] }));
        const kcal = items.reduce((s, i) => s + i.calories, 0);
        showToast(`Logged ${items.length > 1 ? `${items.length} items` : items[0].name} · ${kcal} kcal`, "good");
        setText("");
      }
    } catch (e) {
      showToast(e?.message ? `Couldn't log that meal — ${e.message}` : "Couldn't estimate that meal — check your connection and try again.", "warn");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card log-card">
      <div className="card-title"><UtensilsCrossed size={15} /> Log a meal or snack</div>
      <textarea className="text-area" placeholder="e.g. two scrambled eggs, a slice of toast, and a black coffee" value={text} onChange={(e) => setText(e.target.value)} rows={3} />
      <button className="btn-primary" onClick={handleLog} disabled={busy || !text.trim()}>
        {busy ? <><Loader2 size={16} className="spin" /> Estimating…</> : <><Plus size={16} /> Log it</>}
      </button>
    </div>
  );
}

function WorkoutStatusBadge({ day, onOpenWorkout }) {
  const has = day.workouts.length > 0;
  return (
    <button className={`workout-status ${has ? "on" : ""}`} onClick={onOpenWorkout}>
      <Dumbbell size={16} />
      <span>{has ? `${day.workouts.length} workout${day.workouts.length > 1 ? "s" : ""} logged today` : "No workout logged today"}</span>
      <ChevronRight size={15} className="workout-status-chevron" />
    </button>
  );
}

function WorkoutForm({ onAdd }) {
  const [type, setType] = useState("weights");
  const [fields, setFields] = useState({});
  function set(k, v) { setFields((f) => ({ ...f, [k]: v })); }
  function handleAdd() {
    if (type === "weights" && !fields.exercise) return;
    onAdd({ id: uid(), type, ...fields });
    setFields({});
  }
  const currentLabel = WORKOUT_TYPES.find((t) => t.value === type)?.label.toLowerCase();
  return (
    <div className="workout-form">
      <div className="workout-type-row">
        {WORKOUT_TYPES.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.value} className={`workout-type-chip ${type === t.value ? "on" : ""}`} onClick={() => { setType(t.value); setFields({}); }}>
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>
      {type === "weights" && (
        <div className="workout-field-grid">
          <input className="text-input" placeholder="Exercise (e.g. Bench press)" value={fields.exercise || ""} onChange={(e) => set("exercise", e.target.value)} />
          <input className="text-input" type="number" inputMode="decimal" placeholder="Weight (kg)" value={fields.weight || ""} onChange={(e) => set("weight", e.target.value)} />
          <input className="text-input" type="number" inputMode="numeric" placeholder="Reps" value={fields.reps || ""} onChange={(e) => set("reps", e.target.value)} />
          <input className="text-input" type="number" inputMode="numeric" placeholder="Sets" value={fields.sets || ""} onChange={(e) => set("sets", e.target.value)} />
        </div>
      )}
      {type === "treadmill" && (
        <div className="workout-field-grid">
          <input className="text-input" type="number" inputMode="decimal" placeholder="Incline (%)" value={fields.incline || ""} onChange={(e) => set("incline", e.target.value)} />
          <input className="text-input" placeholder="Pace (e.g. 6:30/km)" value={fields.pace || ""} onChange={(e) => set("pace", e.target.value)} />
          <input className="text-input" type="number" inputMode="numeric" placeholder="Time (min)" value={fields.time || ""} onChange={(e) => set("time", e.target.value)} />
        </div>
      )}
      {type === "cycling" && (
        <div className="workout-field-grid">
          <input className="text-input" placeholder="Pace (e.g. 28km/h)" value={fields.pace || ""} onChange={(e) => set("pace", e.target.value)} />
          <input className="text-input" type="number" inputMode="numeric" placeholder="Time (min)" value={fields.time || ""} onChange={(e) => set("time", e.target.value)} />
          <input className="text-input" type="number" inputMode="numeric" placeholder="Laps" value={fields.laps || ""} onChange={(e) => set("laps", e.target.value)} />
        </div>
      )}
      <button className="btn-primary" onClick={handleAdd}><Plus size={16} /> Add {currentLabel}</button>
    </div>
  );
}
function WorkoutLogger({ day, updateDay, showToast }) {
  function handleAdd(entry) {
    updateDay((d) => ({ ...d, workouts: [...d.workouts, entry] }));
    showToast("Workout logged", "good");
  }
  function handleRemove(id) {
    updateDay((d) => ({ ...d, workouts: d.workouts.filter((w) => w.id !== id) }));
  }
  return (
    <div className="card">
      <div className="card-title"><Dumbbell size={15} /> Log a workout</div>
      <WorkoutForm onAdd={handleAdd} />
      {day.workouts.length > 0 && (
        <ul className="workout-entry-list">
          {day.workouts.map((w) => {
            const meta = WORKOUT_TYPES.find((t) => t.value === w.type);
            const Icon = meta?.icon || Dumbbell;
            return (
              <li key={w.id} className="workout-entry">
                <Icon size={14} className="workout-entry-icon" />
                <span className="workout-entry-desc">{describeWorkout(w)}</span>
                <button className="workout-entry-delete" onClick={() => handleRemove(w.id)} aria-label="Delete workout"><Trash2 size={13} /></button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [toast, onDone]);
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.type}`}>
      <span>{toast.message}</span>
      <button onClick={onDone} aria-label="Dismiss"><X size={14} /></button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Customize modal (sex / age / height / weight / activity + goals)       */
/* ---------------------------------------------------------------------- */

function CustomizeModal({ data, setData, showToast, onClose }) {
  const [form, setForm] = useState({ ...DEFAULT_PROFILE, ...data.profile });

  function field(key, label, unit) {
    return (
      <div className="goal-field">
        <label>
          <span className="goal-field-label">{label}</span>
          <div className="goal-field-input">
            <input type="number" inputMode="numeric" min="0" value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: Math.max(0, parseInt(e.target.value || "0", 10)) }))} />
            <span className="goal-field-unit">{unit}</span>
          </div>
        </label>
      </div>
    );
  }
  function floatField(key, label, unit) {
    return (
      <div className="goal-field">
        <label>
          <span className="goal-field-label">{label}</span>
          <div className="goal-field-input">
            <input type="number" inputMode="decimal" step="0.1" min="0" value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: Math.max(0, parseFloat(e.target.value || "0")) }))} />
            <span className="goal-field-unit">{unit}</span>
          </div>
        </label>
      </div>
    );
  }
  function selectField(key, label, options) {
    return (
      <div className="goal-field">
        <label>
          <span className="goal-field-label">{label}</span>
          <div className="goal-field-input">
            <select value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </label>
      </div>
    );
  }
  function handleSuggest() {
    const weightKg = latestLoggedWeight(data) || form.weightGoalKg;
    const suggestion = suggestGoals({ sex: form.sex, age: form.age, heightCm: form.heightCm, weightKg, activityLevel: form.activityLevel });
    if (!suggestion) { showToast("Fill in your age, height, and weight first.", "warn"); return; }
    setForm((f) => ({ ...f, ...suggestion }));
    showToast("Suggested goals filled in below — review, then save.", "good");
  }
  function handleSave() {
    setData((prev) => ({ ...prev, profile: form }));
    showToast("Goals updated", "good");
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="card-title" style={{ marginBottom: 0 }}><SlidersHorizontal size={15} /> Customize</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="card">
            <div className="card-title"><User size={15} /> About you</div>
            {selectField("sex", "Sex", [{ value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "other", label: "Other" }])}
            {field("age", "Age", "yrs")}
            {field("heightCm", "Height", "cm")}
            {floatField("weightGoalKg", "Target weight", "kg")}
            {selectField("activityLevel", "Activity level", ACTIVITY_LEVELS.map((a) => ({ value: a.value, label: a.label })))}
            <button className="btn-ghost" onClick={handleSuggest}><Sparkles size={14} /> Suggest goals for me</button>
            <span className="goal-field-hint suggest-hint">Uses your most recent logged weight (or target weight if you haven't logged one) to estimate a starting point — review before saving.</span>
          </div>
          <div className="card">
            <div className="card-title"><Target size={15} /> Your daily goals</div>
            {field("calorieGoal", "Calories", "kcal")}
            {field("proteinGoal", "Protein", "g")}
            {field("carbGoal", "Carbs", "g")}
            {field("fatGoal", "Fat", "g")}
            {field("waterGoal", "Water", "ml")}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={handleSave}>Save goals</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tab: Today                                                             */
/* ---------------------------------------------------------------------- */

function TodayTab({ data, setData, showToast, goWorkout, onOpenCustomize }) {
  const key = todayKey();
  const day = getDay(data, key);
  const totals = dayTotals(day);
  const now = new Date();

  function updateDay(mutator) {
    setData((prev) => {
      const d = getDay(prev, key);
      return { ...prev, days: { ...prev.days, [key]: mutator(d) } };
    });
  }
  async function handleShareDay() {
    try {
      const canvas = await renderShareCard(dailyShareData(key, day, totals, data.profile));
      const result = await shareCardImage(canvas, `sprout-${key}`, "Sprout — Today's Summary");
      if (result === "downloaded") showToast("Image saved — attach it to your message", "good");
    } catch (e) {
      showToast("Couldn't generate the image — try again.", "warn");
    }
  }

  return (
    <div className="tab-panel">
      <div className="today-header">
        <div>
          <div className="greeting"><Sunrise size={15} /> {greetingFor(now.getHours())}</div>
          <div className="date-line">{DOW_FULL[now.getDay()]}, {MONTHS[now.getMonth()]} {now.getDate()}</div>
        </div>
        <div className="today-header-actions">
          <button className="icon-btn" onClick={onOpenCustomize} aria-label="Customize goals"><SlidersHorizontal size={16} /></button>
          <button className="icon-btn" onClick={handleShareDay} aria-label="Share today's summary"><Share2 size={16} /></button>
        </div>
      </div>

      <div className="card hero-card">
        <CalorieRing consumed={totals.calories} goal={data.profile.calorieGoal} />
        <div className="macro-list">
          <MacroBar label="Protein" consumed={totals.protein} goal={data.profile.proteinGoal} color="var(--clay)" />
          <MacroBar label="Carbs" consumed={totals.carbs} goal={data.profile.carbGoal} color="var(--gold)" />
          <MacroBar label="Fat" consumed={totals.fat} goal={data.profile.fatGoal} color="var(--plum)" />
        </div>
      </div>

      <WaterWidget
        ml={day.water}
        goal={data.profile.waterGoal}
        onQuickAdd={(amt) => { updateDay((d) => ({ ...d, water: d.water + amt })); showToast(`+${formatMl(amt)} logged`, "good"); }}
        onCustomAdd={(amt) => { updateDay((d) => ({ ...d, water: d.water + amt })); showToast(`+${amt} ml logged`, "good"); }}
      />

      <WeightWidget key={key} day={day} updateDay={updateDay} showToast={showToast} />

      <WorkoutStatusBadge day={day} onOpenWorkout={goWorkout} />

      <MealLogger key={key} day={day} updateDay={updateDay} showToast={showToast} />

    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tab: Log (history browser + backfilling)                               */
/* ---------------------------------------------------------------------- */

function LogTab({ data, setData, showToast }) {
  const [offset, setOffset] = useState(0);
  const key = addDays(todayKey(), offset);
  const day = getDay(data, key);
  const totals = dayTotals(day);
  const d = keyToDate(key);
  const isToday = offset === 0;
  const [editingId, setEditingId] = useState(null);
  const [editVals, setEditVals] = useState({});

  function updateDay(mutator) {
    setData((prev) => {
      const dd = getDay(prev, key);
      return { ...prev, days: { ...prev.days, [key]: mutator(dd) } };
    });
  }
  function removeEntry(id) {
    updateDay((dd) => ({ ...dd, entries: dd.entries.filter((e) => e.id !== id) }));
    showToast("Entry removed", "neutral");
  }
  function startEdit(e) {
    setEditingId(e.id);
    setEditVals({ calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat });
  }
  function saveEdit(id) {
    updateDay((dd) => ({
      ...dd,
      entries: dd.entries.map((e) => (e.id === id ? { ...e, ...Object.fromEntries(Object.entries(editVals).map(([k, v]) => [k, Math.max(0, parseFloat(v) || 0)])) } : e)),
    }));
    setEditingId(null);
    showToast("Entry updated", "good");
  }
  async function handleShareDay() {
    try {
      const canvas = await renderShareCard(dailyShareData(key, day, totals, data.profile));
      const label = isToday ? "Today" : `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
      const result = await shareCardImage(canvas, `sprout-${key}`, `Sprout — ${label}`);
      if (result === "downloaded") showToast("Image saved — attach it to your message", "good");
    } catch (e) {
      showToast("Couldn't generate the image — try again.", "warn");
    }
  }

  return (
    <div className="tab-panel">
      <div className="log-nav">
        <button className="icon-btn" onClick={() => setOffset((o) => o - 1)} aria-label="Previous day"><ChevronLeft size={18} /></button>
        <div className="log-nav-label">
          <div className="log-nav-date">{isToday ? "Today" : `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`}</div>
          <div className="log-nav-sub">
            {totals.calories.toLocaleString()} kcal · {day.water.toLocaleString()} ml water
            {day.weight != null && ` · ${day.weight} kg`}
            {day.workouts.length > 0 && ` · ${day.workouts.length} workout${day.workouts.length > 1 ? "s" : ""}`}
          </div>
        </div>
        <button className="icon-btn" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset === 0} aria-label="Next day"><ChevronRight size={18} /></button>
      </div>

      <button className="btn-ghost btn-small btn-share-day" onClick={handleShareDay}><Share2 size={14} /> Share this day</button>

      <MealLogger key={key} day={day} updateDay={updateDay} showToast={showToast} />
      <WaterWidget
        ml={day.water}
        goal={data.profile.waterGoal}
        onQuickAdd={(amt) => { updateDay((dd) => ({ ...dd, water: dd.water + amt })); showToast(`+${formatMl(amt)} logged`, "good"); }}
        onCustomAdd={(amt) => { updateDay((dd) => ({ ...dd, water: dd.water + amt })); showToast(`+${amt} ml logged`, "good"); }}
      />
      <WeightWidget key={key} day={day} updateDay={updateDay} showToast={showToast} />

      {day.entries.length === 0 ? (
        <div className="empty-state">
          <UtensilsCrossed size={26} />
          <p>Nothing logged {isToday ? "yet today" : "this day"}.</p>
          <span>Use the box above to add something.</span>
        </div>
      ) : (
        <ul className="entry-list">
          {[...day.entries].reverse().map((e) => (
            <li key={e.id} className="entry-card">
              {editingId === e.id ? (
                <div className="entry-edit-grid">
                  {["calories", "protein", "carbs", "fat"].map((f) => (
                    <label key={f} className="entry-edit-field">
                      <span>{f}</span>
                      <input type="number" value={editVals[f]} onChange={(ev) => setEditVals((v) => ({ ...v, [f]: ev.target.value }))} />
                    </label>
                  ))}
                  <div className="entry-edit-actions">
                    <button className="btn-primary btn-small" onClick={() => saveEdit(e.id)}>Save</button>
                    <button className="btn-ghost btn-small" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="entry-top">
                    <div><div className="entry-name">{e.name}</div><div className="entry-time">{e.time}</div></div>
                    <div className="entry-kcal">{e.calories} kcal</div>
                  </div>
                  <div className="entry-macros">
                    <span><i className="dot dot-clay" />{e.protein}g protein</span>
                    <span><i className="dot dot-gold" />{e.carbs}g carbs</span>
                    <span><i className="dot dot-plum" />{e.fat}g fat</span>
                  </div>
                  <div className="entry-actions">
                    <button className="entry-action-btn" onClick={() => startEdit(e)} aria-label="Edit entry"><Pencil size={13} /></button>
                    <button className="entry-action-btn" onClick={() => removeEntry(e.id)} aria-label="Delete entry"><Trash2 size={14} /></button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tab: Weekly                                                            */
/* ---------------------------------------------------------------------- */

function WeeklyTab({ data, showToast }) {
  const rows = useMemo(() => weekRows(data), [data]);
  const daysWithData = rows.filter((r) => r.totals.calories > 0 || r.water > 0);
  const avg = (fn) => (daysWithData.length ? Math.round(daysWithData.reduce((s, r) => s + fn(r), 0) / daysWithData.length) : 0);
  const avgCalories = avg((r) => r.totals.calories);
  const avgProtein = avg((r) => r.totals.protein);
  const avgCarbs = avg((r) => r.totals.carbs);
  const avgFat = avg((r) => r.totals.fat);
  const avgWater = avg((r) => r.water);
  const weighIns = rows.filter((r) => r.weight != null);
  const weightChange = weighIns.length >= 2 ? Math.round((weighIns[weighIns.length - 1].weight - weighIns[0].weight) * 10) / 10 : null;

  let streak = 0;
  for (let i = 1; i <= 30; i++) {
    const k = addDays(todayKey(), -i);
    const t = dayTotals(getDay(data, k)).calories;
    if (t === 0) break;
    const ratio = t / data.profile.calorieGoal;
    if (ratio >= 0.85 && ratio <= 1.15) streak++;
    else break;
  }

  async function handleShareWeek() {
    try {
      const canvas = await renderShareCard(weeklyShareData(data, rows, streak));
      const result = await shareCardImage(canvas, "sprout-weekly", "Sprout — Weekly Summary");
      if (result === "downloaded") showToast("Image saved — attach it to your message", "good");
    } catch (e) {
      showToast("Couldn't generate the image — try again.", "warn");
    }
  }

  return (
    <div className="tab-panel">
      <div className="stat-grid stat-grid-wide">
        <div className="stat-box"><span className="stat-num">{avgCalories.toLocaleString()}</span><span className="stat-label">avg kcal/day</span></div>
        <div className="stat-box"><span className="stat-num">{avgProtein}g</span><span className="stat-label">avg protein</span></div>
        <div className="stat-box"><span className="stat-num">{avgCarbs}g</span><span className="stat-label">avg carbs</span></div>
        <div className="stat-box"><span className="stat-num">{avgFat}g</span><span className="stat-label">avg fat</span></div>
        <div className="stat-box"><span className="stat-num">{avgWater.toLocaleString()}</span><span className="stat-label">avg water ml</span></div>
        <div className="stat-box"><span className="stat-num">{weightChange != null ? `${weightChange > 0 ? "+" : ""}${weightChange}kg` : "—"}</span><span className="stat-label">weight change</span></div>
        <div className="stat-box"><span className="stat-num">{streak}</span><span className="stat-label">day streak</span></div>
      </div>

      <div className="card">
        <div className="card-title"><Scale size={15} /> Weight this week</div>
        {weighIns.length > 0 ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={rows.map((r) => ({ label: DOW[r.date.getDay()], weight: r.weight }))} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 5" stroke="#E1E4D8" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5B6B5A" }} axisLine={false} tickLine={false} />
                <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 11, fill: "#5B6B5A" }} axisLine={false} tickLine={false} width={34} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E1E4D8", fontSize: 12 }} />
                <Line type="monotone" dataKey="weight" stroke="#3E7CB1" strokeWidth={2.5} dot={{ r: 4, fill: "#3E7CB1" }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="tip-placeholder">No weigh-ins yet this week — log your weight on the Today tab to see a trend line here.</p>
        )}
      </div>

      <div className="week-list">
        {[...rows].reverse().map((r) => {
          const isToday = r.key === todayKey();
          const pct = clampPct(data.profile.calorieGoal > 0 ? (r.totals.calories / data.profile.calorieGoal) * 100 : 0);
          return (
            <div key={r.key} className={`week-day-card ${isToday ? "is-today" : ""}`}>
              <div className="week-day-top">
                <div className="week-day-date">
                  <span className="week-day-dow">{isToday ? "Today" : DOW[r.date.getDay()]}</span>
                  <span className="week-day-num">{MONTHS[r.date.getMonth()]} {r.date.getDate()}</span>
                </div>
                <div className="week-day-badges">
                  {r.workouts.length > 0 && <span className="badge badge-workout"><Dumbbell size={11} /> {r.workouts.length}</span>}
                  {r.weight != null && <span className="badge badge-weight"><Scale size={11} /> {r.weight} kg</span>}
                </div>
              </div>
              <div className="week-day-cal"><span>{r.totals.calories.toLocaleString()} <span className="week-day-cal-goal">/ {data.profile.calorieGoal.toLocaleString()} kcal</span></span></div>
              <div className="week-day-bar-track"><div className="week-day-bar-fill" style={{ width: `${pct}%` }} /></div>
              <div className="week-day-macros">
                <span><i className="dot dot-clay" />{r.totals.protein}g</span>
                <span><i className="dot dot-gold" />{r.totals.carbs}g</span>
                <span><i className="dot dot-plum" />{r.totals.fat}g</span>
                <span><i className="dot dot-water" />{r.water.toLocaleString()}ml</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-title"><Share2 size={15} /> Share with your coach</div>
        <p className="tip-placeholder">Send a snapshot image — goals, day-by-day totals, and weekly averages — to whoever you're texting, emailing, or messaging.</p>
        <button className="btn-primary" onClick={handleShareWeek}><Share2 size={16} /> Share weekly summary</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tab: Monthly                                                           */
/* ---------------------------------------------------------------------- */

function MonthlyTab({ data, showToast }) {
  const buckets = useMemo(() => monthlyBuckets(data), [data]);
  async function handleShareMonth() {
    try {
      const canvas = await renderShareCard(monthlyShareData(data, buckets));
      const result = await shareCardImage(canvas, "sprout-monthly", "Sprout — Monthly Summary");
      if (result === "downloaded") showToast("Image saved — attach it to your message", "good");
    } catch (e) {
      showToast("Couldn't generate the image — try again.", "warn");
    }
  }

  if (buckets.length === 0) {
    return (
      <div className="tab-panel">
        <div className="empty-state">
          <Calendar size={26} />
          <p>No monthly data yet.</p>
          <span>Log a meal, water, or weight on Today to start tracking.</span>
        </div>
      </div>
    );
  }

  const overallAvg = (fn) => Math.round(buckets.reduce((s, b) => s + fn(b), 0) / buckets.length);
  const weighInBuckets = buckets.filter((b) => b.weightChange != null);
  const totalWeightChange = weighInBuckets.length ? Math.round(weighInBuckets.reduce((s, b) => s + b.weightChange, 0) * 10) / 10 : null;

  return (
    <div className="tab-panel">
      <div className="stat-grid stat-grid-wide">
        <div className="stat-box"><span className="stat-num">{overallAvg((b) => b.avgCalories).toLocaleString()}</span><span className="stat-label">avg kcal/day</span></div>
        <div className="stat-box"><span className="stat-num">{overallAvg((b) => b.avgProtein)}g</span><span className="stat-label">avg protein</span></div>
        <div className="stat-box"><span className="stat-num">{overallAvg((b) => b.avgCarbs)}g</span><span className="stat-label">avg carbs</span></div>
        <div className="stat-box"><span className="stat-num">{overallAvg((b) => b.avgFat)}g</span><span className="stat-label">avg fat</span></div>
        <div className="stat-box"><span className="stat-num">{overallAvg((b) => b.avgWater).toLocaleString()}</span><span className="stat-label">avg water ml</span></div>
        <div className="stat-box"><span className="stat-num">{totalWeightChange != null ? `${totalWeightChange > 0 ? "+" : ""}${totalWeightChange}kg` : "—"}</span><span className="stat-label">weight change</span></div>
        <div className="stat-box"><span className="stat-num">{buckets.length}</span><span className="stat-label">weeks tracked</span></div>
      </div>

      <div className="card">
        <div className="card-title"><Scale size={15} /> Weight by week</div>
        {weighInBuckets.length > 0 ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={buckets.map((b, i) => ({ label: `Wk ${i + 1}`, weight: b.endWeight }))} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 5" stroke="#E1E4D8" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5B6B5A" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5B6B5A" }} axisLine={false} tickLine={false} width={34} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E1E4D8", fontSize: 12 }} />
                <Line type="monotone" dataKey="weight" stroke="#3E7CB1" strokeWidth={2.5} dot={{ r: 4, fill: "#3E7CB1" }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="tip-placeholder">Log your weight to see weekly trends here.</p>
        )}
      </div>

      <div className="week-list">
        {[...buckets].reverse().map((b, idx) => {
          const weekNum = buckets.length - idx;
          const pct = clampPct(data.profile.calorieGoal > 0 ? (b.avgCalories / data.profile.calorieGoal) * 100 : 0);
          return (
            <div key={b.startKey} className="week-day-card">
              <div className="week-day-top">
                <div className="week-day-date">
                  <span className="week-day-dow">Week {weekNum}</span>
                  <span className="week-day-num">{MONTHS[b.startDate.getMonth()]} {b.startDate.getDate()} – {MONTHS[b.endDate.getMonth()]} {b.endDate.getDate()}</span>
                </div>
                <div className="week-day-badges">
                  {b.workoutSessions > 0 && <span className="badge badge-workout"><Dumbbell size={11} /> {b.workoutSessions}</span>}
                  {b.endWeight != null && <span className="badge badge-weight"><Scale size={11} /> {b.endWeight} kg</span>}
                </div>
              </div>
              <div className="week-day-cal"><span>{b.avgCalories.toLocaleString()} <span className="week-day-cal-goal">/ {data.profile.calorieGoal.toLocaleString()} kcal avg</span></span></div>
              <div className="week-day-bar-track"><div className="week-day-bar-fill" style={{ width: `${pct}%` }} /></div>
              <div className="week-day-macros">
                <span><i className="dot dot-clay" />{b.avgProtein}g</span>
                <span><i className="dot dot-gold" />{b.avgCarbs}g</span>
                <span><i className="dot dot-plum" />{b.avgFat}g</span>
                <span><i className="dot dot-water" />{b.avgWater.toLocaleString()}ml</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-title"><Share2 size={15} /> Share with your coach</div>
        <p className="tip-placeholder">Send a snapshot image summarizing this month's weekly averages.</p>
        <button className="btn-primary" onClick={handleShareMonth}><Share2 size={16} /> Share monthly summary</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tab: Workout                                                           */
/* ---------------------------------------------------------------------- */

function WorkoutTab({ data, setData, showToast }) {
  const [offset, setOffset] = useState(0);
  const key = addDays(todayKey(), offset);
  const day = getDay(data, key);
  const d = keyToDate(key);
  const isToday = offset === 0;

  function updateDay(mutator) {
    setData((prev) => {
      const dd = getDay(prev, key);
      return { ...prev, days: { ...prev.days, [key]: mutator(dd) } };
    });
  }

  const rows = useMemo(() => weekRows(data), [data]);
  const weekSessions = rows.reduce((s, r) => s + r.workouts.length, 0);
  const weekActiveDays = rows.filter((r) => r.workouts.length > 0).length;
  const buckets = useMemo(() => monthlyBuckets(data), [data]);
  const monthSessions = buckets.reduce((s, b) => s + b.workoutSessions, 0);

  return (
    <div className="tab-panel">
      <div className="log-nav">
        <button className="icon-btn" onClick={() => setOffset((o) => o - 1)} aria-label="Previous day"><ChevronLeft size={18} /></button>
        <div className="log-nav-label">
          <div className="log-nav-date">{isToday ? "Today" : `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`}</div>
          <div className="log-nav-sub">{day.workouts.length > 0 ? `${day.workouts.length} workout${day.workouts.length > 1 ? "s" : ""} logged` : "No workout logged"}</div>
        </div>
        <button className="icon-btn" onClick={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset === 0} aria-label="Next day"><ChevronRight size={18} /></button>
      </div>

      <WorkoutLogger key={key} day={day} updateDay={updateDay} showToast={showToast} />

      <div className="stat-grid">
        <div className="stat-box"><span className="stat-num">{weekSessions}</span><span className="stat-label">sessions this week</span></div>
        <div className="stat-box"><span className="stat-num">{weekActiveDays}/7</span><span className="stat-label">active days</span></div>
        <div className="stat-box"><span className="stat-num">{monthSessions}</span><span className="stat-label">sessions this month</span></div>
      </div>

      {buckets.length > 0 && (
        <div className="card">
          <div className="card-title"><Calendar size={15} /> Weekly activity, this month</div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={buckets.map((b, i) => ({ label: `Wk ${i + 1}`, sessions: b.workoutSessions }))} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 5" stroke="#E1E4D8" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5B6B5A" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#5B6B5A" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #E1E4D8", fontSize: 12 }} />
                <Bar dataKey="sessions" fill="#4C8B5B" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  App shell                                                              */
/* ---------------------------------------------------------------------- */

const TABS = [
  { id: "today", label: "Today", icon: Flame },
  { id: "log", label: "Log", icon: UtensilsCrossed },
  { id: "weekly", label: "Weekly", icon: TrendingUp },
  { id: "monthly", label: "Monthly", icon: Calendar },
  { id: "workout", label: "Workout", icon: Dumbbell },
];

const STORAGE_KEY = "sprout-nutrition-data";

export default function App() {
  const [data, setData] = useState({ profile: DEFAULT_PROFILE, days: {} });
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("today");
  const [toast, setToast] = useState(null);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const saveTimer = useRef(null);
  const touchStartRef = useRef(null);

  const showToast = useCallback((message, type = "neutral") => {
    setToast({ message, type, id: uid() });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setData({ profile: { ...DEFAULT_PROFILE, ...(parsed.profile || {}) }, days: parsed.days || {} });
        }
      } catch (e) {
        // no stored data yet — defaults are fine
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await storage.set(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {}
    }, 350);
    return () => clearTimeout(saveTimer.current);
  }, [data, loaded]);

  function handleTouchStart(e) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  }
  function handleTouchEnd(e) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const idx = TABS.findIndex((tb) => tb.id === tab);
      if (dx < 0 && idx < TABS.length - 1) setTab(TABS[idx + 1].id);
      else if (dx > 0 && idx > 0) setTab(TABS[idx - 1].id);
    }
  }

  const activeIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="napp">
      <style>{CSS}</style>

      {!loaded ? (
        <div className="boot"><Leaf size={26} className="spin-slow" /></div>
      ) : (
        <>
          <main className="napp-main" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            {tab === "today" && (
              <TodayTab data={data} setData={setData} showToast={showToast} goWorkout={() => setTab("workout")} onOpenCustomize={() => setCustomizeOpen(true)} />
            )}
            {tab === "log" && <LogTab data={data} setData={setData} showToast={showToast} />}
            {tab === "weekly" && <WeeklyTab data={data} showToast={showToast} />}
            {tab === "monthly" && <MonthlyTab data={data} showToast={showToast} />}
            {tab === "workout" && <WorkoutTab data={data} setData={setData} showToast={showToast} />}
          </main>

          <Toast toast={toast} onDone={() => setToast(null)} />

          {customizeOpen && <CustomizeModal data={data} setData={setData} showToast={showToast} onClose={() => setCustomizeOpen(false)} />}

          <nav className="tabbar">
            <div className="tabbar-indicator" style={{ left: `${activeIndex * 20}%` }} />
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = t.id === tab;
              return (
                <button key={t.id} className={`tabbar-btn ${active ? "active" : ""}`} onClick={() => setTab(t.id)}>
                  <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Styles                                                                 */
/* ---------------------------------------------------------------------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap');

.napp {
  --bg: #F4F6EE;
  --surface: #FFFFFF;
  --ink: #202B22;
  --ink-soft: #5B6B5A;
  --border: #E1E4D8;
  --gold: #D9A441;
  --clay: #B5533C;
  --plum: #8B6F9E;
  --water: #3E7CB1;
  --good: #4C8B5B;
  --shadow: rgba(32,43,34,0.08);
  font-family: 'Manrope', system-ui, sans-serif;
  background: var(--bg);
  color: var(--ink);
  max-width: 460px;
  margin: 0 auto;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  position: relative;
  -webkit-font-smoothing: antialiased;
  touch-action: pan-y;
}
.napp *, .napp *::before, .napp *::after { box-sizing: border-box; }
.napp button { font-family: inherit; cursor: pointer; }
.napp input, .napp textarea, .napp select { font-family: inherit; }
.napp button:focus-visible, .napp input:focus-visible, .napp textarea:focus-visible, .napp select:focus-visible {
  outline: 2px solid var(--water);
  outline-offset: 2px;
}

.boot { flex: 1; display: flex; align-items: center; justify-content: center; color: var(--good); }
.spin-slow { animation: spin 1.4s linear infinite; }
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.napp-main { flex: 1; overflow-y: auto; padding: 20px 16px 96px; }
.tab-panel { display: flex; flex-direction: column; gap: 14px; animation: fadein 0.28s ease; }
@keyframes fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

.today-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.today-header-actions { display: flex; gap: 8px; }
.greeting { display:flex; align-items:center; gap:6px; font-family:'Fraunces', serif; font-size: 22px; font-weight: 600; }
.date-line { color: var(--ink-soft); font-size: 13px; margin-top: 2px; }

.card { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 18px; box-shadow: 0 6px 18px var(--shadow); }
.card-title { display:flex; align-items:center; gap:7px; font-size: 13px; font-weight: 700; color: var(--ink-soft); margin-bottom: 12px; }
.card-title-row { display:flex; align-items:center; justify-content:space-between; margin-bottom: 10px; }
.card-title-row .card-title { margin-bottom: 0; }

.hero-card { display:flex; flex-direction:column; align-items:center; gap: 18px; }
.ring-wrap { position: relative; width: 180px; height: 180px; }
.ring-svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ring-track { fill: none; stroke: #EEF1E6; stroke-width: 12; }
.ring-progress { fill: none; stroke-width: 12; stroke-linecap: round; transition: stroke-dashoffset 0.7s cubic-bezier(.25,.9,.35,1), stroke 0.3s; }
.ring-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; text-align:center; padding: 0 14px; }
.ring-number { font-family:'Fraunces', serif; font-size: 38px; font-weight: 700; line-height: 1; }
.ring-label { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
.ring-sub { font-size: 11px; margin-top: 6px; font-weight: 600; }

.macro-list { width: 100%; display:flex; flex-direction:column; gap: 12px; }
.macro-row-top { display:flex; justify-content:space-between; font-size: 12.5px; margin-bottom: 5px; }
.macro-label { font-weight: 700; }
.macro-value { color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.macro-unit { color: #9AA695; }
.macro-track { height: 8px; border-radius: 6px; background: #EEF1E6; overflow: hidden; }
.macro-fill { height: 100%; border-radius: 6px; transition: width 0.6s cubic-bezier(.25,.9,.35,1); }

.water-card { background: var(--surface); border:1px solid var(--border); border-radius: 20px; padding: 18px; box-shadow: 0 6px 18px var(--shadow); display:flex; flex-direction:column; gap: 14px; }
.water-visual { display:flex; align-items:center; gap: 16px; }
.jar { position:relative; width: 46px; height: 68px; border: 2px solid #CBD6D9; border-radius: 8px 8px 14px 14px; overflow:hidden; background: #F7FAF7; flex-shrink:0; }
.jar-fill { position:absolute; bottom:0; left:0; right:0; background: linear-gradient(180deg, #5FA0C9, var(--water)); transition: height 0.7s cubic-bezier(.25,.9,.35,1); }
.jar-wave { position:absolute; top:-3px; left:-10%; width:120%; height:8px; background: rgba(255,255,255,0.35); border-radius: 50%; animation: wave 2.6s ease-in-out infinite; }
@keyframes wave { 0%,100% { transform: translateY(0) scaleX(1); } 50% { transform: translateY(2px) scaleX(1.05); } }
.water-readout { display:flex; align-items:center; gap: 8px; }
.water-icon { color: var(--water); }
.water-ml { font-family:'Fraunces', serif; font-size: 20px; font-weight: 700; line-height:1; }
.water-unit { font-size: 12px; font-weight: 500; color: var(--ink-soft); }
.water-goal { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
.water-actions { display:flex; flex-wrap:wrap; gap: 8px; }

.body-card { display:flex; flex-direction:column; gap: 16px; }
.weight-row { display:flex; align-items:center; gap: 10px; }
.weight-input-group { flex:1; display:flex; align-items:center; border: 1px solid var(--border); border-radius: 12px; background: #F7F9F2; overflow:hidden; }
.weight-input { flex:1; border:none; background:transparent; padding: 9px 12px; font-size: 14px; color: var(--ink); width: 100%; }
.weight-input:focus { outline: none; }
.weight-logged-pill { flex:1; display:flex; align-items:center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--ink); background: #EEF1E6; border-radius: 12px; padding: 10px 12px; }

.workout-status {
  display:flex; align-items:center; gap: 10px; width: 100%;
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  padding: 14px 16px; font-size: 13.5px; font-weight: 700; color: var(--ink-soft);
  box-shadow: 0 6px 18px var(--shadow); transition: border-color 0.2s ease, color 0.2s ease;
}
.workout-status.on { color: var(--good); border-color: var(--good); }
.workout-status span { flex:1; text-align:left; }
.workout-status-chevron { opacity: 0.5; }

.chip {
  display:flex; align-items:center; gap: 4px;
  border: 1px solid var(--border); background: #F7F9F2; color: var(--ink);
  padding: 7px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
  transition: transform 0.15s ease, background 0.15s ease;
}
.chip:hover { background: #EEF1E6; }
.chip:active { transform: scale(0.94); }
.chip-ghost { background: transparent; }
.custom-water-form { display:flex; gap: 8px; animation: fadein 0.2s ease; }

.text-input { flex:1; border: 1px solid var(--border); border-radius: 12px; padding: 9px 12px; font-size: 13px; background: #F7F9F2; color: var(--ink); width: 100%; }
.text-area { width: 100%; border: 1px solid var(--border); border-radius: 14px; padding: 12px 13px; font-size: 13.5px; background: #F7F9F2; color: var(--ink); resize: vertical; min-height: 64px; line-height: 1.5; margin-bottom: 12px; }

.btn-primary { display:flex; align-items:center; justify-content:center; gap: 7px; background: var(--ink); color: #F4F6EE; border: none; border-radius: 13px; padding: 12px 16px; font-size: 13.5px; font-weight: 700; width: 100%; transition: transform 0.15s ease, opacity 0.15s ease; }
.btn-primary:disabled { opacity: 0.45; cursor: default; }
.btn-primary:not(:disabled):active { transform: scale(0.98); }
.btn-small { width: auto; padding: 8px 14px; border-radius: 10px; }
.btn-ghost { display:inline-flex; align-items:center; gap:6px; background: transparent; color: var(--good); border: 1px solid var(--border); border-radius: 10px; padding: 8px 13px; font-size: 12.5px; font-weight: 700; }
.btn-ghost:disabled { opacity: 0.5; }

.tip-placeholder { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 12px; line-height: 1.5; }
.link-btn { display:flex; align-items:center; gap:2px; background:none; border:none; color: var(--good); font-size: 12.5px; font-weight: 700; }

.mini-entry-list { display:flex; flex-direction:column; gap: 9px; list-style:none; margin:0; padding:0; }
.mini-entry { display:flex; justify-content:space-between; font-size: 13px; padding-bottom: 9px; border-bottom: 1px solid var(--border); }
.mini-entry:last-child { border-bottom: none; padding-bottom: 0; }
.mini-entry-kcal { color: var(--ink-soft); font-variant-numeric: tabular-nums; }

.log-nav { display:flex; align-items:center; justify-content:space-between; background: var(--surface); border:1px solid var(--border); border-radius: 16px; padding: 10px 8px; }
.log-nav-label { text-align:center; flex:1; }
.log-nav-date { font-family:'Fraunces', serif; font-weight: 600; font-size: 15px; }
.log-nav-sub { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
.icon-btn { background: #F7F9F2; border: 1px solid var(--border); border-radius: 10px; width: 34px; height: 34px; display:flex; align-items:center; justify-content:center; color: var(--ink); }
.icon-btn:disabled { opacity: 0.35; }
.btn-share-day { align-self: center; margin-top: -4px; }

.empty-state { display:flex; flex-direction:column; align-items:center; gap: 6px; padding: 46px 20px; color: var(--ink-soft); text-align:center; }
.empty-state p { font-size: 14px; font-weight: 700; color: var(--ink); margin: 4px 0 0; }
.empty-state span { font-size: 12.5px; }

.entry-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap: 10px; }
.entry-card { position:relative; background: var(--surface); border:1px solid var(--border); border-radius: 16px; padding: 14px 70px 14px 14px; animation: fadein 0.25s ease; }
.entry-top { display:flex; justify-content:space-between; align-items:flex-start; gap: 10px; }
.entry-name { font-weight: 700; font-size: 13.5px; }
.entry-time { font-size: 11px; color: var(--ink-soft); margin-top: 2px; }
.entry-kcal { font-size: 13px; font-weight: 700; color: var(--gold); white-space:nowrap; }
.entry-macros { display:flex; gap: 12px; margin-top: 9px; font-size: 11px; color: var(--ink-soft); }
.entry-macros span { display:flex; align-items:center; gap: 5px; }
.dot { width:7px; height:7px; border-radius:50%; display:inline-block; }
.dot-clay { background: var(--clay); }
.dot-gold { background: var(--gold); }
.dot-plum { background: var(--plum); }
.dot-water { background: var(--water); }
.entry-actions { position:absolute; top: 14px; right: 12px; display:flex; gap: 6px; }
.entry-action-btn { background: none; border:none; color: #B7C2AE; padding: 4px; }
.entry-action-btn:hover { color: var(--good); }
.entry-edit-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.entry-edit-field { display:flex; flex-direction:column; gap:4px; font-size: 11px; color: var(--ink-soft); text-transform:capitalize; }
.entry-edit-field input { border:1px solid var(--border); border-radius:8px; padding:7px 9px; font-size:13px; background:#F7F9F2; color:var(--ink); }
.entry-edit-actions { grid-column: 1 / -1; display:flex; gap:8px; margin-top:4px; }

.chart-wrap { margin: 0 -6px; }
.stat-grid { display:grid; grid-template-columns: repeat(3,1fr); gap: 10px; }
.stat-grid-wide .stat-box { padding: 12px 6px; }
.stat-box { background: var(--surface); border:1px solid var(--border); border-radius: 16px; padding: 14px 8px; display:flex; flex-direction:column; align-items:center; gap: 3px; }
.stat-num { font-family:'Fraunces', serif; font-size: 17px; font-weight: 700; }
.stat-label { font-size: 10px; color: var(--ink-soft); text-align:center; }

.week-list { display:flex; flex-direction:column; gap: 10px; }
.week-day-card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 14px; animation: fadein 0.25s ease; }
.week-day-card.is-today { border-color: var(--good); box-shadow: 0 0 0 1px var(--good); }
.week-day-top { display:flex; align-items:flex-start; justify-content:space-between; gap: 10px; margin-bottom: 8px; }
.week-day-date { display:flex; flex-direction:column; }
.week-day-dow { font-family:'Fraunces', serif; font-weight: 600; font-size: 14.5px; }
.week-day-num { font-size: 11px; color: var(--ink-soft); }
.week-day-badges { display:flex; flex-wrap:wrap; gap: 6px; justify-content:flex-end; }
.badge { display:flex; align-items:center; gap: 4px; font-size: 10.5px; font-weight: 700; padding: 4px 8px; border-radius: 999px; white-space:nowrap; }
.badge-workout { background: rgba(76,139,91,0.14); color: var(--good); }
.badge-weight { background: rgba(62,124,177,0.14); color: var(--water); }
.week-day-cal { font-size: 13.5px; font-weight: 700; margin-bottom: 6px; }
.week-day-cal-goal { font-weight: 500; color: var(--ink-soft); }
.week-day-bar-track { height: 6px; border-radius: 5px; background: #EEF1E6; overflow:hidden; margin-bottom: 10px; }
.week-day-bar-fill { height: 100%; border-radius: 5px; background: var(--gold); transition: width 0.6s cubic-bezier(.25,.9,.35,1); }
.week-day-macros { display:flex; gap: 12px; font-size: 11px; color: var(--ink-soft); flex-wrap:wrap; }
.week-day-macros span { display:flex; align-items:center; gap: 5px; }

.workout-form { display:flex; flex-direction:column; gap: 12px; }
.workout-type-row { display:flex; gap: 8px; flex-wrap:wrap; }
.workout-type-chip { display:flex; align-items:center; gap:5px; border:1px solid var(--border); background:#F7F9F2; color:var(--ink-soft); padding:8px 12px; border-radius:999px; font-size:12px; font-weight:700; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease; }
.workout-type-chip.on { background: var(--ink); color:#F4F6EE; border-color: var(--ink); }
.workout-field-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.workout-entry-list { list-style:none; margin: 14px 0 0; padding:0; display:flex; flex-direction:column; gap: 8px; }
.workout-entry { display:flex; align-items:center; gap: 9px; background:#F7F9F2; border-radius: 12px; padding: 10px 12px; font-size: 12.5px; }
.workout-entry-icon { color: var(--good); flex-shrink:0; }
.workout-entry-desc { flex:1; }
.workout-entry-delete { background:none; border:none; color:#B7C2AE; padding:2px; }
.workout-entry-delete:hover { color: var(--clay); }

.goal-field { margin-bottom: 14px; }
.goal-field label { display:block; }
.goal-field-label { font-size: 12.5px; font-weight: 700; color: var(--ink-soft); display:block; margin-bottom: 6px; }
.goal-field-input { display:flex; align-items:center; border: 1px solid var(--border); border-radius: 12px; background: #F7F9F2; overflow:hidden; }
.goal-field-input input { flex:1; border:none; background:transparent; padding: 10px 12px; font-size: 14px; color: var(--ink); }
.goal-field-input input:focus { outline: none; }
.goal-field-input select { flex:1; border:none; background:transparent; padding: 10px 12px; font-size: 13.5px; color: var(--ink); appearance: none; -webkit-appearance: none; }
.goal-field-input select:focus { outline: none; }
.goal-field-unit { padding: 0 12px; font-size: 12px; color: var(--ink-soft); font-weight: 600; }
.goal-field-hint { font-size: 11px; color: var(--ink-soft); margin-top: 4px; display:block; }
.suggest-hint { margin-top: 10px; line-height: 1.5; }

.modal-overlay { position:fixed; inset:0; background: rgba(32,43,34,0.45); display:flex; align-items:flex-end; justify-content:center; z-index: 50; }
.modal-panel { background: var(--bg); width:100%; max-width: 460px; max-height: 88vh; border-radius: 24px 24px 0 0; display:flex; flex-direction:column; animation: modalup 0.3s cubic-bezier(.25,.9,.35,1); }
@keyframes modalup { from { transform: translateY(30px); opacity:0; } to { transform: translateY(0); opacity:1; } }
.modal-header { display:flex; align-items:center; justify-content:space-between; padding: 16px 18px; border-bottom: 1px solid var(--border); }
.modal-body { overflow-y:auto; padding: 16px; display:flex; flex-direction:column; gap: 14px; -webkit-overflow-scrolling: touch; }
.modal-footer { padding: 14px 18px; border-top: 1px solid var(--border); }

.toast {
  position: fixed; bottom: 92px; left: 50%; transform: translateX(-50%);
  max-width: 420px; width: calc(100% - 32px);
  background: var(--ink); color: #F4F6EE; border-radius: 14px; padding: 12px 14px;
  display:flex; align-items:center; justify-content:space-between; gap: 10px;
  font-size: 12.5px; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
  animation: toastin 0.3s cubic-bezier(.25,.9,.35,1); z-index: 60;
}
.toast button { background:none; border:none; color: #D8DED2; display:flex; }
.toast-good { background: var(--good); }
.toast-warn { background: var(--clay); }
@keyframes toastin { from { opacity:0; transform: translate(-50%, 10px); } to { opacity:1; transform: translate(-50%, 0); } }

.tabbar {
  position: sticky; bottom: 0; left:0; right:0;
  background: rgba(255,255,255,0.9); backdrop-filter: blur(10px);
  border-top: 1px solid var(--border);
  display:grid; grid-template-columns: repeat(5,1fr);
  padding: 8px 4px calc(8px + env(safe-area-inset-bottom));
  position: relative;
}
.tabbar-indicator { position:absolute; top: 4px; height: calc(100% - 8px); width: 20%; background: #EAF0E2; border-radius: 14px; transition: left 0.35s cubic-bezier(.25,.9,.35,1); z-index:0; }
.tabbar-btn { position: relative; z-index: 1; background: none; border: none; color: var(--ink-soft); display:flex; flex-direction:column; align-items:center; gap: 3px; padding: 7px 2px; font-size: 9.5px; font-weight: 700; transition: color 0.2s ease; }
.tabbar-btn.active { color: var(--good); }

@media (min-width: 461px) {
  .napp { border-left: 1px solid var(--border); border-right: 1px solid var(--border); min-height: 100vh; }
}
`;
