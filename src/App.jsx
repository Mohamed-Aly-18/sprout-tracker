import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Flame, Droplets, Plus, Sparkles, Loader2, Trash2, ChevronLeft, ChevronRight,
  Target, TrendingUp, X, UtensilsCrossed, Settings2, Leaf, Sunrise, Share2
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, Tooltip,
} from "recharts";
import { storage } from "./storage.js";

/* ---------------------------------------------------------------------- */
/*  Helpers                                                                */
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
function emptyDay() {
  return { entries: [], water: 0 };
}
function getDay(data, key) {
  return data.days[key] || emptyDay();
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
function clampPct(n) {
  return Math.max(0, Math.min(100, n));
}
function formatDateLabel(key) {
  const d = keyToDate(key);
  return `${DOW_FULL[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function buildDailySummary(key, day, totals, profile) {
  const lines = [];
  lines.push("Sprout — Daily Summary");
  lines.push(formatDateLabel(key));
  lines.push("");
  lines.push(`Calories: ${totals.calories} / ${profile.calorieGoal} kcal`);
  lines.push(`Protein: ${totals.protein} / ${profile.proteinGoal} g`);
  lines.push(`Carbs: ${totals.carbs} / ${profile.carbGoal} g`);
  lines.push(`Fat: ${totals.fat} / ${profile.fatGoal} g`);
  lines.push(`Water: ${day.water} / ${profile.waterGoal} ml`);
  if (day.entries.length) {
    lines.push("");
    lines.push("Meals logged:");
    day.entries.forEach((e) => {
      lines.push(`- ${e.time}  ${e.name} — ${e.calories} kcal (P${e.protein} / C${e.carbs} / F${e.fat})`);
    });
  } else {
    lines.push("");
    lines.push("No meals logged this day.");
  }
  return lines.join("\n");
}

function buildWeeklySummary(data) {
  const keys = [];
  for (let i = 6; i >= 0; i--) keys.push(addDays(todayKey(), -i));
  const rows = keys.map((k) => {
    const d = keyToDate(k);
    const day = getDay(data, k);
    const totals = dayTotals(day);
    return { k, d, totals, water: day.water };
  });
  const daysWithData = rows.filter((r) => r.totals.calories > 0 || r.water > 0);
  const avgCalories = daysWithData.length
    ? Math.round(daysWithData.reduce((s, r) => s + r.totals.calories, 0) / daysWithData.length)
    : 0;
  const avgProtein = daysWithData.length
    ? Math.round(daysWithData.reduce((s, r) => s + r.totals.protein, 0) / daysWithData.length)
    : 0;
  const waterGoalDays = rows.filter((r) => r.water >= data.profile.waterGoal).length;

  const lines = [];
  lines.push("Sprout — Weekly Summary");
  lines.push(
    `${MONTHS[rows[0].d.getMonth()]} ${rows[0].d.getDate()} – ${MONTHS[rows[6].d.getMonth()]} ${rows[6].d.getDate()}`
  );
  lines.push("");
  lines.push(
    `Daily goals: ${data.profile.calorieGoal} kcal · ${data.profile.proteinGoal}g protein · ` +
      `${data.profile.carbGoal}g carbs · ${data.profile.fatGoal}g fat · ${data.profile.waterGoal}ml water`
  );
  lines.push("");
  rows.forEach((r) => {
    lines.push(
      `${DOW[r.d.getDay()]} ${MONTHS[r.d.getMonth()]} ${r.d.getDate()}: ${r.totals.calories} kcal · ` +
        `P${r.totals.protein} C${r.totals.carbs} F${r.totals.fat} · ${r.water}ml water`
    );
  });
  lines.push("");
  lines.push(`Averages: ${avgCalories} kcal/day, ${avgProtein}g protein/day`);
  lines.push(`Water goal met: ${waterGoalDays} of 7 days`);
  return lines.join("\n");
}

async function shareOrCopy(title, text) {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancelled";
      // fall through to clipboard fallback below
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch (e) {
    return "failed";
  }
}

function greetingFor(hour) {
  if (hour < 5) return "Still up?";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

const DEFAULT_PROFILE = {
  calorieGoal: 2100,
  proteinGoal: 130,
  carbGoal: 240,
  fatGoal: 70,
  waterGoal: 2500,
};

const STORAGE_KEY = "sprout-nutrition-data";

/* ---------------------------------------------------------------------- */
/*  Anthropic API calls                                                    */
/* ---------------------------------------------------------------------- */

async function callClaude(system, userText, maxTokens = 1000) {
  // Calls our own backend (api/claude.js) rather than Anthropic directly —
  // that's what keeps your API key off the device and out of the browser.
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, userText, maxTokens }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Request failed");
  return (json.text || "").trim();
}

async function estimateNutrition(text) {
  const system =
    "You are a careful nutrition-estimation engine inside a food-logging app. " +
    "Given a free-text description of food or drink someone ate, respond with ONLY raw JSON " +
    "(no markdown fences, no prose, no explanation) in exactly this shape: " +
    '{"items":[{"name":"string","calories":number,"protein_g":number,"carbs_g":number,"fat_g":number}]}. ' +
    "Split the description into distinct food items when reasonable. Use typical nutrition data and " +
    "any stated or implied portion sizes to give sensible estimates. Numbers only, no units inside numbers. " +
    "If the text isn't food at all, return {\"items\":[]}.";
  const raw = await callClaude(system, text, 800);
  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  if (!parsed.items) throw new Error("bad shape");
  return parsed.items.map((it) => ({
    name: String(it.name || "Item").slice(0, 80),
    calories: Math.max(0, Math.round(Number(it.calories) || 0)),
    protein: Math.max(0, Math.round(Number(it.protein_g) || 0)),
    carbs: Math.max(0, Math.round(Number(it.carbs_g) || 0)),
    fat: Math.max(0, Math.round(Number(it.fat_g) || 0)),
  }));
}

async function generateTip(context) {
  const system =
    "You are an encouraging, concise nutrition coach inside a food-tracking app. " +
    "You'll be given the user's goals and their actual intake for today and the past week, as JSON. " +
    "Reply with ONLY plain text (no markdown, no quotes, no labels): one or two short, specific, " +
    "friendly sentences (under 45 words total) of practical guidance for the rest of today, grounded in the numbers given. " +
    "Never mention that you are an AI. Be warm but not saccharine.";
  const raw = await callClaude(system, JSON.stringify(context), 300);
  return raw.replace(/^["']|["']$/g, "").trim();
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
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = target;
      }
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
        <circle
          cx="90" cy="90" r={r}
          className="ring-progress"
          style={{
            strokeDasharray: c,
            strokeDashoffset: offset,
            stroke: over ? "var(--clay)" : "var(--gold)",
          }}
        />
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
        <span className="macro-value">
          {Math.round(consumed)}<span className="macro-unit">/{Math.round(goal)}{unit}</span>
        </span>
      </div>
      <div className="macro-track">
        <div
          className="macro-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function WaterJar({ ml, goal, onQuickAdd, onCustomAdd }) {
  const pct = clampPct(goal > 0 ? (ml / goal) * 100 : 0);
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState("");
  return (
    <div className="water-card">
      <div className="water-visual">
        <div className="jar">
          <div className="jar-fill" style={{ height: `${pct}%` }}>
            <div className="jar-wave" />
          </div>
        </div>
        <div className="water-readout">
          <Droplets size={16} className="water-icon" />
          <div>
            <div className="water-ml">{ml.toLocaleString()} <span className="water-unit">ml</span></div>
            <div className="water-goal">of {goal.toLocaleString()} ml goal</div>
          </div>
        </div>
      </div>
      <div className="water-actions">
        {[150, 250, 500].map((amt) => (
          <button key={amt} className="chip" onClick={() => onQuickAdd(amt)}>
            <Plus size={13} /> {amt} ml
          </button>
        ))}
        <button className="chip chip-ghost" onClick={() => setCustomOpen((v) => !v)}>
          Custom
        </button>
      </div>
      {customOpen && (
        <form
          className="custom-water-form"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(customVal, 10);
            if (n > 0) {
              onCustomAdd(n);
              setCustomVal("");
              setCustomOpen(false);
            }
          }}
        >
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            placeholder="Amount in ml"
            value={customVal}
            onChange={(e) => setCustomVal(e.target.value)}
            className="text-input"
          />
          <button type="submit" className="btn-primary btn-small">Add</button>
        </form>
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
/*  Tab: Today                                                             */
/* ---------------------------------------------------------------------- */

function TodayTab({ data, setData, showToast, goLog }) {
  const key = todayKey();
  const day = getDay(data, key);
  const totals = dayTotals(day);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState(data.tips?.[key] || "");
  const [tipBusy, setTipBusy] = useState(false);
  const now = new Date();

  function updateDay(mutator) {
    setData((prev) => {
      const d = getDay(prev, key);
      const nd = mutator(d);
      return { ...prev, days: { ...prev.days, [key]: nd } };
    });
  }

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
        updateDay((d) => ({
          ...d,
          entries: [
            ...d.entries,
            ...items.map((it) => ({ id: uid(), time, ...it })),
          ],
        }));
        const kcal = items.reduce((s, i) => s + i.calories, 0);
        showToast(`Logged ${items.length > 1 ? `${items.length} items` : items[0].name} · ${kcal} kcal`, "good");
        setText("");
      }
    } catch (e) {
      showToast("Couldn't estimate that meal — check your connection and try again.", "warn");
    } finally {
      setBusy(false);
    }
  }

  async function handleTip() {
    if (tipBusy) return;
    setTipBusy(true);
    try {
      const week = last7Keys().map((k) => {
        const d = getDay(data, k);
        return { date: k, ...dayTotals(d), water: d.water };
      });
      const context = { goals: data.profile, today: { ...totals, water: day.water }, pastWeek: week };
      const t = await generateTip(context);
      setTip(t);
      setData((prev) => ({ ...prev, tips: { ...prev.tips, [key]: t } }));
    } catch (e) {
      showToast("Couldn't reach your coach right now — try again shortly.", "warn");
    } finally {
      setTipBusy(false);
    }
  }

  function last7Keys() {
    const out = [];
    for (let i = 6; i >= 0; i--) out.push(addDays(key, -i));
    return out;
  }

  async function handleShareDay() {
    const text = buildDailySummary(key, day, totals, data.profile);
    const result = await shareOrCopy("Sprout — Today's Summary", text);
    if (result === "copied") showToast("Summary copied — paste it to your coach", "good");
    else if (result === "failed") showToast("Couldn't share or copy — try again", "warn");
  }

  return (
    <div className="tab-panel">
      <div className="today-header">
        <div>
          <div className="greeting">
            <Sunrise size={15} />
            {greetingFor(now.getHours())}
          </div>
          <div className="date-line">{DOW_FULL[now.getDay()]}, {MONTHS[now.getMonth()]} {now.getDate()}</div>
        </div>
        <button className="icon-btn" onClick={handleShareDay} aria-label="Share today's summary">
          <Share2 size={16} />
        </button>
      </div>

      <div className="card hero-card">
        <CalorieRing consumed={totals.calories} goal={data.profile.calorieGoal} />
        <div className="macro-list">
          <MacroBar label="Protein" consumed={totals.protein} goal={data.profile.proteinGoal} color="var(--clay)" />
          <MacroBar label="Carbs" consumed={totals.carbs} goal={data.profile.carbGoal} color="var(--gold)" />
          <MacroBar label="Fat" consumed={totals.fat} goal={data.profile.fatGoal} color="var(--plum)" />
        </div>
      </div>

      <WaterJar
        ml={day.water}
        goal={data.profile.waterGoal}
        onQuickAdd={(amt) => {
          updateDay((d) => ({ ...d, water: d.water + amt }));
          showToast(`+${amt} ml logged`, "good");
        }}
        onCustomAdd={(amt) => {
          updateDay((d) => ({ ...d, water: d.water + amt }));
          showToast(`+${amt} ml logged`, "good");
        }}
      />

      <div className="card log-card">
        <div className="card-title"><UtensilsCrossed size={15} /> Log a meal or snack</div>
        <textarea
          className="text-area"
          placeholder="e.g. two scrambled eggs, a slice of sourdough toast with butter, and a black coffee"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
        />
        <button className="btn-primary" onClick={handleLog} disabled={busy || !text.trim()}>
          {busy ? <><Loader2 size={16} className="spin" /> Estimating…</> : <><Plus size={16} /> Log it</>}
        </button>
      </div>

      <div className="card tip-card">
        <div className="card-title"><Sparkles size={15} /> Coach tip</div>
        {tip ? (
          <p className="tip-text">{tip}</p>
        ) : (
          <p className="tip-placeholder">Get a short, personal nudge based on today and your past week.</p>
        )}
        <button className="btn-ghost btn-small" onClick={handleTip} disabled={tipBusy}>
          {tipBusy ? <><Loader2 size={14} className="spin" /> Thinking…</> : (tip ? "Refresh tip" : "Get today's tip")}
        </button>
      </div>

      {day.entries.length > 0 && (
        <div className="card">
          <div className="card-title-row">
            <div className="card-title"><Leaf size={15} /> Today's log</div>
            <button className="link-btn" onClick={goLog}>See all <ChevronRight size={14} /></button>
          </div>
          <ul className="mini-entry-list">
            {day.entries.slice(-3).reverse().map((e) => (
              <li key={e.id} className="mini-entry">
                <span className="mini-entry-name">{e.name}</span>
                <span className="mini-entry-kcal">{e.calories} kcal</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tab: Log (history browser)                                             */
/* ---------------------------------------------------------------------- */

function LogTab({ data, setData, showToast }) {
  const [offset, setOffset] = useState(0);
  const key = addDays(todayKey(), offset);
  const day = getDay(data, key);
  const totals = dayTotals(day);
  const d = keyToDate(key);
  const isToday = offset === 0;

  function removeEntry(id) {
    setData((prev) => {
      const dd = getDay(prev, key);
      return {
        ...prev,
        days: { ...prev.days, [key]: { ...dd, entries: dd.entries.filter((e) => e.id !== id) } },
      };
    });
    showToast("Entry removed", "neutral");
  }

  async function handleShareDay() {
    const text = buildDailySummary(key, day, totals, data.profile);
    const label = isToday ? "Today" : `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const result = await shareOrCopy(`Sprout — ${label}`, text);
    if (result === "copied") showToast("Summary copied — paste it to your coach", "good");
    else if (result === "failed") showToast("Couldn't share or copy — try again", "warn");
  }

  return (
    <div className="tab-panel">
      <div className="log-nav">
        <button className="icon-btn" onClick={() => setOffset((o) => o - 1)} aria-label="Previous day">
          <ChevronLeft size={18} />
        </button>
        <div className="log-nav-label">
          <div className="log-nav-date">{isToday ? "Today" : `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`}</div>
          <div className="log-nav-sub">{totals.calories.toLocaleString()} kcal · {day.water.toLocaleString()} ml water</div>
        </div>
        <button
          className="icon-btn"
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={offset === 0}
          aria-label="Next day"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <button className="btn-ghost btn-small btn-share-day" onClick={handleShareDay}>
        <Share2 size={14} /> Share this day
      </button>

      {day.entries.length === 0 ? (
        <div className="empty-state">
          <UtensilsCrossed size={26} />
          <p>Nothing logged {isToday ? "yet today" : "this day"}.</p>
          <span>{isToday ? "Head to Today to log your first meal." : ""}</span>
        </div>
      ) : (
        <ul className="entry-list">
          {[...day.entries].reverse().map((e) => (
            <li key={e.id} className="entry-card">
              <div className="entry-top">
                <div>
                  <div className="entry-name">{e.name}</div>
                  <div className="entry-time">{e.time}</div>
                </div>
                <div className="entry-kcal">{e.calories} kcal</div>
              </div>
              <div className="entry-macros">
                <span><i className="dot dot-clay" />{e.protein}g protein</span>
                <span><i className="dot dot-gold" />{e.carbs}g carbs</span>
                <span><i className="dot dot-plum" />{e.fat}g fat</span>
              </div>
              <button className="entry-delete" onClick={() => removeEntry(e.id)} aria-label="Delete entry">
                <Trash2 size={14} />
              </button>
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
  const keys = useMemo(() => {
    const out = [];
    for (let i = 6; i >= 0; i--) out.push(addDays(todayKey(), -i));
    return out;
  }, [data]);

  const chartData = keys.map((k) => {
    const d = keyToDate(k);
    const day = getDay(data, k);
    const totals = dayTotals(day);
    return {
      label: DOW[d.getDay()],
      calories: totals.calories,
      water: day.water,
      protein: totals.protein,
    };
  });

  const daysWithData = keys.filter((k) => getDay(data, k).entries.length > 0 || getDay(data, k).water > 0);
  const avgCalories = daysWithData.length
    ? Math.round(daysWithData.reduce((s, k) => s + dayTotals(getDay(data, k)).calories, 0) / daysWithData.length)
    : 0;
  const avgProtein = daysWithData.length
    ? Math.round(daysWithData.reduce((s, k) => s + dayTotals(getDay(data, k)).protein, 0) / daysWithData.length)
    : 0;
  const waterGoalDays = keys.filter((k) => getDay(data, k).water >= data.profile.waterGoal).length;

  // streak: consecutive days ending yesterday within 15% of calorie goal
  let streak = 0;
  for (let i = 1; i <= 30; i++) {
    const k = addDays(todayKey(), -i);
    const t = dayTotals(getDay(data, k)).calories;
    if (t === 0) break;
    const ratio = t / data.profile.calorieGoal;
    if (ratio >= 0.85 && ratio <= 1.15) streak++;
    else break;
  }

  const insights = [];
  if (avgCalories > 0) {
    const diff = avgCalories - data.profile.calorieGoal;
    if (Math.abs(diff) <= data.profile.calorieGoal * 0.05) {
      insights.push("Your calorie average this week is right on target. Nice consistency.");
    } else if (diff > 0) {
      insights.push(`You've averaged ${diff} kcal over your goal this week — small trims at dinner could close the gap.`);
    } else {
      insights.push(`You've averaged ${Math.abs(diff)} kcal under your goal this week — leave room for a bit more if you're still hungry.`);
    }
  }
  if (avgProtein > 0 && avgProtein < data.profile.proteinGoal * 0.85) {
    insights.push("Protein has been trailing your goal most days — a source at breakfast tends to help most.");
  }
  insights.push(
    waterGoalDays >= 5
      ? `You hit your water goal on ${waterGoalDays} of the last 7 days — great habit.`
      : `You reached your water goal on ${waterGoalDays} of the last 7 days — keep a bottle within reach.`
  );

  async function handleShareWeek() {
    const text = buildWeeklySummary(data);
    const result = await shareOrCopy("Sprout — Weekly Summary", text);
    if (result === "copied") showToast("Summary copied — paste it to your coach", "good");
    else if (result === "failed") showToast("Couldn't share or copy — try again", "warn");
  }

  return (
    <div className="tab-panel">
      <div className="card">
        <div className="card-title"><TrendingUp size={15} /> Calories, last 7 days</div>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={chartData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 5" stroke="#E1E4D8" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5B6B5A" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#5B6B5A" }} axisLine={false} tickLine={false} width={36} />
              <ReferenceLine y={data.profile.calorieGoal} stroke="#B5533C" strokeDasharray="4 4" />
              <Tooltip
                cursor={{ fill: "rgba(217,164,65,0.12)" }}
                contentStyle={{ borderRadius: 12, border: "1px solid #E1E4D8", fontSize: 12 }}
              />
              <Bar dataKey="calories" fill="#D9A441" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-box">
          <span className="stat-num">{avgCalories.toLocaleString()}</span>
          <span className="stat-label">avg kcal/day</span>
        </div>
        <div className="stat-box">
          <span className="stat-num">{avgProtein}g</span>
          <span className="stat-label">avg protein</span>
        </div>
        <div className="stat-box">
          <span className="stat-num">{streak}</span>
          <span className="stat-label">day streak</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Sparkles size={15} /> This week's insights</div>
        <ul className="insight-list">
          {insights.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <div className="card-title"><Share2 size={15} /> Share with your coach</div>
        <p className="tip-placeholder">
          Send a plain-text summary — goals, day-by-day totals, and weekly averages — to whoever you're texting, emailing, or messaging.
        </p>
        <button className="btn-primary" onClick={handleShareWeek}>
          <Share2 size={16} /> Share weekly summary
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Tab: Goals                                                             */
/* ---------------------------------------------------------------------- */

function GoalsTab({ data, setData, showToast }) {
  const [form, setForm] = useState(data.profile);
  const dirty = JSON.stringify(form) !== JSON.stringify(data.profile);

  function field(key, label, unit, hint) {
    return (
      <div className="goal-field">
        <label>
          <span className="goal-field-label">{label}</span>
          <div className="goal-field-input">
            <input
              type="number"
              inputMode="numeric"
              min="0"
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: Math.max(0, parseInt(e.target.value || "0", 10)) }))}
            />
            <span className="goal-field-unit">{unit}</span>
          </div>
        </label>
        {hint && <span className="goal-field-hint">{hint}</span>}
      </div>
    );
  }

  return (
    <div className="tab-panel">
      <div className="card">
        <div className="card-title"><Target size={15} /> Your daily goals</div>
        {field("calorieGoal", "Calories", "kcal")}
        {field("proteinGoal", "Protein", "g")}
        {field("carbGoal", "Carbs", "g")}
        {field("fatGoal", "Fat", "g")}
        {field("waterGoal", "Water", "ml")}
        <button
          className="btn-primary"
          disabled={!dirty}
          onClick={() => {
            setData((prev) => ({ ...prev, profile: form }));
            showToast("Goals updated", "good");
          }}
        >
          Save goals
        </button>
      </div>
      <div className="card muted-card">
        <div className="card-title"><Settings2 size={15} /> About your data</div>
        <p className="muted-text">
          Everything you log is estimated from what you type using Claude, then stored privately to your
          account. Nothing here is medical advice — check with a professional for individual guidance.
        </p>
      </div>
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
  { id: "goals", label: "Goals", icon: Target },
];

export default function App() {
  const [data, setData] = useState({ profile: DEFAULT_PROFILE, days: {}, tips: {} });
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("today");
  const [toast, setToast] = useState(null);
  const saveTimer = useRef(null);

  const showToast = useCallback((message, type = "neutral") => {
    setToast({ message, type, id: uid() });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setData({
            profile: { ...DEFAULT_PROFILE, ...(parsed.profile || {}) },
            days: parsed.days || {},
            tips: parsed.tips || {},
          });
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
      } catch (e) {
        // fail silently; data stays in memory for this session
      }
    }, 350);
    return () => clearTimeout(saveTimer.current);
  }, [data, loaded]);

  const activeIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="napp">
      <style>{CSS}</style>

      {!loaded ? (
        <div className="boot">
          <Leaf size={26} className="spin-slow" />
        </div>
      ) : (
        <>
          <main className="napp-main">
            {tab === "today" && (
              <TodayTab data={data} setData={setData} showToast={showToast} goLog={() => setTab("log")} />
            )}
            {tab === "log" && <LogTab data={data} setData={setData} showToast={showToast} />}
            {tab === "weekly" && <WeeklyTab data={data} showToast={showToast} />}
            {tab === "goals" && <GoalsTab data={data} setData={setData} showToast={showToast} />}
          </main>

          <Toast toast={toast} onDone={() => setToast(null)} />

          <nav className="tabbar">
            <div className="tabbar-indicator" style={{ left: `${activeIndex * 25}%` }} />
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  className={`tabbar-btn ${active ? "active" : ""}`}
                  onClick={() => setTab(t.id)}
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
}
.napp *, .napp *::before, .napp *::after { box-sizing: border-box; }
.napp button { font-family: inherit; cursor: pointer; }
.napp input, .napp textarea { font-family: inherit; }
.napp button:focus-visible, .napp input:focus-visible, .napp textarea:focus-visible {
  outline: 2px solid var(--water);
  outline-offset: 2px;
}

.boot {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--good);
}
.spin-slow { animation: spin 1.4s linear infinite; }
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.napp-main {
  flex: 1;
  overflow-y: auto;
  padding: 20px 16px 96px;
}
.tab-panel { display: flex; flex-direction: column; gap: 14px; animation: fadein 0.28s ease; }
@keyframes fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

.today-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
.greeting { display:flex; align-items:center; gap:6px; font-family:'Fraunces', serif; font-size: 22px; font-weight: 600; }
.date-line { color: var(--ink-soft); font-size: 13px; margin-top: 2px; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 18px;
  box-shadow: 0 6px 18px var(--shadow);
}
.card-title { display:flex; align-items:center; gap:7px; font-size: 13px; font-weight: 700; color: var(--ink-soft); text-transform: none; margin-bottom: 12px; }
.card-title-row { display:flex; align-items:center; justify-content:space-between; margin-bottom: 10px; }
.card-title-row .card-title { margin-bottom: 0; }
.muted-card { background: #EEF1E6; box-shadow:none; }
.muted-text { font-size: 12.5px; color: var(--ink-soft); line-height: 1.55; }

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

.text-input {
  flex:1; border: 1px solid var(--border); border-radius: 12px; padding: 9px 12px;
  font-size: 13px; background: #F7F9F2; color: var(--ink);
}
.text-area {
  width: 100%; border: 1px solid var(--border); border-radius: 14px; padding: 12px 13px;
  font-size: 13.5px; background: #F7F9F2; color: var(--ink); resize: vertical; min-height: 64px;
  line-height: 1.5; margin-bottom: 12px;
}

.btn-primary {
  display:flex; align-items:center; justify-content:center; gap: 7px;
  background: var(--ink); color: #F4F6EE; border: none; border-radius: 13px;
  padding: 12px 16px; font-size: 13.5px; font-weight: 700; width: 100%;
  transition: transform 0.15s ease, opacity 0.15s ease;
}
.btn-primary:disabled { opacity: 0.45; cursor: default; }
.btn-primary:not(:disabled):active { transform: scale(0.98); }
.btn-small { width: auto; padding: 8px 14px; border-radius: 10px; }
.btn-ghost {
  display:inline-flex; align-items:center; gap:6px; background: transparent; color: var(--good);
  border: 1px solid var(--border); border-radius: 10px; padding: 8px 13px; font-size: 12.5px; font-weight: 700;
}
.btn-ghost:disabled { opacity: 0.5; }

.tip-text { font-size: 13.5px; line-height: 1.55; color: var(--ink); margin-bottom: 12px; }
.tip-placeholder { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 12px; line-height: 1.5; }

.link-btn { display:flex; align-items:center; gap:2px; background:none; border:none; color: var(--good); font-size: 12.5px; font-weight: 700; }

.mini-entry-list { display:flex; flex-direction:column; gap: 9px; list-style:none; margin:0; padding:0; }
.mini-entry { display:flex; justify-content:space-between; font-size: 13px; padding-bottom: 9px; border-bottom: 1px solid var(--border); }
.mini-entry:last-child { border-bottom: none; padding-bottom: 0; }
.mini-entry-name { color: var(--ink); }
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
.entry-card { position:relative; background: var(--surface); border:1px solid var(--border); border-radius: 16px; padding: 14px 40px 14px 14px; animation: fadein 0.25s ease; }
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
.entry-delete { position:absolute; top: 14px; right: 12px; background: none; border:none; color: #B7C2AE; padding: 4px; }
.entry-delete:hover { color: var(--clay); }

.chart-wrap { margin: 0 -6px; }
.stat-grid { display:grid; grid-template-columns: repeat(3,1fr); gap: 10px; }
.stat-box { background: var(--surface); border:1px solid var(--border); border-radius: 16px; padding: 14px 8px; display:flex; flex-direction:column; align-items:center; gap: 3px; }
.stat-num { font-family:'Fraunces', serif; font-size: 19px; font-weight: 700; }
.stat-label { font-size: 10.5px; color: var(--ink-soft); text-align:center; }
.insight-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap: 10px; }
.insight-list li { font-size: 13px; line-height: 1.5; padding-left: 16px; position:relative; }
.insight-list li::before { content:''; position:absolute; left:0; top:7px; width:6px; height:6px; border-radius:50%; background: var(--gold); }

.goal-field { margin-bottom: 14px; }
.goal-field label { display:block; }
.goal-field-label { font-size: 12.5px; font-weight: 700; color: var(--ink-soft); display:block; margin-bottom: 6px; }
.goal-field-input { display:flex; align-items:center; border: 1px solid var(--border); border-radius: 12px; background: #F7F9F2; overflow:hidden; }
.goal-field-input input { flex:1; border:none; background:transparent; padding: 10px 12px; font-size: 14px; color: var(--ink); }
.goal-field-input input:focus { outline: none; }
.goal-field-unit { padding: 0 12px; font-size: 12px; color: var(--ink-soft); font-weight: 600; }
.goal-field-hint { font-size: 11px; color: var(--ink-soft); margin-top: 4px; display:block; }

.toast {
  position: fixed; bottom: 92px; left: 50%; transform: translateX(-50%);
  max-width: 420px; width: calc(100% - 32px);
  background: var(--ink); color: #F4F6EE; border-radius: 14px; padding: 12px 14px;
  display:flex; align-items:center; justify-content:space-between; gap: 10px;
  font-size: 12.5px; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
  animation: toastin 0.3s cubic-bezier(.25,.9,.35,1); z-index: 40;
}
.toast button { background:none; border:none; color: #D8DED2; display:flex; }
.toast-good { background: var(--good); }
.toast-warn { background: var(--clay); }
@keyframes toastin { from { opacity:0; transform: translate(-50%, 10px); } to { opacity:1; transform: translate(-50%, 0); } }

.tabbar {
  position: sticky; bottom: 0; left:0; right:0;
  background: rgba(255,255,255,0.9); backdrop-filter: blur(10px);
  border-top: 1px solid var(--border);
  display:grid; grid-template-columns: repeat(4,1fr);
  padding: 8px 6px calc(8px + env(safe-area-inset-bottom));
  position: relative;
}
.tabbar-indicator {
  position:absolute; top: 4px; height: calc(100% - 8px); width: 25%;
  background: #EAF0E2; border-radius: 14px; transition: left 0.35s cubic-bezier(.25,.9,.35,1); z-index:0;
}
.tabbar-btn {
  position: relative; z-index: 1;
  background: none; border: none; color: var(--ink-soft);
  display:flex; flex-direction:column; align-items:center; gap: 3px;
  padding: 7px 4px; font-size: 10.5px; font-weight: 700;
  transition: color 0.2s ease;
}
.tabbar-btn.active { color: var(--good); }

@media (min-width: 461px) {
  .napp { border-left: 1px solid var(--border); border-right: 1px solid var(--border); min-height: 100vh; }
}
`;
