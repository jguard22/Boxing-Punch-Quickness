// Bag Work (the fun layer of the Boxing Punch Quickness demo): every number and every piece of content in one place, with no
// DOM and no kit import, so it can be tested on the page's own synthetic punches. The rules here are the guardrails from
// the engagement design: bag and pad work only; rhythm, calls and finishing a round are rewarded; hitting harder, volume,
// fatigue and relabelling punches never are.

export const APP = "boxing-demo";
export const APP_NAME = "Bag Work";

/** Gentle level curve (a kit curve). Cumulative XP always comes from the kit's xpToReach(), never from literals. */
export const CURVE = Object.freeze({ first: 30, linear: 8, quad: 4.5, round: 1 });

/** Twelve level titles. None of them is about power or force. */
export const TITLES = Object.freeze([
  [1, "Walk-In"], [2, "Wrap Hands"], [3, "Bag Rookie"], [4, "Jab Machine"], [5, "One-Two Specialist"], [6, "Combo Cook"],
  [7, "Rhythm Fighter"], [8, "Ring General"], [9, "Round Closer"], [10, "Bag Boss"], [11, "Corner Legend"], [12, "Bell Ringer"],
]);

/** Weekly ring: three sessions a week by default (a session is a full, non-warm-up round or more). */
export const WEEKLY = Object.freeze({ target: 3, unit: "sessions", earnEvery: 4 });

/**
 * XP. Rounds, calls and free combos earn it. There is no XP per punch (that was a volume reward), and nothing here depends on
 * whether a punch label was changed or confirmed.
 */
export const XP = Object.freeze({
  freeCombo: 2, freeComboMax: 5,                       // an uncalled combo of two or more punches, at most five a round
  called: Object.freeze({ good: 3, great: 5, perfect: 8, count: 3 }), calledMax: 15, countItMax: 5,
  round: 15, warmup: 10,                               // a round that ran 90 percent of its clock; the warm-up round pays 10
  strongFinish: 10, session: 25,                       // session: every planned round finished
  minPunches: 5,                                       // a round with fewer punches than this pays no round bonus (standing still earns nothing)
  completeFrac: 0.9,
  welcome: 40,                                         // one time, on the real profile, when the warm-up round ends the first time
  dayCap: 200, roundsPerDay: 12, afterRounds: 1,       // 12 rounds a day; after that each round earns 1 XP
  label: 1, labelMax: 20,                              // Label Lab: a punch you reviewed pays a flat 1, 20 a session, never for "Mark all", never for Simulate
});

/** The warm-up gate: no speed best and no Snap tier in the first minute of a session or anywhere in the warm-up round. */
export const WARM_GATE_MS = 60000;
/** The warm-up round: 30 seconds, one round, no rest. */
export const WARMUP = Object.freeze({ roundMs: 30000, restMs: 0, rounds: 1, warnMs: 10000 });

/** Speed tiers, relative to your own best for that punch type. Shape plus word, never colour alone. */
export const SPEED_TIERS = Object.freeze([
  Object.freeze({ id: "snap", min: 0.95, shape: "diamond" }),
  Object.freeze({ id: "sharp", min: 0.85, shape: "circle" }),
  Object.freeze({ id: "steady", min: 0.7, shape: "triangle" }),
  Object.freeze({ id: "easy", min: 0, shape: "dash" }),
]);

/** Round Grade bands. The warm-up round is always called Warm-up, whatever it scores. */
export const GRADES = Object.freeze([
  Object.freeze({ id: "fire", min: 85, shape: "diamond" }),
  Object.freeze({ id: "sharp", min: 70, shape: "circle" }),
  Object.freeze({ id: "solid", min: 50, shape: "triangle" }),
  Object.freeze({ id: "warmup", min: 0, shape: "dash" }),
]);

/** Round Grade points. Called mode: calls 40, rhythm 35, finish 10, hands 15. Free mode swaps the calls for pace control. */
export const GRADE_POINTS = Object.freeze({ called: 40, pace: 40, rhythm: 35, finish: 10, balance: 15 });
export const RHYTHM_GAP_MS = 450;
export const FINISH_MIN_PUNCHES = 8;
export const STRONG_FINISH_RATIO = 0.95;
export const FADE_STOP_PCT = 25;                       // a round whose speed fell by more than this offers an early stop and earns no Strong Finish
export const BALANCE_BAND = Object.freeze({ full: 10, none: 30 });   // |left share - 50|: full points inside 10, none beyond 30

/** The five judgments of a called combo. Shape plus word. */
export const JUDGMENTS = Object.freeze({
  perfect: Object.freeze({ id: "perfect", shape: "diamond", weight: 1 }),
  great: Object.freeze({ id: "great", shape: "circle", weight: 0.85 }),
  good: Object.freeze({ id: "good", shape: "triangle", weight: 0.6 }),
  count: Object.freeze({ id: "count", shape: "square", weight: 0.5 }),   // "Count it?": the hands were right, the sensor read other types
  missed: Object.freeze({ id: "missed", shape: "dash", weight: 0 }),
});
export const JUDGMENT_ORDER = Object.freeze(["perfect", "great", "good", "count", "missed"]);

/** Call windows. Starting values: tune from real labelled sessions. */
export const CALL = Object.freeze({
  countGapMs: 450,          // the coach speaks one count every 450 ms
  afterLastCountMs: 2500,   // the window stays open this long after the last count was spoken ...
  afterPunchMs: 600,        // ... or this long after the last punch landed, whichever is later
  chainGapMs: 600,          // a gap longer than this ends the response chain (the page's combo rule)
  perfectGapMs: 450,        // every gap in the chain at most this for Perfect
  perfectFirstMs: 1200,     // the first punch within this of the call for Perfect
  // pacing (scaled down for short rounds)
  firstCallMs: 6000, gapMinMs: 11000, gapJitterMs: 4000, endGuardMs: 12000,
});

/** Flow: consecutive Perfect or Great calls raise it, two in a row per step, x1 to x5. A Good or a Missed lowers it by one, silently. */
export const FLOW = Object.freeze({ min: 1, max: 5, perStep: 2 });

/**
 * The Coach Calls ladder, in boxing numbers (1 jab, 2 cross, 3 / 4 lead / rear hook, 5 / 6 lead / rear uppercut).
 * The numbers are lead and rear, so the same call mirrors itself in a southpaw stance.
 */
export const CALL_STAGES = Object.freeze([
  Object.freeze({ id: "stage1", level: 1, calls: Object.freeze(["1", "1-2"]) }),
  Object.freeze({ id: "stage2", level: 2, calls: Object.freeze(["1-1", "1-2-1", "1-1-2"]), feature: "calls2", label: "Stage 2 calls" }),
  Object.freeze({ id: "stage3", level: 3, calls: Object.freeze(["3", "1-2-3", "2-3"]), feature: "calls3", label: "Hook calls" }),
  Object.freeze({ id: "uppercuts", level: 5, calls: Object.freeze(["5", "1-2-5", "2-6"]), feature: "calls5", label: "Uppercut calls" }),
  Object.freeze({ id: "stage4", level: 6, calls: Object.freeze(["1-2-3-2", "1-1-2-3", "1-2-1-2"]), feature: "calls6", label: "Four-punch calls" }),
  Object.freeze({ id: "stage5", level: 8, calls: Object.freeze(["1-2-5-2", "1-6-3-2", "1-2-3-6"]), feature: "calls8", label: "Ring General calls" }),
]);

/** Features the level-up modal lists. Every gated call stage has one at the same level (a test keeps them in step). */
export const FEATURES = Object.freeze({
  calls2: Object.freeze({ level: 2, label: "Stage 2 calls" }),
  calls3: Object.freeze({ level: 3, label: "Hook calls" }),
  calls5: Object.freeze({ level: 5, label: "Uppercut calls" }),
  calls6: Object.freeze({ level: 6, label: "Four-punch calls" }),
  calls8: Object.freeze({ level: 8, label: "Ring General calls" }),
});

/**
 * Starter badges (the design's 1 to 8). None is about punching harder, volume or agreeing with a label. The flags a round
 * passes as `first` are: punch, combo, warmup, round, session, called, perfect.
 */
export const BADGES = Object.freeze([
  { id: "first_punch", title: "First Punch", desc: "Throw a punch and let the sensor read it.", tier: "common", xp: 10, icon: "bolt", rule: { firstTime: "punch" } },
  { id: "first_combo", title: "First Combo", desc: "Chain two punches under 0.6 seconds apart.", tier: "common", xp: 10, icon: "sparkle", rule: { firstTime: "combo" } },
  { id: "warmup_done", title: "Warmed Up", desc: "Finish the 30-second warm-up round.", tier: "common", xp: 10, icon: "check", rule: { firstTime: "warmup" } },
  { id: "first_round", title: "First Round", desc: "Finish a full round on the clock.", tier: "common", xp: 10, icon: "star", rule: { firstTime: "round" } },
  { id: "session_done", title: "Full Session", desc: "Finish every round of a session.", tier: "common", xp: 10, icon: "trophy", rule: { firstTime: "session" } },
  { id: "called_it", title: "Called It", desc: "Land a coach call as Good or better.", tier: "common", xp: 10, icon: "target", rule: { firstTime: "called" } },
  { id: "perfect_timing", title: "Perfect Timing", desc: "Land a coach call as Perfect.", tier: "uncommon", xp: 20, icon: "star", rule: { firstTime: "perfect" } },
  { id: "flow_3", title: "Finding Flow", desc: "Reach Flow x3 in a round.", tier: "common", xp: 10, icon: "flame", rule: { threshold: "flow", gte: 3 } },
]);

/** Personal bests: top hand speed per punch type (after the warm-up gate), best Round Grade, best Flow, longest chain. Speeds are stored in m/s. */
export const PB_METRICS = Object.freeze([
  { id: "speed_jab", label: "Jab speed", better: "higher", speed: true, nearMissPct: 0.03 },
  { id: "speed_cross", label: "Cross speed", better: "higher", speed: true, nearMissPct: 0.03 },
  { id: "speed_hook", label: "Hook speed", better: "higher", speed: true, nearMissPct: 0.03 },
  { id: "speed_uppercut", label: "Uppercut speed", better: "higher", speed: true, nearMissPct: 0.03 },
  { id: "roundGrade", label: "Round Grade", better: "higher", decimals: 0, nearMissAbs: 3 },
  { id: "flow", label: "Flow", better: "higher", decimals: 0, nearMissAbs: 0 },
  { id: "longestChain", label: "Longest chain", better: "higher", decimals: 0, nearMissAbs: 0, unit: "punches" },
]);
export const SPEED_PB_IDS = Object.freeze({ jab: "speed_jab", cross: "speed_cross", hook: "speed_hook", uppercut: "speed_uppercut" });

/** Kind notes: the surprise that costs nothing and is never tied to a measurement. */
export const DROPS = Object.freeze([
  { id: "note_rhythm", kind: "message", title: "A good bag round is mostly rhythm. You found some.", weight: 1 },
  { id: "note_breathe", kind: "message", title: "Breathe out as you throw. It keeps the round smooth.", weight: 1 },
  { id: "note_rest", kind: "message", title: "The rest minute is part of the round. Take all of it.", weight: 1 },
  { id: "note_easy", kind: "message", title: "Easy rounds count too. They are how fast ones happen.", weight: 1 },
  { id: "note_show", kind: "message", title: "You showed up and wrapped up. That is the whole job.", weight: 1 },
]);

/** The first-win script: three beats, each completed by an event the fun layer emits. The last one is the win. */
export const FIRST_WIN = Object.freeze({
  beats: Object.freeze([
    Object.freeze({ id: "punch", on: "punch" }),
    Object.freeze({ id: "combo", on: "combo" }),
    Object.freeze({ id: "warmup", on: "warmup.done" }),
  ]),
  winEvent: "warmup.done", nudgeAfterMs: 10000, assistAfterMs: 25000,
});

// ---- sound -------------------------------------------------------------------------------------------------------

/** Sounds the layer adds to the kit's. Short, soft, synthesised: a thud per punch type, a stamp per judgment. Every one has a visual twin. */
export const SOUND_PLANS = Object.freeze({
  thudJab: [{ f: 150, f2: 70, dur: 0.09, gain: 0.5 }, { f: 1800, dur: 0.015, gain: 0.12, type: "square" }],
  thudCross: [{ f: 118, f2: 52, dur: 0.15, gain: 0.55 }, { f: 900, dur: 0.02, gain: 0.1, type: "square" }],
  thudHook: [{ f: 210, f2: 60, dur: 0.22, gain: 0.42, type: "triangle" }, { f: 640, f2: 160, dur: 0.16, gain: 0.08, type: "sawtooth" }],
  thudUpper: [{ f: 150, f2: 430, dur: 0.15, gain: 0.38, type: "triangle" }, { f: 430, at: 0.12, dur: 0.05, gain: 0.16 }],
  callBlip: [{ f: 660, dur: 0.07, gain: 0.2 }, { f: 880, at: 0.09, dur: 0.1, gain: 0.2 }],
  stampPerfect: [{ f: 1318.5, dur: 0.18, gain: 0.3 }, { f: 1760, at: 0.1, dur: 0.32, gain: 0.3 }],
  stampGreat: [{ f: 1046.5, dur: 0.3, gain: 0.3 }],
  stampGood: [{ f: 659.25, dur: 0.26, gain: 0.24, type: "triangle" }],
  stampCount: [{ f: 880, dur: 0.06, gain: 0.18, type: "square" }],
  stampMiss: [{ f: 196, dur: 0.3, gain: 0.2 }],
  gradeSlam: [{ f: 92, f2: 44, dur: 0.26, gain: 0.55 }, { f: 523.25, at: 0.05, dur: 0.22, gain: 0.18 }],
});
export const HIT_SOUND = Object.freeze({ jab: "thudJab", cross: "thudCross", hook: "thudHook", uppercut: "thudUpper" });
export const JUDGMENT_SOUND = Object.freeze({ perfect: "stampPerfect", great: "stampGreat", good: "stampGood", count: "stampCount", missed: "stampMiss" });

// ---- haptics -----------------------------------------------------------------------------------------------------

/**
 * Haptic budget. The wrist Senses are the measuring instruments and vibration adds acceleration noise, so no buzz is ever sent
 * while a punch window is open or within this long of an onset. No device sends anything in this build (TODO[SDK]); the rule
 * and the vocabulary are here, tested, for the day one does.
 */
export const HAPTIC_QUIET_MS = 350;
export const HAPTIC_AFTER_COMBO_MS = 350;
export const HAPTIC_VOCABULARY = Object.freeze({ landed: "single soft pulse", perfect: "two soft pulses", pb: "two pulses, 200 ms apart", levelUp: "left/right roll" });

// ---- guardrails --------------------------------------------------------------------------------------------------

/** Words that never appear in app copy: this is bag and pad work, and force is not measured. */
export const NEVER_WORDS = Object.freeze(["damage", "knockout", "knock out", "power", "force", "harder", "opponent", "kill", "violence", "revenge"]);
