import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Flame, Droplets, Plus, Sparkles, Loader2, Trash2, ChevronLeft, ChevronRight,
  Target, TrendingUp, X, UtensilsCrossed, Settings2, Leaf, Sunrise, Share2,
  Scale, Dumbbell, User, SlidersHorizontal, Bike, Activity, Calendar, Pencil, Download, Upload,
  Moon, Sun, History, RotateCcw,
} from "lucide-react";
import {
  ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, LineChart, Line,
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
function round1(n) {
  return Math.round(n * 10) / 10;
}
function dayTotals(day) {
  const raw = day.entries.reduce(
    (acc, e) => ({
      calories: acc.calories + (e.calories || 0),
      protein: acc.protein + (e.protein || 0),
      carbs: acc.carbs + (e.carbs || 0),
      fat: acc.fat + (e.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  return {
    calories: Math.round(raw.calories),
    protein: round1(raw.protein),
    carbs: round1(raw.carbs),
    fat: round1(raw.fat),
  };
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
// Expands any inclusive date range into per-day rows, in the same shape
// weekRows() produces. Used by the Monthly view to drill a week bucket down
// into its individual days without duplicating the row-building logic.
function dayRowsBetween(data, startKey, endKey) {
  const rows = [];
  let k = startKey;
  let guard = 0;
  while (k <= endKey && guard < 400) {
    const day = getDay(data, k);
    rows.push({ key: k, date: keyToDate(k), totals: dayTotals(day), water: day.water, weight: day.weight, workouts: day.workouts });
    k = addDays(k, 1);
    guard++;
  }
  return rows;
}

// Normalizes an exercise name for matching ("Bench Press " and "bench press"
// are the same movement).
function exerciseKey(name) {
  return String(name || "").toLowerCase().trim().replace(/\s+/g, " ");
}

// Finds the most recent previous time this exercise was logged, strictly
// before `beforeKey`. Powers the smart recommendation shown when the user
// starts typing an exercise they've done before.
function lastExerciseInstance(data, name, beforeKey) {
  const target = exerciseKey(name);
  if (!target) return null;
  const keys = Object.keys(data.days || {})
    .filter((k) => k < beforeKey)
    .sort()
    .reverse();
  for (const k of keys) {
    const day = getDay(data, k);
    // Within a day, the last matching entry is the most recent one.
    for (let i = day.workouts.length - 1; i >= 0; i--) {
      const w = day.workouts[i];
      if (w.type === "weights" && exerciseKey(w.exercise) === target) {
        return { ...w, dayKey: k, date: keyToDate(k) };
      }
    }
  }
  return null;
}

// Every past session of a given movement, newest first. Powers the
// expandable per-movement history so the user can check their progression,
// not just the single most recent session.
function exerciseHistory(data, name, beforeKey, limit = 8) {
  const target = exerciseKey(name);
  if (!target) return [];
  const out = [];
  const keys = Object.keys(data.days || {})
    .filter((k) => k < beforeKey)
    .sort()
    .reverse();
  for (const k of keys) {
    const day = getDay(data, k);
    for (let i = day.workouts.length - 1; i >= 0; i--) {
      const w = day.workouts[i];
      if (w.type === "weights" && exerciseKey(w.exercise) === target) {
        out.push({ ...w, dayKey: k, date: keyToDate(k) });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

// Compares two sessions' top-set load so the UI can show progression at a
// glance. Returns null when either side has no usable weight.
function loadDelta(current, previous) {
  const a = parseFloat(current?.weight);
  const b = parseFloat(previous?.weight);
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((a - b) * 10) / 10;
}

// Every distinct weights-exercise name the user has logged, most recent
// first — drives the quick-pick suggestions in the workout form.
function knownExercises(data, limit = 12) {
  const seen = new Map();
  const keys = Object.keys(data.days || {}).sort().reverse();
  for (const k of keys) {
    for (const w of getDay(data, k).workouts) {
      if (w.type !== "weights" || !w.exercise) continue;
      const ek = exerciseKey(w.exercise);
      if (!seen.has(ek)) seen.set(ek, w.exercise.trim());
      if (seen.size >= limit) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

// Buckets every logged day (from the first day with any activity, up to
// today) into 7-day windows for the Monthly view.
function firstActiveKey(data) {
  const keys = Object.keys(data.days || {})
    .filter((k) => {
      const d = getDay(data, k);
      return d.entries.length > 0 || d.water > 0 || d.weight != null || d.workouts.length > 0;
    })
    .sort();
  return keys.length ? keys[0] : null;
}
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
  theme: "light", // "light" | "dark"
};

/* ---------------------------------------------------------------------- */
/*  Theme                                                                  */
/* ---------------------------------------------------------------------- */

// Recharts renders to SVG and can't read CSS custom properties, so chart
// colors have to be passed as real values. These mirror the CSS variables
// defined for each theme below, and are chosen to hold a legible contrast
// ratio against their own theme's surface color.
const CHART_COLORS = {
  light: { grid: "#E1E4D8", axis: "#5B6B5A", line: "#3E7CB1", dot: "#3E7CB1", tooltipBg: "#FFFFFF", tooltipBorder: "#E1E4D8", tooltipText: "#202B22" },
  dark: { grid: "#2F3A31", axis: "#9DB09C", line: "#7FB5DE", dot: "#7FB5DE", tooltipBg: "#1B241D", tooltipBorder: "#2F3A31", tooltipText: "#E8EDE4" },
};
function chartColors(theme) {
  return CHART_COLORS[theme === "dark" ? "dark" : "light"];
}

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
/*  Food search: a curated local index (values always per 100g/100ml) used  */
/*  to power the search-and-pick flow. The deployed app backs this with a   */
/*  live USDA FoodData Central lookup instead — see searchFoods() below.    */
/* ---------------------------------------------------------------------- */

const FOOD_DB = [
  { names: ["egg", "eggs", "boiled egg", "fried egg", "scrambled egg"], gramsEach: 50, cal: 156, p: 12.6, c: 1.2, f: 10.6 },
  { names: ["rice", "white rice", "cooked rice", "steamed rice"], cal: 130, p: 2.7, c: 28, f: 0.3 },
  { names: ["brown rice"], cal: 123, p: 2.6, c: 26, f: 1 },
  { names: ["chicken breast", "chicken", "grilled chicken", "cooked chicken"], cal: 165, p: 31, c: 0, f: 3.6 },
  { names: ["milk", "whole milk"], cal: 61, p: 3.2, c: 4.8, f: 3.3 },
  { names: ["skim milk", "low fat milk"], cal: 34, p: 3.4, c: 5, f: 0.1 },
  { names: ["banana", "bananas"], gramsEach: 118, cal: 89, p: 1.1, c: 22.8, f: 0.3 },
  { names: ["apple", "apples"], gramsEach: 182, cal: 52, p: 0.3, c: 13.8, f: 0.2 },
  { names: ["bread", "white bread", "slice of bread", "toast"], gramsEach: 30, cal: 265, p: 9, c: 49, f: 3.2 },
  { names: ["oats", "oatmeal", "rolled oats"], cal: 389, p: 16.9, c: 66, f: 6.9 },
  { names: ["salmon", "grilled salmon", "cooked salmon"], cal: 208, p: 20, c: 0, f: 13 },
  { names: ["broccoli"], cal: 34, p: 2.8, c: 7, f: 0.4 },
  { names: ["potato", "potatoes", "baked potato", "boiled potato"], cal: 87, p: 1.9, c: 20, f: 0.1 },
  { names: ["sweet potato"], cal: 86, p: 1.6, c: 20, f: 0.1 },
  { names: ["pasta", "cooked pasta", "spaghetti"], cal: 158, p: 5.8, c: 31, f: 0.9 },
  { names: ["yogurt", "plain yogurt"], cal: 61, p: 3.5, c: 4.7, f: 3.3 },
  { names: ["greek yogurt", "nonfat greek yogurt"], cal: 59, p: 10, c: 3.6, f: 0.4 },
  { names: ["cheese", "cheddar cheese", "cheddar"], cal: 402, p: 25, c: 1.3, f: 33 },
  { names: ["almonds"], cal: 579, p: 21, c: 22, f: 50 },
  { names: ["peanut butter"], cal: 588, p: 25, c: 20, f: 50 },
  { names: ["olive oil"], cal: 884, p: 0, c: 0, f: 100 },
  { names: ["avocado", "avocados"], gramsEach: 150, cal: 160, p: 2, c: 8.5, f: 14.7 },
  { names: ["orange", "oranges"], gramsEach: 131, cal: 47, p: 0.9, c: 11.8, f: 0.1 },
  { names: ["tomato", "tomatoes"], gramsEach: 123, cal: 18, p: 0.9, c: 3.9, f: 0.2 },
  { names: ["spinach"], cal: 23, p: 2.9, c: 3.6, f: 0.4 },
  { names: ["tuna", "canned tuna", "light tuna", "tuna in water"], cal: 116, p: 25.5, c: 0, f: 0.8 },
  { names: ["white tuna", "albacore tuna", "albacore"], cal: 127, p: 25.7, c: 0, f: 2.9 },
  { names: ["beef", "ground beef", "lean beef"], cal: 250, p: 26, c: 0, f: 17 },
  { names: ["black coffee", "coffee"], cal: 1, p: 0.1, c: 0, f: 0 },
  { names: ["butter"], cal: 717, p: 0.9, c: 0.1, f: 81 },
  { names: ["honey"], cal: 304, p: 0.3, c: 82, f: 0 },
  { names: ["turkey breast", "turkey", "cooked turkey"], cal: 135, p: 30, c: 0, f: 1 },
  { names: ["shrimp", "prawns", "cooked shrimp"], cal: 99, p: 24, c: 0.2, f: 0.3 },
  { names: ["quinoa", "cooked quinoa"], cal: 120, p: 4.4, c: 21.3, f: 1.9 },
  { names: ["lentils", "cooked lentils"], cal: 116, p: 9, c: 20, f: 0.4 },
  { names: ["black beans", "cooked black beans"], cal: 132, p: 8.9, c: 24, f: 0.5 },
  { names: ["chickpeas", "cooked chickpeas", "garbanzo beans"], cal: 164, p: 8.9, c: 27, f: 2.6 },
  { names: ["whole wheat bread", "wholemeal bread"], gramsEach: 28, cal: 247, p: 13, c: 41, f: 3.5 },
  { names: ["cottage cheese"], cal: 98, p: 11, c: 3.4, f: 4.3 },
  { names: ["whey protein", "protein powder", "protein shake"], gramsEach: 30, cal: 400, p: 80, c: 10, f: 5 },
];

function normName(s) {
  return s.toLowerCase().trim().replace(/[.,!]/g, "");
}

// Calls the deployed backend (api/food-search.js), which proxies USDA
// FoodData Central — the full 400k+ generic-food database, not just the
// curated local list the in-chat demo version uses.
async function searchFoods(query) {
  const q = query.trim();
  if (q.length < 2) return [];
  let res;
  try {
    res = await fetch(`/api/food-search?q=${encodeURIComponent(q)}`);
  } catch (e) {
    return [];
  }
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({ results: [] }));
  return json.results || [];
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

// AI fallback for vague/whole-meal descriptions the search box can't cleanly
// resolve to one food (e.g. "chicken shawarma plate", "a bowl of pho").
// This is the ONLY remaining use of the LLM for nutrition estimation — it
// runs automatically when the person submits free text instead of picking a
// search result, with no separate "AI estimate" button to press.
async function estimateNutrition(text) {
  const system =
    "You are a careful nutrition-estimation engine inside a food-logging app. " +
    "Given a free-text description of a meal, snack, or dish (often a prepared/composite " +
    "dish rather than a single raw ingredient), respond with ONLY raw JSON " +
    "(no markdown fences, no prose, no explanation) in exactly this shape: " +
    '{"items":[{"name":"string","calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}]}. ' +
    "Split the description into distinct components when that's clearer (e.g. a plate with rice, meat, " +
    "and salad), otherwise return it as one item. Use typical nutrition data and any stated or implied " +
    "portion sizes to give sensible estimates. Numbers only, no units inside numbers. " +
    "If the text isn't food at all, return {\"items\":[]}.";
  const raw = await callClaude(system, text, 800);
  const clean = raw.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch (e) {
    throw new Error("the response wasn't valid JSON — try rephrasing what you ate.");
  }
  if (!parsed.items) throw new Error("unexpected response shape from the model.");
  return parsed.items.map((it) => ({
    name: String(it.name || "Item").slice(0, 80),
    calories: Math.max(0, Math.round(Number(it.calories) || 0)),
    protein: Math.max(0, Math.round(Number(it.protein_g) || 0)),
    carbs: Math.max(0, Math.round(Number(it.carbs_g) || 0)),
    fat: Math.max(0, Math.round(Number(it.fat_g) || 0)),
  }));
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
function weeklyShareData(data, rows) {
  const daysWithData = rows.filter((r) => r.totals.calories > 0 || r.water > 0);
  const avg = (fn) => (daysWithData.length ? Math.round(daysWithData.reduce((s, r) => s + fn(r), 0) / daysWithData.length) : 0);
  const avgCalories = avg((r) => r.totals.calories);
  const avgProtein = avg((r) => r.totals.protein);
  const avgCarbs = avg((r) => r.totals.carbs);
  const avgFat = avg((r) => r.totals.fat);
  const avgWater = avg((r) => r.water);
  const weighIns = rows.filter((r) => r.weight != null);
  const weightChange = weighIns.length >= 2 ? Math.round((weighIns[weighIns.length - 1].weight - weighIns[0].weight) * 10) / 10 : null;
  const last = rows[rows.length - 1];
  return {
    title: "Weekly Summary",
    subtitle: `${MONTHS[rows[0].date.getMonth()]} ${rows[0].date.getDate()} – ${MONTHS[last.date.getMonth()]} ${last.date.getDate()}`,
    rows: [
      { label: "Weight change", value: weightChange != null ? `${weightChange > 0 ? "+" : ""}${weightChange} kg` : "Not enough data" },
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
      <div className="water-presets">
        {WATER_PRESETS.map((amt) => (
          <button key={amt} className="chip" onClick={() => onQuickAdd(amt)}><Plus size={13} /> {formatMl(amt)}</button>
        ))}
      </div>
      <button className="chip chip-ghost chip-custom" onClick={() => setCustomOpen((v) => !v)}><Plus size={13} /> Custom amount</button>
      {customOpen && (
        <form className="custom-water-form" onSubmit={(e) => { e.preventDefault(); const n = parseInt(customVal, 10); if (n > 0) { onCustomAdd(n); setCustomVal(""); setCustomOpen(false); } }}>
          <input autoFocus type="number" inputMode="numeric" placeholder="Amount in ml" value={customVal} onChange={(e) => setCustomVal(e.target.value)} className="text-input" />
          <button type="submit" className="btn-primary btn-small">Add</button>
        </form>
      )}
    </div>
  );
}

function WeightWidget({ dayKey, day, updateDay, showToast }) {
  const [weightInput, setWeightInput] = useState(day.weight != null ? String(day.weight) : "");
  const [editing, setEditing] = useState(day.weight == null);
  useEffect(() => {
    // Reset local UI state when navigating to a different day, without
    // unmounting/remounting the component itself.
    setWeightInput(day.weight != null ? String(day.weight) : "");
    setEditing(day.weight == null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);
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

function MealLogger({ dayKey, day, updateDay, showToast }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [portion, setPortion] = useState("100");
  const submittingRef = useRef(false); // synchronous guard — React state updates are batched/async, so a rapid double-fire (double-tap, duplicate event, etc.) can read stale `busy` before a re-render happens. A ref updates instantly and closes that race condition.
  const searchTimerRef = useRef(null);

  useEffect(() => {
    // Reset everything when navigating to a different day, without
    // unmounting/remounting the component (that remount-on-key-change was
    // what caused Safari to occasionally leave a stale, non-interactive
    // painted frame behind when rapidly tapping the day arrows).
    setText("");
    setResults([]);
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  useEffect(() => {
    if (selected) return; // portion picker is open — don't keep searching underneath it
    clearTimeout(searchTimerRef.current);
    const q = text.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchFoods(q);
        setResults(r);
      } catch (e) {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(searchTimerRef.current);
  }, [text, selected]);

  function pickResult(r) {
    setSelected(r);
    setPortion(r.gramsEach ? String(r.gramsEach) : "100");
  }

  function addSelectedPortion() {
    const grams = Math.max(0, parseFloat(portion) || 0);
    if (grams <= 0) {
      showToast("Enter a portion amount first.", "warn");
      return;
    }
    const mult = grams / 100;
    const entry = {
      id: uid(),
      time: timeNow(),
      name: selected.name,
      calories: Math.max(0, Math.round(selected.cal * mult)),
      protein: Math.max(0, round1(selected.protein * mult)),
      carbs: Math.max(0, round1(selected.carbs * mult)),
      fat: Math.max(0, round1(selected.fat * mult)),
    };
    updateDay((d) => {
      const tail = d.entries.slice(-1);
      const isDuplicate = tail.length === 1 && tail[0].name === entry.name && tail[0].calories === entry.calories && tail[0].protein === entry.protein && tail[0].carbs === entry.carbs && tail[0].fat === entry.fat;
      return isDuplicate ? d : { ...d, entries: [...d.entries, entry] };
    });
    showToast(`Logged ${entry.name} · ${entry.calories} kcal`, "good");
    setText("");
    setResults([]);
    setSelected(null);
  }

  async function handleLogFreeform() {
    const trimmed = text.trim();
    if (!trimmed || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const items = await estimateNutrition(trimmed);
      if (!items.length) {
        showToast("Couldn't find anything to log there — try describing a food or drink.", "warn");
      } else {
        const time = timeNow();
        const newEntries = items.map((it) => ({ id: uid(), time, ...it }));
        updateDay((d) => {
          // Defensive dedupe: if the most recently logged entries already
          // exactly match what we're about to add, skip — this makes a
          // duplicate submission structurally impossible to actually save,
          // regardless of what UI-level glitch might trigger it.
          const tail = d.entries.slice(-newEntries.length);
          const isDuplicate =
            tail.length === newEntries.length &&
            tail.every((e, i) => e.name === newEntries[i].name && e.calories === newEntries[i].calories && e.protein === newEntries[i].protein && e.carbs === newEntries[i].carbs && e.fat === newEntries[i].fat);
          return isDuplicate ? d : { ...d, entries: [...d.entries, ...newEntries] };
        });
        const kcal = items.reduce((s, i) => s + i.calories, 0);
        showToast(`Logged ${items.length > 1 ? `${items.length} items` : items[0].name} · ${kcal} kcal`, "good");
        setText("");
        setResults([]);
      }
    } catch (e) {
      showToast(e?.message ? `Couldn't log that meal — ${e.message}` : "Couldn't estimate that meal — check your connection and try again.", "warn");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  if (selected) {
    const grams = Math.max(0, parseFloat(portion) || 0);
    const mult = grams / 100;
    const approxEach = selected.gramsEach ? Math.round((grams / selected.gramsEach) * 10) / 10 : null;
    return (
      <div className="card">
        <button className="link-btn portion-back" onClick={() => setSelected(null)}><ChevronLeft size={14} /> Back to results</button>
        <div className="portion-food-name">{selected.name}</div>
        <div className="portion-input-row">
          <input type="number" inputMode="decimal" className="text-input" value={portion} onChange={(e) => setPortion(e.target.value)} autoFocus />
          <span className="goal-field-unit">g</span>
        </div>
        {approxEach != null && <span className="goal-field-hint">≈ {approxEach} {selected.name.toLowerCase()}{approxEach === 1 ? "" : "s"}</span>}
        <div className="portion-preview">
          <span className="portion-preview-kcal">{Math.round(selected.cal * mult)} kcal</span>
          <span>{round1(selected.protein * mult)}g protein · {round1(selected.carbs * mult)}g carbs · {round1(selected.fat * mult)}g fat</span>
        </div>
        <button className="btn-primary" onClick={addSelectedPortion}><Plus size={16} /> Add to log</button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title"><UtensilsCrossed size={15} /> Log a meal or snack</div>
      <textarea className="text-area" placeholder="Search a food (e.g. chicken breast) — or describe a whole meal like 'chicken shawarma plate'" value={text} onChange={(e) => setText(e.target.value)} rows={2} />
      {searching && <div className="food-searching"><Loader2 size={13} className="spin" /> Searching…</div>}
      {!searching && results.length > 0 && (
        <ul className="food-results">
          {results.map((r) => (
            <li key={r.id}>
              <button onClick={() => pickResult(r)}>
                <span className="food-result-name">{r.name}</span>
                <span className="food-result-kcal">{Math.round(r.cal)} kcal/100g</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="btn-primary" onClick={handleLogFreeform} disabled={busy || !text.trim()}>
        {busy ? <><Loader2 size={16} className="spin" /> Estimating…</> : <><Plus size={16} /> Log it</>}
      </button>
    </div>
  );
}

function WorkoutStatusBadge({ day, isToday = true, onOpenWorkout }) {
  const has = day.workouts.length > 0;
  const when = isToday ? "today" : "this day";
  return (
    <button className={`workout-status ${has ? "on" : ""}`} onClick={onOpenWorkout}>
      <Dumbbell size={16} />
      <span>{has ? `${day.workouts.length} exercise${day.workouts.length > 1 ? "s" : ""} logged ${when}` : `No workout logged ${when}`}</span>
      <ChevronRight size={15} className="workout-status-chevron" />
    </button>
  );
}

// A labelled numeric/text field. Labels are always visible (rather than
// relying on placeholders that vanish on focus) so the form stays readable
// once values are entered, and each control meets a 44px touch target.
function WorkoutField({ label, unit, value, onChange, type = "text", inputMode, placeholder }) {
  const id = `wf-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="wfield">
      <label className="wfield-label" htmlFor={id}>{label}</label>
      <div className="wfield-input-wrap">
        <input
          id={id}
          className="wfield-input"
          type={type}
          inputMode={inputMode}
          placeholder={placeholder}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit && <span className="wfield-unit">{unit}</span>}
      </div>
    </div>
  );
}

function WorkoutForm({ dayKey, data, onAdd }) {
  const [type, setType] = useState("weights");
  const [fields, setFields] = useState({});

  useEffect(() => {
    setType("weights");
    setFields({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey]);

  function set(k, v) { setFields((f) => ({ ...f, [k]: v })); }

  // Full history for this movement, newest first. `lastTime` is simply the
  // head of that list, so the recommendation and the history view can never
  // disagree with each other.
  const history = useMemo(
    () => (type === "weights" && fields.exercise ? exerciseHistory(data, fields.exercise, dayKey) : []),
    [data, type, fields.exercise, dayKey]
  );
  const lastTime = history[0] || null;
  const [historyOpen, setHistoryOpen] = useState(false);
  const suggestions = useMemo(() => (type === "weights" ? knownExercises(data) : []), [data, type]);

  // Collapse the history panel whenever the movement changes, so it never
  // shows one exercise's history under another's name.
  useEffect(() => { setHistoryOpen(false); }, [fields.exercise, type]);

  function applyLastTime() {
    if (!lastTime) return;
    setFields((f) => ({
      ...f,
      exercise: lastTime.exercise,
      weight: lastTime.weight ?? "",
      reps: lastTime.reps ?? "",
      sets: lastTime.sets ?? "",
    }));
  }

  function handleAdd() {
    if (type === "weights" && !fields.exercise) return;
    onAdd({ id: uid(), type, ...fields });
    setFields({});
  }

  const currentLabel = WORKOUT_TYPES.find((t) => t.value === type)?.label.toLowerCase();
  const canAdd = type !== "weights" || Boolean(fields.exercise);

  return (
    <div className="workout-form">
      <div className="workout-type-row" role="group" aria-label="Workout type">
        {WORKOUT_TYPES.map((t) => {
          const Icon = t.icon;
          const on = type === t.value;
          return (
            <button
              key={t.value}
              className={`workout-type-chip ${on ? "on" : ""}`}
              onClick={() => { setType(t.value); setFields({}); }}
              aria-pressed={on}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {type === "weights" && (
        <>
          <WorkoutField
            label="Exercise"
            placeholder="e.g. Bench press"
            value={fields.exercise}
            onChange={(v) => set("exercise", v)}
          />

          {suggestions.length > 0 && !fields.exercise && (
            <div className="exercise-suggestions">
              <span className="exercise-suggestions-label">Recent</span>
              <div className="exercise-suggestion-chips">
                {suggestions.map((name) => (
                  <button key={name} className="exercise-chip" onClick={() => set("exercise", name)}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {lastTime && (
            <div className="last-time-card">
              <div className="last-time-head">
                <History size={14} />
                <span>Last time · {MONTHS[lastTime.date.getMonth()]} {lastTime.date.getDate()}</span>
              </div>
              <div className="last-time-stats">
                <span><strong>{lastTime.weight || "—"}</strong> kg</span>
                <span><strong>{lastTime.reps || "—"}</strong> reps</span>
                <span><strong>{lastTime.sets || "—"}</strong> sets</span>
              </div>
              <div className="last-time-actions">
                <button className="btn-ghost btn-small" onClick={applyLastTime}>
                  <RotateCcw size={13} /> Use these numbers
                </button>
                {history.length > 1 && (
                  <button
                    className="btn-ghost btn-small"
                    onClick={() => setHistoryOpen((o) => !o)}
                    aria-expanded={historyOpen}
                  >
                    <History size={13} /> {historyOpen ? "Hide" : `History (${history.length})`}
                  </button>
                )}
              </div>

              {historyOpen && history.length > 1 && (
                <ul className="exercise-history">
                  {history.map((h, i) => {
                    const delta = loadDelta(h, history[i + 1]);
                    return (
                      <li key={`${h.dayKey}-${h.id}`} className="exercise-history-row">
                        <span className="exercise-history-date">
                          {MONTHS[h.date.getMonth()]} {h.date.getDate()}
                        </span>
                        <span className="exercise-history-load">
                          {h.weight || "—"} kg × {h.reps || "—"}
                          {h.sets ? ` × ${h.sets}` : ""}
                        </span>
                        {delta !== null && delta !== 0 && (
                          <span className={`exercise-history-delta ${delta > 0 ? "up" : "down"}`}>
                            {delta > 0 ? "+" : ""}{delta} kg
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <div className="wfield-row">
            <WorkoutField label="Weight" unit="kg" type="number" inputMode="decimal" value={fields.weight} onChange={(v) => set("weight", v)} />
            <WorkoutField label="Reps" type="number" inputMode="numeric" value={fields.reps} onChange={(v) => set("reps", v)} />
            <WorkoutField label="Sets" type="number" inputMode="numeric" value={fields.sets} onChange={(v) => set("sets", v)} />
          </div>
        </>
      )}

      {type === "treadmill" && (
        <div className="wfield-row">
          <WorkoutField label="Incline" unit="%" type="number" inputMode="decimal" value={fields.incline} onChange={(v) => set("incline", v)} />
          <WorkoutField label="Pace" placeholder="6:30/km" value={fields.pace} onChange={(v) => set("pace", v)} />
          <WorkoutField label="Time" unit="min" type="number" inputMode="numeric" value={fields.time} onChange={(v) => set("time", v)} />
        </div>
      )}

      {type === "cycling" && (
        <div className="wfield-row">
          <WorkoutField label="Pace" placeholder="28km/h" value={fields.pace} onChange={(v) => set("pace", v)} />
          <WorkoutField label="Time" unit="min" type="number" inputMode="numeric" value={fields.time} onChange={(v) => set("time", v)} />
          <WorkoutField label="Laps" type="number" inputMode="numeric" value={fields.laps} onChange={(v) => set("laps", v)} />
        </div>
      )}

      <button className="btn-primary" onClick={handleAdd} disabled={!canAdd}>
        <Plus size={16} /> Add {currentLabel}
      </button>
    </div>
  );
}
// Splits a logged entry into a bold movement name plus its supporting
// numbers, so the eye lands on the exercise first and the details second.
function workoutEntryParts(w) {
  if (w.type === "weights") {
    const detail = [
      w.weight ? `${w.weight} kg` : null,
      w.reps ? `${w.reps} reps` : null,
      w.sets ? `${w.sets} sets` : null,
    ].filter(Boolean).join(" · ");
    return { title: w.exercise || "Exercise", detail: detail || "No numbers logged" };
  }
  if (w.type === "treadmill") {
    const detail = [
      w.time ? `${w.time} min` : null,
      w.incline ? `${w.incline}% incline` : null,
      w.pace || null,
    ].filter(Boolean).join(" · ");
    return { title: "Treadmill", detail: detail || "No numbers logged" };
  }
  if (w.type === "cycling") {
    const detail = [
      w.time ? `${w.time} min` : null,
      w.laps ? `${w.laps} laps` : null,
      w.pace || null,
    ].filter(Boolean).join(" · ");
    return { title: "Cycling", detail: detail || "No numbers logged" };
  }
  return { title: "Workout", detail: describeWorkout(w) };
}

function WorkoutLogger({ dayKey, data, day, updateDay, showToast }) {
  function handleAdd(entry) {
    updateDay((d) => ({ ...d, workouts: [...d.workouts, entry] }));
    showToast("Workout logged", "good");
  }
  function handleRemove(id) {
    updateDay((d) => ({ ...d, workouts: d.workouts.filter((w) => w.id !== id) }));
  }
  return (
    <>
      <WorkoutForm dayKey={dayKey} data={data} onAdd={handleAdd} />
      {day.workouts.length > 0 && (
        <ul className="workout-entry-list">
          {day.workouts.map((w) => {
            const meta = WORKOUT_TYPES.find((t) => t.value === w.type);
            const Icon = meta?.icon || Dumbbell;
            const { title, detail } = workoutEntryParts(w);
            return (
              <li key={w.id} className="workout-entry">
                <Icon size={16} className="workout-entry-icon" />
                <div className="workout-entry-body">
                  <span className="workout-entry-title">{title}</span>
                  <span className="workout-entry-detail">{detail}</span>
                </div>
                <button
                  className="workout-entry-delete"
                  onClick={() => handleRemove(w.id)}
                  aria-label={`Delete ${title}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function CollapsibleSection({ title, icon: Icon, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card collapsible">
      <button className="collapsible-header" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="card-title collapsible-title"><Icon size={15} /> {title}</span>
        <ChevronRight size={16} className={`collapsible-chevron ${open ? "open" : ""}`} />
      </button>
      {open && <div className="collapsible-body">{children}</div>}
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

function CustomizeModal({ data, setData, showToast, onToggleTheme, onClose }) {
  const [form, setForm] = useState({ ...DEFAULT_PROFILE, ...data.profile });
  const fileInputRef = useRef(null);

  function handleExport() {
    const payload = { exportedAt: new Date().toISOString(), profile: data.profile, days: data.days };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sprout-backup-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast("Backup downloaded", "good");
  }
  function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== "object" || !parsed.days) {
          showToast("That doesn't look like a Sprout backup file.", "warn");
          return;
        }
        const ok = window.confirm("Importing will replace all your current logged data with this backup. Continue?");
        if (!ok) return;
        setData({ profile: { ...DEFAULT_PROFILE, ...(parsed.profile || {}) }, days: parsed.days || {} });
        showToast("Backup restored", "good");
        onClose();
      } catch (err) {
        showToast("Couldn't read that file — make sure it's a Sprout backup JSON.", "warn");
      }
    };
    reader.readAsText(file);
  }

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
          <div className="card">
            <div className="card-title">{data.profile.theme === "dark" ? <Moon size={15} /> : <Sun size={15} />} Appearance</div>
            <div className="theme-switch" role="group" aria-label="Color theme">
              {[
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
              ].map((opt) => {
                const OptIcon = opt.icon;
                const on = (data.profile.theme === "dark" ? "dark" : "light") === opt.value;
                return (
                  <button
                    key={opt.value}
                    className={`theme-switch-btn ${on ? "on" : ""}`}
                    aria-pressed={on}
                    onClick={() => { if (!on) onToggleTheme(); }}
                  >
                    <OptIcon size={15} /> {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card">
            <div className="card-title"><Download size={15} /> Backup & restore</div>
            <p className="tip-placeholder">
              Download everything you've logged as a file you can keep safe, or restore from a backup —
              worth doing before removing this app from your home screen or clearing browser data.
            </p>
            <div className="backup-actions">
              <button className="btn-ghost" onClick={handleExport}><Download size={14} /> Export backup</button>
              <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Import backup</button>
            </div>
            <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} style={{ display: "none" }} />
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

// Horizontal, swipeable strip of recent dates. Shows a fixed window of the
// last `days` dates ending today, auto-scrolls the active chip into view, and
// marks which days already have data so the user can spot gaps at a glance.
function DateScroller({ selectedKey, onSelect, data, days = 30 }) {
  const scrollerRef = useRef(null);
  const activeRef = useRef(null);

  const items = useMemo(() => {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const k = addDays(todayKey(), -i);
      const day = getDay(data, k);
      out.push({
        key: k,
        date: keyToDate(k),
        hasData: day.entries.length > 0 || day.water > 0 || day.weight != null || day.workouts.length > 0,
      });
    }
    return out;
  }, [data, days]);

  useEffect(() => {
    // Keep the selected date visible without yanking the whole page around.
    if (activeRef.current && scrollerRef.current) {
      activeRef.current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [selectedKey]);

  return (
    <div className="date-scroller" ref={scrollerRef} role="tablist" aria-label="Select a date">
      {items.map((it) => {
        const isSelected = it.key === selectedKey;
        const isToday = it.key === todayKey();
        return (
          <button
            key={it.key}
            ref={isSelected ? activeRef : null}
            role="tab"
            aria-selected={isSelected}
            aria-label={`${DOW_FULL[it.date.getDay()]}, ${MONTHS[it.date.getMonth()]} ${it.date.getDate()}${isToday ? " (today)" : ""}`}
            className={`date-chip ${isSelected ? "selected" : ""} ${isToday ? "is-today" : ""}`}
            onClick={() => onSelect(it.key)}
          >
            <span className="date-chip-dow">{DOW[it.date.getDay()]}</span>
            <span className="date-chip-num">{it.date.getDate()}</span>
            <span className={`date-chip-dot ${it.hasData ? "on" : ""}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

// The logged-meals list for a given day, with inline edit and delete.
// Lifted out of the old Log tab so the Today view can own it directly.
function MealList({ day, updateDay, showToast, isToday }) {
  const [editingId, setEditingId] = useState(null);
  const [editVals, setEditVals] = useState({});

  function removeEntry(id) {
    updateDay((dd) => ({ ...dd, entries: dd.entries.filter((e) => e.id !== id) }));
    setEditingId(null);
    showToast("Entry removed", "neutral");
  }
  function startEdit(e) {
    setEditingId(e.id);
    setEditVals({ calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat });
  }
  function saveEdit(id) {
    updateDay((dd) => ({
      ...dd,
      entries: dd.entries.map((e) =>
        e.id === id
          ? {
              ...e,
              ...Object.fromEntries(
                Object.entries(editVals).map(([k, v]) => [
                  k,
                  k === "calories" ? Math.max(0, Math.round(parseFloat(v) || 0)) : round1(Math.max(0, parseFloat(v) || 0)),
                ])
              ),
            }
          : e
      ),
    }));
    setEditingId(null);
    showToast("Entry updated", "good");
  }

  if (day.entries.length === 0) {
    return (
      <div className="empty-state">
        <UtensilsCrossed size={26} />
        <p>Nothing logged {isToday ? "yet today" : "this day"}.</p>
        <span>Use the box above to add something.</span>
      </div>
    );
  }

  return (
    <ul className="entry-list">
      {[...day.entries].reverse().map((e) => (
        <li key={e.id} className="entry-card">
          {editingId === e.id ? (
            <div className="entry-edit-grid">
              {["calories", "protein", "carbs", "fat"].map((f) => (
                <label key={f} className="entry-edit-field">
                  <span>{f}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editVals[f]}
                    onChange={(ev) => setEditVals((v) => ({ ...v, [f]: ev.target.value }))}
                  />
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
                <button className="entry-action-btn" onClick={() => startEdit(e)} aria-label={`Edit ${e.name}`}><Pencil size={15} /></button>
                <button className="entry-action-btn" onClick={() => removeEntry(e.id)} aria-label={`Delete ${e.name}`}><Trash2 size={15} /></button>
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function TodayTab({ data, setData, showToast, goWorkout, onOpenCustomize, onToggleTheme }) {
  // The whole page is driven by this one piece of state: every widget below
  // reads and writes the selected day, so navigating dates updates all stats
  // together rather than each widget tracking its own offset.
  const [selectedKey, setSelectedKey] = useState(todayKey());
  const key = selectedKey;
  const day = getDay(data, key);
  const totals = dayTotals(day);
  const isToday = key === todayKey();
  const selDate = keyToDate(key);
  const now = new Date();
  const isDark = data.profile.theme === "dark";

  function updateDay(mutator) {
    setData((prev) => {
      const d = getDay(prev, key);
      return { ...prev, days: { ...prev.days, [key]: mutator(d) } };
    });
  }
  async function handleShareDay() {
    try {
      const canvas = await renderShareCard(dailyShareData(key, day, totals, data.profile));
      const label = isToday ? "Today" : `${DOW[selDate.getDay()]}, ${MONTHS[selDate.getMonth()]} ${selDate.getDate()}`;
      const result = await shareCardImage(canvas, `sprout-${key}`, `Sprout — ${label}`);
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
          <div className="date-line">
            {isToday
              ? `${DOW_FULL[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`
              : `Viewing ${DOW_FULL[selDate.getDay()]}, ${MONTHS[selDate.getMonth()]} ${selDate.getDate()}`}
          </div>
        </div>
        <div className="today-header-actions">
          <button
            className="icon-btn"
            onClick={onToggleTheme}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            title={isDark ? "Light mode" : "Dark mode"}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="icon-btn" onClick={onOpenCustomize} aria-label="Customize goals"><SlidersHorizontal size={16} /></button>
          <button className="icon-btn" onClick={handleShareDay} aria-label="Share this day's summary"><Share2 size={16} /></button>
        </div>
      </div>

      <DateScroller selectedKey={key} onSelect={setSelectedKey} data={data} />

      {!isToday && (
        <button className="back-to-today" onClick={() => setSelectedKey(todayKey())}>
          <RotateCcw size={13} /> Back to today
        </button>
      )}

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

      <WeightWidget dayKey={key} day={day} updateDay={updateDay} showToast={showToast} />

      <WorkoutStatusBadge day={day} isToday={isToday} onOpenWorkout={goWorkout} />

      <MealLogger dayKey={key} day={day} updateDay={updateDay} showToast={showToast} />

      <div className="meals-section">
        <div className="card-title meals-section-title">
          <UtensilsCrossed size={15} /> {isToday ? "Today's meals" : "Meals this day"}
          {day.entries.length > 0 && <span className="meals-count">{totals.calories.toLocaleString()} kcal</span>}
        </div>
        <MealList day={day} updateDay={updateDay} showToast={showToast} isToday={isToday} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tab: Weekly                                                            */
/* ---------------------------------------------------------------------- */

function WeeklyTab({ data, showToast }) {
  const C = chartColors(data.profile.theme);
  const first = useMemo(() => firstActiveKey(data), [data]);
  const numDays = useMemo(() => {
    if (!first) return 7;
    const days = Math.round((keyToDate(todayKey()) - keyToDate(first)) / 86400000) + 1;
    return Math.max(1, Math.min(7, days));
  }, [first]);
  const rows = useMemo(() => weekRows(data, numDays), [data, numDays]);

  const daysWithData = rows.filter((r) => r.totals.calories > 0 || r.water > 0);
  const avg = (fn) => (daysWithData.length ? Math.round(daysWithData.reduce((s, r) => s + fn(r), 0) / daysWithData.length) : 0);
  const avgCalories = avg((r) => r.totals.calories);
  const avgProtein = avg((r) => r.totals.protein);
  const avgCarbs = avg((r) => r.totals.carbs);
  const avgFat = avg((r) => r.totals.fat);
  const avgWater = avg((r) => r.water);
  const weighIns = rows.filter((r) => r.weight != null);
  const weightChange = weighIns.length >= 2 ? Math.round((weighIns[weighIns.length - 1].weight - weighIns[0].weight) * 10) / 10 : null;

  async function handleShareWeek() {
    try {
      const canvas = await renderShareCard(weeklyShareData(data, rows));
      const result = await shareCardImage(canvas, "sprout-weekly", "Sprout — Weekly Summary");
      if (result === "downloaded") showToast("Image saved — attach it to your message", "good");
    } catch (e) {
      showToast("Couldn't generate the image — try again.", "warn");
    }
  }

  if (!first) {
    return (
      <div className="tab-panel">
        <div className="empty-state">
          <TrendingUp size={26} />
          <p>No data yet.</p>
          <span>Log a meal, water, or weight on Today to start tracking your week.</span>
        </div>
      </div>
    );
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
      </div>

      <div className="card">
        <div className="card-title"><Scale size={15} /> Weight this week</div>
        {weighIns.length > 0 ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={rows.map((r) => ({ label: DOW[r.date.getDay()], weight: r.weight }))} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 5" stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} />
                <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} width={34} />
                <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${C.tooltipBorder}`, background: C.tooltipBg, color: C.tooltipText, fontSize: 12 }} labelStyle={{ color: C.tooltipText }} itemStyle={{ color: C.tooltipText }} />
                <Line type="monotone" dataKey="weight" stroke={C.line} strokeWidth={2.5} dot={{ r: 4, fill: C.dot }} connectNulls />
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
  const [expandedWeek, setExpandedWeek] = useState(null);
  const C = chartColors(data.profile.theme);
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

  const weighInBuckets = buckets.filter((b) => b.weightChange != null);
  const totalWeightChange = weighInBuckets.length ? Math.round(weighInBuckets.reduce((s, b) => s + b.weightChange, 0) * 10) / 10 : null;

  return (
    <div className="tab-panel">
      <div className="card">
        <div className="card-title"><Scale size={15} /> Weight by week</div>
        {weighInBuckets.length > 0 ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={buckets.map((b, i) => ({ label: `Wk ${i + 1}`, weight: b.endWeight }))} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 5" stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} width={34} />
                <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${C.tooltipBorder}`, background: C.tooltipBg, color: C.tooltipText, fontSize: 12 }} labelStyle={{ color: C.tooltipText }} itemStyle={{ color: C.tooltipText }} />
                <Line type="monotone" dataKey="weight" stroke={C.line} strokeWidth={2.5} dot={{ r: 4, fill: C.dot }} connectNulls />
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
          const isExpanded = expandedWeek === b.startKey;
          const dayRows = isExpanded ? dayRowsBetween(data, b.startKey, b.endKey) : [];
          return (
            <div key={b.startKey} className={`week-day-card week-card-clickable ${isExpanded ? "expanded" : ""}`}>
              <button
                className="week-card-toggle"
                onClick={() => setExpandedWeek(isExpanded ? null : b.startKey)}
                aria-expanded={isExpanded}
                aria-label={`Week ${weekNum} details`}
              >
                <div className="week-day-top">
                  <div className="week-day-date">
                    <span className="week-day-dow">Week {weekNum}</span>
                    <span className="week-day-num">{MONTHS[b.startDate.getMonth()]} {b.startDate.getDate()} – {MONTHS[b.endDate.getMonth()]} {b.endDate.getDate()}</span>
                  </div>
                  <div className="week-day-badges">
                    {/* Counts DAYS the user trained, not individual exercises logged. */}
                    {b.workoutDays > 0 && (
                      <span className="badge badge-workout">
                        <Dumbbell size={11} /> {b.workoutDays} {b.workoutDays === 1 ? "day" : "days"}
                      </span>
                    )}
                    {b.endWeight != null && <span className="badge badge-weight"><Scale size={11} /> {b.endWeight} kg</span>}
                    <ChevronRight size={15} className={`week-card-chevron ${isExpanded ? "open" : ""}`} />
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
              </button>

              {isExpanded && (
                <div className="week-expand">
                  <div className="week-expand-title">Day by day</div>
                  {dayRows.map((r) => {
                    const dayPct = clampPct(data.profile.calorieGoal > 0 ? (r.totals.calories / data.profile.calorieGoal) * 100 : 0);
                    const rIsToday = r.key === todayKey();
                    const logged = r.totals.calories > 0 || r.water > 0 || r.weight != null || r.workouts.length > 0;
                    return (
                      <div key={r.key} className={`week-expand-day ${logged ? "" : "is-empty"}`}>
                        <div className="week-expand-day-top">
                          <span className="week-expand-day-name">
                            {rIsToday ? "Today" : `${DOW[r.date.getDay()]} ${MONTHS[r.date.getMonth()]} ${r.date.getDate()}`}
                          </span>
                          <span className="week-expand-day-kcal">{r.totals.calories.toLocaleString()} kcal</span>
                        </div>
                        <div className="week-day-bar-track week-expand-bar"><div className="week-day-bar-fill" style={{ width: `${dayPct}%` }} /></div>
                        <div className="week-day-macros week-expand-macros">
                          <span><i className="dot dot-clay" />{r.totals.protein}g</span>
                          <span><i className="dot dot-gold" />{r.totals.carbs}g</span>
                          <span><i className="dot dot-plum" />{r.totals.fat}g</span>
                          <span><i className="dot dot-water" />{r.water.toLocaleString()}ml</span>
                          {r.workouts.length > 0 && <span><Dumbbell size={10} /> {r.workouts.length}</span>}
                          {r.weight != null && <span><Scale size={10} /> {r.weight}kg</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
  const monthWorkoutDays = buckets.reduce((s, b) => s + b.workoutDays, 0);

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

      <CollapsibleSection title="Today" icon={Dumbbell} defaultOpen>
        <WorkoutLogger dayKey={key} data={data} day={day} updateDay={updateDay} showToast={showToast} />
      </CollapsibleSection>

      <CollapsibleSection title="This week" icon={Calendar} defaultOpen={false}>
        <div className="stat-grid">
          <div className="stat-box"><span className="stat-num">{weekSessions}</span><span className="stat-label">sessions this week</span></div>
          <div className="stat-box"><span className="stat-num">{weekActiveDays}/7</span><span className="stat-label">active days</span></div>
        </div>
        {(() => {
          const trainingRows = [...rows].reverse().filter((r) => r.workouts.length > 0);
          return trainingRows.length === 0 ? (
            <p className="tip-placeholder collapsible-tip">No workouts logged this week yet — use the form above to add one.</p>
          ) : (
            <div className="training-log collapsible-tip">
              {trainingRows.map((r) => {
                const rIsToday = r.key === todayKey();
                return (
                  <div key={r.key} className="training-log-day">
                    <div className="training-log-day-header">
                      <span>{rIsToday ? "Today" : `${DOW[r.date.getDay()]}, ${MONTHS[r.date.getMonth()]} ${r.date.getDate()}`}</span>
                      <span className="training-log-count">{r.workouts.length} session{r.workouts.length > 1 ? "s" : ""}</span>
                    </div>
                    <ul className="training-log-exercises">
                      {r.workouts.map((w) => {
                        const meta = WORKOUT_TYPES.find((t) => t.value === w.type);
                        const Icon = meta?.icon || Dumbbell;
                        return (
                          <li key={w.id}>
                            <Icon size={13} />
                            <span>{describeWorkout(w)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </CollapsibleSection>

      <CollapsibleSection title="This month" icon={Calendar} defaultOpen={false}>
        <div className="stat-grid">
          <div className="stat-box"><span className="stat-num">{monthWorkoutDays}</span><span className="stat-label">workout days this month</span></div>
          <div className="stat-box"><span className="stat-num">{buckets.filter((b) => b.workoutDays > 0).length}/{buckets.length || 0}</span><span className="stat-label">active weeks</span></div>
        </div>
      </CollapsibleSection>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  App shell                                                              */
/* ---------------------------------------------------------------------- */

const TABS = [
  { id: "today", label: "Today", icon: Flame },
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
  const theme = data.profile.theme === "dark" ? "dark" : "light";

  const toggleTheme = useCallback(() => {
    setData((prev) => ({
      ...prev,
      profile: { ...prev.profile, theme: prev.profile.theme === "dark" ? "light" : "dark" },
    }));
  }, []);

  // Keep the browser chrome (status bar, form controls) in step with the
  // in-app theme rather than leaving it stuck on light.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#141A15" : "#F4F6EE");
  }, [theme]);

  return (
    <div className="napp" data-theme={theme}>
      <style>{CSS}</style>

      {!loaded ? (
        <div className="boot"><Leaf size={26} className="spin-slow" /></div>
      ) : (
        <>
          <main className="napp-main" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
            {tab === "today" && (
              <TodayTab
                data={data}
                setData={setData}
                showToast={showToast}
                goWorkout={() => setTab("workout")}
                onOpenCustomize={() => setCustomizeOpen(true)}
                onToggleTheme={toggleTheme}
              />
            )}
            {tab === "weekly" && <WeeklyTab data={data} showToast={showToast} />}
            {tab === "monthly" && <MonthlyTab data={data} showToast={showToast} />}
            {tab === "workout" && <WorkoutTab data={data} setData={setData} showToast={showToast} />}
          </main>

          <Toast toast={toast} onDone={() => setToast(null)} />

          {customizeOpen && (
            <CustomizeModal
              data={data}
              setData={setData}
              showToast={showToast}
              onToggleTheme={toggleTheme}
              onClose={() => setCustomizeOpen(false)}
            />
          )}

          <nav className="tabbar">
            <div className="tabbar-indicator" style={{ left: `${(activeIndex * 100) / TABS.length}%`, width: `${100 / TABS.length}%` }} />
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  className={`tabbar-btn ${active ? "active" : ""}`}
                  onClick={() => setTab(t.id)}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={19} strokeWidth={active ? 2.4 : 1.8} />
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
  /* Light theme (default). Every surface/ink pair below is chosen to clear
     WCAG AA contrast for body text on its own background. */
  --bg: #F4F6EE;
  --surface: #FFFFFF;
  --surface-2: #F7F9F2;   /* inputs, subtle fills */
  --surface-3: #EEF1E6;   /* tracks, pills, inset panels */
  --ink: #202B22;
  --ink-soft: #5B6B5A;
  --ink-faint: #7C8A7A;   /* de-emphasised numerals; AA on --surface */
  --muted-icon: #8A9686;  /* icon-only buttons at rest */
  --border: #E1E4D8;
  --gold: #D9A441;        /* decorative fills: bars, rings, dots */
  --gold-text: #8F6318;   /* same hue darkened for AA text contrast */
  --clay: #B5533C;
  --plum: #8B6F9E;
  --water: #3E7CB1;
  --water-text: #356C9B;  /* darkened for AA text contrast */
  --water-light: #5FA0C9;
  --good: #4C8B5B;        /* decorative: borders, icons, fills */
  --good-text: #3F7A4D;   /* darkened for AA text contrast */
  --delta-up: #37703F;    /* progression gain; AA on every light surface */
  --delta-down: #A4462F;  /* progression loss; AA on every light surface */
  --on-accent: #F4F6EE;   /* text on --ink filled buttons */
  --on-accent-soft: #D8DED2;
  --jar-border: #CBD6D9;
  --jar-bg: #F7FAF7;
  --shadow: rgba(32,43,34,0.08);
  --focus: #3E7CB1;
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
.napp[data-theme="dark"] {
  /* Dark theme. Surfaces step upward in lightness (bg < surface < surface-2)
     so elevation still reads without relying on shadow, and accent hues are
     lightened to hold contrast against the dark backgrounds. */
  --bg: #141A15;
  --surface: #1B241D;
  --surface-2: #222C24;
  --surface-3: #2A352C;
  --ink: #E8EDE4;
  --ink-soft: #9DB09C;
  --ink-faint: #8A9C89;
  --muted-icon: #7E8F7D;
  --border: #2F3A31;
  --gold: #E8BC63;
  --gold-text: #E8BC63;   /* already 8.97:1 on dark surface */
  --clay: #D97A62;
  --plum: #AE93BF;
  --water: #7FB5DE;
  --water-text: #7FB5DE;  /* 7.27:1 on dark surface */
  --water-light: #A3CCEB;
  --good: #7BC08C;
  --good-text: #7BC08C;   /* 7.41:1 on dark surface */
  --delta-up: #7BC08C;    /* AA on every dark surface */
  --delta-down: #E89478;  /* lightened so it clears AA on dark */
  --on-accent: #141A15;
  --on-accent-soft: #3A463C;
  --jar-border: #3A4A4E;
  --jar-bg: #1B241D;
  --shadow: rgba(0,0,0,0.4);
  --focus: #7FB5DE;
}
/* In dark mode the "ink" fill of primary buttons would be near-white, so flip
   them to the brand green with dark text to keep them legible and on-brand. */
.napp[data-theme="dark"] .btn-primary { background: var(--good); color: #10170F; }
.napp[data-theme="dark"] .workout-type-chip.on { background: var(--good); color: #10170F; border-color: var(--good); }
.napp[data-theme="dark"] .toast { background: var(--surface-3); color: var(--ink); }
.napp[data-theme="dark"] .toast-good { background: var(--good); color: #10170F; }
.napp[data-theme="dark"] .toast-warn { background: var(--clay); color: #1A0D0A; }
.napp[data-theme="dark"] .tabbar { background: rgba(27,36,29,0.92); }
.napp[data-theme="dark"] .tabbar-indicator { background: var(--surface-3); }
.napp[data-theme="dark"] .date-chip.selected { background: var(--good); color: #10170F; border-color: var(--good); }

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

.collapsible { padding: 0; overflow: hidden; }
.collapsible-header { width:100%; display:flex; align-items:center; justify-content:space-between; padding: 18px; background: none; border:none; text-align:left; }
.collapsible-title { margin-bottom: 0; }
.collapsible-chevron { color: var(--ink-soft); transition: transform 0.25s cubic-bezier(.25,.9,.35,1); flex-shrink:0; }
.collapsible-chevron.open { transform: rotate(90deg); }
.collapsible-body { padding: 0 18px 18px; animation: fadein 0.2s ease; }
.collapsible-tip { margin-top: 14px; }

.hero-card { display:flex; flex-direction:column; align-items:center; gap: 18px; }
.ring-wrap { position: relative; width: 180px; height: 180px; }
.ring-svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.ring-track { fill: none; stroke: var(--surface-3); stroke-width: 12; }
.ring-progress { fill: none; stroke-width: 12; stroke-linecap: round; transition: stroke-dashoffset 0.7s cubic-bezier(.25,.9,.35,1), stroke 0.3s; }
.ring-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; text-align:center; padding: 0 14px; }
.ring-number { font-family:'Fraunces', serif; font-size: 38px; font-weight: 700; line-height: 1; }
.ring-label { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
.ring-sub { font-size: 11px; margin-top: 6px; font-weight: 600; }

.macro-list { width: 100%; display:flex; flex-direction:column; gap: 12px; }
.macro-row-top { display:flex; justify-content:space-between; font-size: 12.5px; margin-bottom: 5px; }
.macro-label { font-weight: 700; }
.macro-value { color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.macro-unit { color: var(--ink-faint); }
.macro-track { height: 8px; border-radius: 6px; background: var(--surface-3); overflow: hidden; }
.macro-fill { height: 100%; border-radius: 6px; transition: width 0.6s cubic-bezier(.25,.9,.35,1); }

.water-card { background: var(--surface); border:1px solid var(--border); border-radius: 20px; padding: 18px; box-shadow: 0 6px 18px var(--shadow); display:flex; flex-direction:column; gap: 14px; }
.water-visual { display:flex; align-items:center; gap: 16px; }
.jar { position:relative; width: 46px; height: 68px; border: 2px solid var(--jar-border); border-radius: 8px 8px 14px 14px; overflow:hidden; background: var(--jar-bg); flex-shrink:0; }
.jar-fill { position:absolute; bottom:0; left:0; right:0; background: linear-gradient(180deg, var(--water-light), var(--water)); transition: height 0.7s cubic-bezier(.25,.9,.35,1); }
.jar-wave { position:absolute; top:-3px; left:-10%; width:120%; height:8px; background: rgba(255,255,255,0.35); border-radius: 50%; animation: wave 2.6s ease-in-out infinite; }
@keyframes wave { 0%,100% { transform: translateY(0) scaleX(1); } 50% { transform: translateY(2px) scaleX(1.05); } }
.water-readout { display:flex; align-items:center; gap: 8px; }
.water-icon { color: var(--water); }
.water-ml { font-family:'Fraunces', serif; font-size: 20px; font-weight: 700; line-height:1; }
.water-unit { font-size: 12px; font-weight: 500; color: var(--ink-soft); }
.water-goal { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
.water-presets { display:grid; grid-template-columns: repeat(4,1fr); gap: 8px; }
.water-presets .chip { justify-content:center; padding: 9px 6px; }
.chip-custom { width:100%; justify-content:center; }

.body-card { display:flex; flex-direction:column; gap: 16px; }
.weight-row { display:flex; align-items:center; gap: 10px; }
.weight-input-group { flex:1; display:flex; align-items:center; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); overflow:hidden; }
.weight-input { flex:1; border:none; background:transparent; padding: 9px 12px; font-size: 14px; color: var(--ink); width: 100%; }
.weight-input:focus { outline: none; }
.weight-logged-pill { flex:1; display:flex; align-items:center; gap: 7px; font-size: 13px; font-weight: 600; color: var(--ink); background: var(--surface-3); border-radius: 12px; padding: 10px 12px; }

.workout-status {
  display:flex; align-items:center; gap: 10px; width: 100%;
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  padding: 14px 16px; font-size: 13.5px; font-weight: 700; color: var(--ink-soft);
  box-shadow: 0 6px 18px var(--shadow); transition: border-color 0.2s ease, color 0.2s ease;
}
.workout-status.on { color: var(--good-text); border-color: var(--good); }
.workout-status span { flex:1; text-align:left; }
.workout-status-chevron { opacity: 0.5; }

.chip {
  display:flex; align-items:center; gap: 4px;
  border: 1px solid var(--border); background: var(--surface-2); color: var(--ink);
  padding: 7px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
  transition: transform 0.15s ease, background 0.15s ease;
}
.chip:hover { background: var(--surface-3); }
.chip:active { transform: scale(0.94); }
.chip-ghost { background: transparent; }
.custom-water-form { display:flex; gap: 8px; animation: fadein 0.2s ease; }

.text-input { flex:1; border: 1px solid var(--border); border-radius: 12px; padding: 9px 12px; font-size: 13px; background: var(--surface-2); color: var(--ink); width: 100%; }
.text-area { width: 100%; border: 1px solid var(--border); border-radius: 14px; padding: 12px 13px; font-size: 13.5px; background: var(--surface-2); color: var(--ink); resize: vertical; min-height: 64px; line-height: 1.5; margin-bottom: 12px; }

.food-searching { display:flex; align-items:center; gap: 7px; font-size: 12px; color: var(--ink-soft); margin: -4px 0 12px; }
.food-results { list-style:none; margin: -4px 0 14px; padding:0; display:flex; flex-direction:column; gap: 6px; max-height: 260px; overflow-y:auto; }
.food-results li button { width:100%; display:flex; align-items:center; justify-content:space-between; gap: 10px; background:var(--surface-2); border:1px solid var(--border); border-radius: 12px; padding: 10px 12px; font-size: 13px; text-align:left; transition: background 0.15s ease; }
.food-results li button:active { background: var(--surface-3); }
.food-result-name { font-weight: 600; color: var(--ink); }
.food-result-kcal { color: var(--ink-soft); font-size: 11.5px; white-space:nowrap; font-variant-numeric: tabular-nums; }

.portion-back { margin-bottom: 12px; }
.portion-food-name { font-family:'Fraunces', serif; font-weight: 600; font-size: 18px; margin-bottom: 12px; }
.portion-input-row { display:flex; align-items:center; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); overflow:hidden; margin-bottom: 4px; }
.portion-input-row input { flex:1; border:none; background:transparent; padding: 12px; font-size: 18px; font-weight: 700; color: var(--ink); }
.portion-input-row input:focus { outline: none; }
.portion-preview { background: var(--surface-3); border-radius: 12px; padding: 12px 14px; margin: 14px 0; display:flex; flex-direction:column; gap: 4px; }
.portion-preview-kcal { font-family:'Fraunces', serif; font-weight: 700; font-size: 20px; color: var(--gold-text); }
.portion-preview span:last-child { font-size: 12px; color: var(--ink-soft); }


.btn-primary { display:flex; align-items:center; justify-content:center; gap: 7px; background: var(--ink); color: var(--on-accent); border: none; border-radius: 13px; padding: 12px 16px; font-size: 13.5px; font-weight: 700; width: 100%; transition: transform 0.15s ease, opacity 0.15s ease; }
.btn-primary:disabled { opacity: 0.45; cursor: default; }
.btn-primary:not(:disabled):active { transform: scale(0.98); }
.btn-small { width: auto; padding: 8px 14px; border-radius: 10px; }
.btn-ghost { display:inline-flex; align-items:center; gap:6px; background: transparent; color: var(--good-text); border: 1px solid var(--border); border-radius: 10px; padding: 8px 13px; font-size: 12.5px; font-weight: 700; }
.btn-ghost:disabled { opacity: 0.5; }

.tip-placeholder { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 12px; line-height: 1.5; }
.link-btn { display:flex; align-items:center; gap:2px; background:none; border:none; color: var(--good-text); font-size: 12.5px; font-weight: 700; }

.mini-entry-list { display:flex; flex-direction:column; gap: 9px; list-style:none; margin:0; padding:0; }
.mini-entry { display:flex; justify-content:space-between; font-size: 13px; padding-bottom: 9px; border-bottom: 1px solid var(--border); }
.mini-entry:last-child { border-bottom: none; padding-bottom: 0; }
.mini-entry-kcal { color: var(--ink-soft); font-variant-numeric: tabular-nums; }

.log-nav { display:flex; align-items:center; justify-content:space-between; background: var(--surface); border:1px solid var(--border); border-radius: 16px; padding: 10px 8px; }
.log-nav-label { text-align:center; flex:1; }
.log-nav-date { font-family:'Fraunces', serif; font-weight: 600; font-size: 15px; }
.log-nav-sub { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
.icon-btn { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; width: 34px; height: 34px; display:flex; align-items:center; justify-content:center; color: var(--ink); }
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
.entry-kcal { font-size: 13px; font-weight: 700; color: var(--gold-text); white-space:nowrap; }
.entry-macros { display:flex; gap: 12px; margin-top: 9px; font-size: 11px; color: var(--ink-soft); }
.entry-macros span { display:flex; align-items:center; gap: 5px; }
.dot { width:7px; height:7px; border-radius:50%; display:inline-block; }
.dot-clay { background: var(--clay); }
.dot-gold { background: var(--gold); }
.dot-plum { background: var(--plum); }
.dot-water { background: var(--water); }
.entry-actions { position:absolute; top: 14px; right: 12px; display:flex; gap: 6px; }
.entry-action-btn { background: none; border:none; color: var(--muted-icon); padding: 4px; }
.entry-action-btn:hover { color: var(--good); }
.entry-edit-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.entry-edit-field { display:flex; flex-direction:column; gap:4px; font-size: 11px; color: var(--ink-soft); text-transform:capitalize; }
.entry-edit-field input { border:1px solid var(--border); border-radius:8px; padding:7px 9px; font-size:13px; background:var(--surface-2); color:var(--ink); }
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
.badge-workout { background: rgba(76,139,91,0.14); color: var(--good-text); }
.badge-weight { background: rgba(62,124,177,0.14); color: var(--water-text); }
.week-day-cal { font-size: 13.5px; font-weight: 700; margin-bottom: 6px; }
.week-day-cal-goal { font-weight: 500; color: var(--ink-soft); }
.week-day-bar-track { height: 6px; border-radius: 5px; background: var(--surface-3); overflow:hidden; margin-bottom: 10px; }
.week-day-bar-fill { height: 100%; border-radius: 5px; background: var(--gold); transition: width 0.6s cubic-bezier(.25,.9,.35,1); }
.week-day-macros { display:flex; gap: 12px; font-size: 11px; color: var(--ink-soft); flex-wrap:wrap; }
.week-day-macros span { display:flex; align-items:center; gap: 5px; }

.workout-form { display:flex; flex-direction:column; gap: 12px; }
.workout-type-row { display:flex; gap: 8px; flex-wrap:wrap; }
.workout-type-chip { display:flex; align-items:center; gap:5px; border:1px solid var(--border); background:var(--surface-2); color:var(--ink-soft); padding:8px 12px; border-radius:999px; font-size:12px; font-weight:700; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease; }
.workout-type-chip.on { background: var(--ink); color: var(--on-accent); border-color: var(--ink); }
.workout-field-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.workout-entry-list { list-style:none; margin: 14px 0 0; padding:0; display:flex; flex-direction:column; gap: 8px; }
.workout-entry { display:flex; align-items:center; gap: 9px; background:var(--surface-2); border-radius: 12px; padding: 10px 12px; font-size: 12.5px; }
.workout-entry-icon { color: var(--good); flex-shrink:0; }
.workout-entry-desc { flex:1; }
.workout-entry-delete { background:none; border:none; color:var(--muted-icon); padding:2px; }
.workout-entry-delete:hover { color: var(--clay); }

.training-log { display:flex; flex-direction:column; gap: 16px; }
.training-log-day { border-bottom: 1px solid var(--border); padding-bottom: 14px; }
.training-log-day:last-child { border-bottom: none; padding-bottom: 0; }
.training-log-day-header { display:flex; align-items:center; justify-content:space-between; margin-bottom: 9px; font-family:'Fraunces', serif; font-weight: 600; font-size: 14px; }
.training-log-count { font-family:'Manrope', sans-serif; font-weight: 700; font-size: 11px; color: var(--good-text); background: rgba(76,139,91,0.12); padding: 3px 9px; border-radius: 999px; }
.training-log-exercises { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap: 8px; }
.training-log-exercises li { display:flex; align-items:center; gap: 9px; font-size: 12.5px; color: var(--ink); }
.training-log-exercises li svg { color: var(--good); flex-shrink:0; }

.goal-field { margin-bottom: 14px; }
.goal-field label { display:block; }
.goal-field-label { font-size: 12.5px; font-weight: 700; color: var(--ink-soft); display:block; margin-bottom: 6px; }
.goal-field-input { display:flex; align-items:center; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); overflow:hidden; }
.goal-field-input input { flex:1; border:none; background:transparent; padding: 10px 12px; font-size: 14px; color: var(--ink); }
.goal-field-input input:focus { outline: none; }
.goal-field-input select { flex:1; border:none; background:transparent; padding: 10px 12px; font-size: 13.5px; color: var(--ink); appearance: none; -webkit-appearance: none; }
.goal-field-input select:focus { outline: none; }
.goal-field-unit { padding: 0 12px; font-size: 12px; color: var(--ink-soft); font-weight: 600; }
.goal-field-hint { font-size: 11px; color: var(--ink-soft); margin-top: 4px; display:block; }
.suggest-hint { margin-top: 10px; line-height: 1.5; }
.backup-actions { display:flex; gap: 10px; flex-wrap:wrap; }
.backup-actions .btn-ghost { flex:1; justify-content:center; }

.modal-overlay { position:fixed; inset:0; background: rgba(32,43,34,0.45); display:flex; align-items:flex-end; justify-content:center; z-index: 50; }
.modal-panel { background: var(--bg); width:100%; max-width: 460px; max-height: 88vh; border-radius: 24px 24px 0 0; display:flex; flex-direction:column; animation: modalup 0.3s cubic-bezier(.25,.9,.35,1); }
@keyframes modalup { from { transform: translateY(30px); opacity:0; } to { transform: translateY(0); opacity:1; } }
.modal-header { display:flex; align-items:center; justify-content:space-between; padding: 16px 18px; border-bottom: 1px solid var(--border); }
.modal-body { overflow-y:auto; padding: 16px; display:flex; flex-direction:column; gap: 14px; -webkit-overflow-scrolling: touch; }
.modal-footer { padding: 14px 18px; border-top: 1px solid var(--border); }

.toast {
  position: fixed; bottom: 92px; left: 50%; transform: translateX(-50%);
  max-width: 420px; width: calc(100% - 32px);
  background: var(--ink); color: var(--on-accent); border-radius: 14px; padding: 12px 14px;
  display:flex; align-items:center; justify-content:space-between; gap: 10px;
  font-size: 12.5px; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
  animation: toastin 0.3s cubic-bezier(.25,.9,.35,1); z-index: 60;
}
.toast button { background:none; border:none; color: var(--on-accent-soft); display:flex; }
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
.tabbar-indicator { position:absolute; top: 4px; height: calc(100% - 8px); width: 25%; background: var(--surface-3); border-radius: 14px; transition: left 0.35s cubic-bezier(.25,.9,.35,1); z-index:0; }
.tabbar-btn { position: relative; z-index: 1; background: none; border: none; color: var(--ink-soft); display:flex; flex-direction:column; align-items:center; gap: 3px; padding: 7px 2px; font-size: 9.5px; font-weight: 700; transition: color 0.2s ease; }
.tabbar-btn.active { color: var(--good-text); }

/* ---------- Date scroller (Today) ---------- */
.date-scroller {
  display:flex; gap: 8px; overflow-x:auto; padding: 2px 2px 6px;
  scrollbar-width:none; -ms-overflow-style:none; scroll-behavior:smooth;
}
.date-scroller::-webkit-scrollbar { display:none; }
.date-chip {
  flex: 0 0 auto; min-width: 48px; min-height: 60px;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap: 2px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  padding: 8px 6px; color: var(--ink-soft);
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
}
.date-chip:active { transform: scale(0.95); }
.date-chip-dow { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; }
.date-chip-num { font-family:'Fraunces', serif; font-size: 17px; font-weight: 700; line-height: 1; color: var(--ink); }
.date-chip-dot { width: 5px; height: 5px; border-radius: 50%; background: transparent; }
.date-chip-dot.on { background: var(--gold); }
.date-chip.is-today { border-color: var(--good); }
.date-chip.selected { background: var(--ink); border-color: var(--ink); color: var(--on-accent); }
.date-chip.selected .date-chip-num { color: var(--on-accent); }
.date-chip.selected .date-chip-dot.on { background: var(--on-accent); }

.back-to-today {
  align-self:center; display:inline-flex; align-items:center; gap: 6px;
  background: var(--surface-3); border: 1px solid var(--border); border-radius: 999px;
  padding: 8px 14px; font-size: 12px; font-weight: 700; color: var(--ink);
  min-height: 36px;
}

/* ---------- Meals section (moved onto Today) ---------- */
.meals-section { display:flex; flex-direction:column; gap: 10px; }
.meals-section-title { display:flex; align-items:center; gap: 7px; margin-bottom: 0; }
.meals-count { margin-left:auto; font-size: 11.5px; font-weight: 700; color: var(--gold-text); font-variant-numeric: tabular-nums; }

/* ---------- Monthly: expandable week cards ---------- */
.week-card-clickable { padding: 0; overflow:hidden; }
.week-card-clickable.expanded { border-color: var(--good); }
.week-card-toggle {
  width:100%; background:none; border:none; text-align:left; padding: 14px;
  display:block; color: inherit;
}
.week-card-chevron { color: var(--ink-soft); transition: transform 0.25s cubic-bezier(.25,.9,.35,1); flex-shrink:0; }
.week-card-chevron.open { transform: rotate(90deg); }
.week-expand { border-top: 1px solid var(--border); padding: 12px 14px 14px; background: var(--surface-2); animation: fadein 0.2s ease; }
.week-expand-title { font-size: 11px; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 10px; }
.week-expand-day { padding: 10px 0; border-bottom: 1px solid var(--border); }
.week-expand-day:last-child { border-bottom:none; padding-bottom: 0; }
.week-expand-day.is-empty { opacity: 0.45; }
.week-expand-day-top { display:flex; align-items:baseline; justify-content:space-between; gap: 10px; margin-bottom: 6px; }
.week-expand-day-name { font-size: 12.5px; font-weight: 700; color: var(--ink); }
.week-expand-day-kcal { font-size: 12px; font-weight: 700; color: var(--gold-text); font-variant-numeric: tabular-nums; }
.week-expand-bar { margin-bottom: 7px; height: 5px; }
.week-expand-macros { font-size: 10.5px; gap: 10px; }

/* ---------- Workout form: labelled fields ---------- */
.wfield { display:flex; flex-direction:column; gap: 5px; flex: 1 1 0; min-width: 0; }
.wfield-label { font-size: 11px; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.03em; }
.wfield-input-wrap { display:flex; align-items:center; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2); overflow:hidden; min-height: 46px; }
.wfield-input { flex:1; min-width: 0; border:none; background:transparent; padding: 11px 12px; font-size: 15px; font-weight: 600; color: var(--ink); }
.wfield-input:focus { outline: none; }
.wfield-input-wrap:focus-within { border-color: var(--focus); box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus) 25%, transparent); }
.wfield-unit { padding: 0 11px 0 4px; font-size: 12px; font-weight: 700; color: var(--ink-soft); white-space:nowrap; }
.wfield-row { display:flex; gap: 10px; }

.exercise-suggestions { display:flex; flex-direction:column; gap: 7px; }
.exercise-suggestions-label { font-size: 10.5px; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.04em; }
.exercise-suggestion-chips { display:flex; flex-wrap:wrap; gap: 7px; }
.exercise-chip {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px;
  padding: 9px 13px; font-size: 12.5px; font-weight: 600; color: var(--ink); min-height: 38px;
}
.exercise-chip:active { background: var(--surface-3); }

.last-time-card {
  background: var(--surface-3); border-radius: 14px; padding: 13px 14px;
  display:flex; flex-direction:column; gap: 10px; animation: fadein 0.2s ease;
}
.last-time-head { display:flex; align-items:center; gap: 7px; font-size: 11.5px; font-weight: 700; color: var(--ink-soft); }
.last-time-stats { display:flex; gap: 18px; font-size: 12.5px; color: var(--ink-soft); }
.last-time-stats strong { font-family:'Fraunces', serif; font-size: 18px; font-weight: 700; color: var(--ink); margin-right: 3px; }
.last-time-actions { display:flex; flex-wrap:wrap; gap: 8px; }
.last-time-actions .btn-ghost { min-height: 38px; }

/* Per-movement history: date | load | progression delta */
.exercise-history { list-style:none; margin: 4px 0 0; padding: 10px 0 0; border-top: 1px solid var(--border); display:flex; flex-direction:column; gap: 2px; }
.exercise-history-row { display:flex; align-items:center; gap: 10px; padding: 7px 0; font-size: 12.5px; }
.exercise-history-date { flex: 0 0 52px; color: var(--ink-soft); font-size: 11.5px; font-weight: 600; }
.exercise-history-load { flex:1; color: var(--ink); font-variant-numeric: tabular-nums; }
.exercise-history-delta { font-size: 11.5px; font-weight: 700; white-space:nowrap; font-variant-numeric: tabular-nums; }
.exercise-history-delta.up { color: var(--delta-up); }
.exercise-history-delta.down { color: var(--delta-down); }

.workout-entry { min-height: 52px; }
.workout-entry-body { flex:1; display:flex; flex-direction:column; gap: 2px; min-width: 0; }
.workout-entry-title { font-size: 13.5px; font-weight: 700; color: var(--ink); }
.workout-entry-detail { font-size: 11.5px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.workout-entry-delete { min-width: 40px; min-height: 40px; display:flex; align-items:center; justify-content:center; border-radius: 10px; }

/* ---------- Theme switch (Customize) ---------- */
.theme-switch { display:flex; gap: 8px; }
.theme-switch-btn {
  flex:1; display:flex; align-items:center; justify-content:center; gap: 7px;
  min-height: 46px; border: 1px solid var(--border); border-radius: 12px;
  background: var(--surface-2); color: var(--ink-soft); font-size: 13px; font-weight: 700;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}
.theme-switch-btn.on { background: var(--ink); color: var(--on-accent); border-color: var(--ink); }
.napp[data-theme="dark"] .theme-switch-btn.on { background: var(--good); color: #10170F; border-color: var(--good); }

/* ---------- Accessibility: larger tap targets on existing controls ---------- */
.icon-btn { min-width: 40px; min-height: 40px; }
.entry-action-btn { min-width: 38px; min-height: 38px; display:flex; align-items:center; justify-content:center; border-radius: 9px; }
.tabbar-btn { min-height: 48px; }
@media (prefers-reduced-motion: reduce) {
  .napp *, .napp *::before, .napp *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  .date-scroller { scroll-behavior: auto; }
}

@media (min-width: 461px) {
  .napp { border-left: 1px solid var(--border); border-right: 1px solid var(--border); min-height: 100vh; }
}
`;
