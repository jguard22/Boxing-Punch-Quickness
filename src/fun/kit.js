// The one createFunKit config for Bag Work, and the two instances made from it:
//   kit      the real profile (localStorage under fk:boxing-demo:*)
//   demoKit  a throwaway profile on memory storage for Simulate, so a demo can show a level-up and nothing from it persists
//            (the one thing it hands to the real profile is the Welcome Bonus, through demoKit.awardToParent).
// Instances are made on first use, so a page opened with ?fun=0 never touches storage.
import { createFunKit, createMemoryStorage, setLabels } from "../vendor/fun-kit/index.js";
import { APP, APP_NAME, CURVE, TITLES, WEEKLY, XP, BADGES, FEATURES, DROPS, PB_METRICS } from "./config.js";
import { COPY } from "./copy.js";

// The kit's welcome-back lines in this page's voice. A lapse is never a loss here: the best run is kept and the comeback pays a bonus.
setLabels({ comebackLong: COPY.comeback.long, comebackShort: COPY.comeback.short });

let speedUnit = () => "ms";
/** The page's m/s or mph choice. Storage and the kit stay metric; only the words about a speed convert. */
export const useSpeedUnit = (getter) => { speedUnit = typeof getter === "function" ? getter : speedUnit; };
/** "8.4 m/s" or "18.8 mph" from a speed stored in m/s. */
export function fmtSpeed(ms) {
  const unit = speedUnit() === "mph" ? "mph" : "ms";
  const core = globalThis.BPCore;
  const n = core ? core.fmtSpeed(ms, unit, 1) : Number(ms).toFixed(1);
  return `${n} ${unit === "mph" ? "mph" : "m/s"}`;
}
const pbMetrics = () => PB_METRICS.map(({ speed, ...m }) => (speed ? { ...m, format: fmtSpeed } : m));

/** The kit configuration. Playful mode (Boxing is sport, not health), weekly sessions ring, rest built in, cosmetic-only surprises. */
export const KIT_CONFIG = Object.freeze({
  app: APP, appName: APP_NAME, mode: "playful", rolloverHour: 4,
  guardrails: { streakMode: "weekly", dailyXpSoftCap: XP.dayCap },
  titles: TITLES, curve: CURVE,
  baseSessionXp: 0, firstSessionXp: 0, partialXp: 0, pbXp: 0,         // XP comes from the round's own table (rules.roundXp), not from the kit's session defaults
  streaks: { weeklyTarget: WEEKLY.target, unit: WEEKLY.unit, earnEvery: WEEKLY.earnEvery },
  rewardOptions: { baseChance: 0.2, pityAfter: 6, minGapSessions: 1 },
  badges: BADGES, challengeTemplates: [], quests: [], features: FEATURES, drops: DROPS, get pbMetrics() { return pbMetrics(); },
});

export const makeKit = (overrides = {}) => createFunKit({ ...KIT_CONFIG, ...overrides });

let real = null;
/** The real profile, made on first use. */
export const getKit = () => (real ??= makeKit());

/**
 * The throwaway Simulate profile: the same configuration on its own memory storage (a second kit instance), surprises off so a demo
 * is always the same demo. Nothing it earns is saved; the one thing handed to the real profile is the Welcome Bonus, through
 * demo.awardToParent(). Call demo.dispose() when it is dropped.
 */
export const makeDemoKit = (kit = getKit()) =>
  kit.fork({ storage: createMemoryStorage(), app: APP, rewardOptions: { ...KIT_CONFIG.rewardOptions, enabled: false } });
