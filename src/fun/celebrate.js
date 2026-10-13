// The one place the game becomes sound, speech, buzz, confetti, toasts and modals, and the one gate celebrations pass through.
// A celebration (confetti, a toast, the level-up modal, a badge) waits while a round is running or a punch window is open and
// plays when the round ends; a late one is dropped, not played. Nothing outside this file calls the kit's juice functions (a
// test greps for that). The in-round readouts (a thud per punch, a stamp's note) are the game's own feedback, not celebrations:
// they are quiet sounds with a visual twin on screen, and they never touch the gate.
import { createQuietGate, createSound, playOutcome, setReducedMotion, dismissCelebrations } from "../vendor/fun-kit/index.js";
import { getKit } from "./kit.js";
import { SOUND_PLANS, HIT_SOUND, JUDGMENT_SOUND, FEATURES } from "./config.js";
import { hapticAllowed } from "./rules.js";

const live = { quiet: () => false, windowOpen: () => false, lastOnsetT: null, device: null, now: () => performance.now() };

/** Closed while a round is running or a punch window is open. */
export const gate = createQuietGate({ isQuiet: () => live.quiet() || live.windowOpen(), pollMs: 400 });

export const sound = createSound({ store: getKit().store, plans: SOUND_PLANS, volume: 0.5 });

/** What the layer needs from the page: is a round running, is a punch window open. */
export function bind({ quiet, windowOpen, now } = {}) {
  if (quiet) live.quiet = quiet;
  if (windowOpen) live.windowOpen = windowOpen;
  if (now) live.now = now;
}
/** A punch started (for the haptic budget). */
export function noteOnset(t) { live.lastOnsetT = t; }
/** Audio only starts after a tap or a key; arm that once. */
export const armSound = () => sound.armOnGesture();
export const unlockSound = () => { try { sound.unlock(); } catch { /* no audio here */ } };
export const setSoundOn = (on) => sound.setMuted(!on, { persist: false });   // an app-level preference kept in the page's own settings
export const soundOn = () => !sound.muted;

// ---- readouts: the game's own feedback --------------------------------------------------------------------------------
export function readout(name, o = {}) { try { return sound.play(name, o); } catch { return false; } }
export const punchSound = (type) => readout(HIT_SOUND[type] ?? HIT_SOUND.jab);
export const judgmentSound = (j) => readout(JUDGMENT_SOUND[j] ?? JUDGMENT_SOUND.missed);

/** The coach's voice: a visible banner always carries the same call, so speech is optional. */
export function say(text) {
  try {
    const ss = globalThis.speechSynthesis;
    if (!ss || typeof globalThis.SpeechSynthesisUtterance !== "function") return false;
    ss.cancel();
    const u = new globalThis.SpeechSynthesisUtterance(text);
    u.rate = 1.2; u.volume = 0.9;
    ss.speak(u);
    return true;
  } catch { return false; }
}
export function hush() { try { globalThis.speechSynthesis?.cancel(); } catch { /* nothing speaking */ } }

// ---- haptics -----------------------------------------------------------------------------------------------------
/**
 * A reward buzz on a connected device. Nothing sends a vibration in this build (TODO[SDK]: the wrist and insole adapters),
 * so with no device bound this is a no-op. When one is bound the budget still holds: never while a punch window is open
 * and never within 350 ms of an onset, because vibration adds acceleration noise to the measurement. A buzz is never the only
 * signal either: every moment that would buzz also has a stamp, a note and a sound.
 */
export function buzz(name) {
  if (!live.device) return false;
  if (!hapticAllowed({ now: live.now(), lastOnsetT: live.lastOnsetT, windowOpen: live.windowOpen() })) return false;
  try { live.device(name); return true; } catch { return false; }
}
export const bindDevice = (fn) => { live.device = typeof fn === "function" ? fn : null; };

// ---- celebrations ----------------------------------------------------------------------------------------------------
/**
 * Everything a round (or a level-up from a label review) earned, as one gated unit: the kit's staged cues (level-up with its modal and the features it opens,
 * personal bests, badges, a kind note). Plays when the gate is open, which is the moment a round ends; waits (and is dropped
 * if it waits too long) while one is running.
 * @param {{outcome:object}} bundle
 * @returns {Promise<{ran:boolean, result?:string[], reason?:string}>} settles when the staged cues and any level-up modal are done
 */
export function celebrateOutcome({ outcome }) {
  const kit = getKit();
  const handle = gate.run(async () => playOutcome(outcome, {
    sound: soundOn() ? sound : null, haptics: null, guardrails: kit.guard, modal: true, maxToasts: 3, maxBadgeToasts: 2,
    featureLabel: (id) => FEATURES[id]?.label ?? id,
  }), { label: "round", key: "round-outcome", priority: 2, maxAgeMs: 10 * 60000 });
  return handle.done;
}

/** Take every toast, modal and particle down (a new round starts, the view changes) and drop what is waiting. */
export function dismissAll() { try { dismissCelebrations({ gate }); } catch { /* nothing on screen */ } }

/** The motion setting: "reduce", "full" or null/"auto" (follow the device). Drives the kit's effects and, through data-motion, this page's CSS. */
export function setMotion(mode) {
  const root = globalThis.document?.documentElement;
  if (root) { if (mode === "reduce" || mode === "full") root.dataset.motion = mode; else delete root.dataset.motion; }
  setReducedMotion(mode === "reduce" ? true : mode === "full" ? false : null);
}
