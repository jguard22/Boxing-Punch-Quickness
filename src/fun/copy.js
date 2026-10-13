// Every word the fun layer writes, in one place with no DOM and no kit import, so a test can walk all of it through the kit's
// copy lint and the layer's own never-say list (this is bag and pad work: no damage, knockouts, power or force).

const plural = (n, one, many = `${one}s`) => (Number(n) === 1 ? one : many);

export const COPY = {
  safety: "Wrap your hands. Warm up first. Stop if anything hurts.",
  note: "Training and performance summaries, not medical measurements.",

  nav: { label: "Sections", play: "Play", live: "Punches", lab: "Lab details", settings: "Settings" },
  mode: { label: "View", fight: "Fight", lab: "Lab", fightTitle: "Game view: warm-up, coach calls, grades", labTitle: "Lab view: every card, table and export" },
  setup: { open: "Setup", close: "Hide setup", title: "Sensors, simulate, exports and reset" },

  hero: {
    title: "Bag work, but it talks back.",
    sub: "The coach calls a combo, you throw it, the bell keeps score.",
    warmup: "Start 30-second warm-up",
    sim: "Simulate (no sensors)",
    simOn: "Simulating. Tap to stop",
    noSensor: "No wrist sensor is connected yet. Connect one under Setup, or try it with Simulate.",
    backTitle: "Ready for a round?",
    backSub: "Coach calls change every round. Throw what you hear.",
    coach: (rounds, roundText) => `Start Coach Calls: ${rounds} ${plural(rounds, "round")} of ${roundText}`,
    again: "Warm-up again (30 seconds)",
    stop: "Stop",
    firstPunchWait: "Waiting for your first punch...",
  },
  chip: {
    simNote: "Simulate: XP isn't saved, except your Welcome Bonus.",
    welcomeKept: (n) => `Welcome Bonus +${n} XP kept on this device.`,
    xpSaved: "Saved on this device only.",
  },

  coachMarks: {
    punch: "The sensor reads each punch.",
    combo: "Punches within 0.6 seconds chain into a combo.",
    start: "Warm up. Easy jabs.",
    nudgePunch: "Throw an easy jab at the bag. Either wrist works.",
    nudgeCombo: "Throw two punches in a row, under half a second apart.",
    assist: "Nothing yet? Tap Simulate to see how it works.",
    won: "Warm-up done. That was your first win.",
  },

  call: {
    label: "Coach call",
    throw: (names) => `Throw: ${names}`,
    announce: (spoken) => `Call: ${spoken}.`,
    window: "Time left to throw it",
    none: "Coach calls start with your next round.",
    off: "Coach calls are off. Free work still scores a Round Grade.",
    voiceOn: "Voice on",
    voiceOff: "Voice off",
    voiceTitle: "Speak each call out loud",
    read: (read, call) => `The sensor read ${read}. You called ${call}.`,
    countIt: "Count it",
    counted: "Counted",
    countItHelp: "Counts the combo and saves your corrected labels.",
    countItLimit: "That is five counted this round. The rest stay as read.",
    next: "Next call coming up.",
    ready: "Free work until the coach calls. Keep it loose.",
    rest: "Rest. Take all of it.",
  },

  digits: { 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six" },

  judgments: {
    perfect: { name: "Perfect", line: "Right order, right types, tight chain." },
    great: { name: "Great", line: "Right order, right types." },
    good: { name: "Good", line: "Right order, close on the types." },
    count: { name: "Count it?", line: "Right hands. The sensor read other types." },
    missed: { name: "Missed", line: "Not this one. The next call is coming." },
  },

  flow: { chip: (n) => `Flow x${n}`, aria: (n) => `Flow multiplier ${n} of 5` },

  tiers: {
    snap: { name: "Snap", line: (type, pct) => `${pct}% of your ${type} best` },
    sharp: { name: "Sharp", line: (type, pct) => `${pct}% of your ${type} best` },
    steady: { name: "Steady", line: (type, pct) => `${pct}% of your ${type} best` },
    easy: { name: "Easy", line: () => "Easy work counts too." },
    gated: "Speed tiers open after your first minute.",
    none: "Speed tiers appear once you have a speed best.",
  },
  pb: {
    live: (type) => `Speed best for your ${type}`,
    gate: "No speed bests in the warm-up minute.",
  },

  grade: {
    eyebrow: "Round Grade",
    names: { fire: "Fire", sharp: "Sharp", solid: "Solid", warmup: "Warm-up" },
    lines: {
      fire: "A round to remember.",
      sharp: "Clean and steady.",
      solid: "A solid round on the bag.",
      warmup: "Easy round. Easy rounds count.",
    },
    warmupRound: "Warm-up round",
    strong: "Strong finish",
    strongLine: "Your last 30 seconds matched the round.",
    parts: { calls: "Coach calls", pace: "Pace", rhythm: "Rhythm", finish: "Finish", hands: "Both hands" },
    xp: (n) => `+${n} XP`,
    fade: "Speed eased late. Stopping here is a fine call.",
    day: "That's a full day on the bag. Cool down.",
    empty: "No punches were read this round.",
    aria: (name, score, xp) => `Round Grade: ${name}, ${score} points, ${xp} XP.`,
  },

  status: {
    level: "Level",
    xp: (n) => `${n} XP`,
    week: (count, target) => `This week: ${count} of ${target} ${plural(target, "session")}`,
    weekDone: "Weekly goal reached. Rest days are part of the plan.",
  },

  recap: {
    title: "Your round",
    open: "Round recap",
    rounds: "Rounds",
    roundsBig: (n) => `${n} ${plural(n, "round")}`,
    roundsTitle: (grades) => grades,
    roundLine: (n, grade, score, punches, xp) => `Round ${n}: ${grade} ${score} · ${punches} punches · +${xp} XP`,
    warmLine: (punches, xp) => `Warm-up round: ${punches} punches · +${xp} XP`,
    warmTitle: "Warm-up done. Easy rounds count.",
    combo: "Combo highlight",
    comboCalled: (j) => `${j} on a coach call`,
    comboLongest: "Your longest chain",
    comboNone: "No chain yet. A chain is punches under 0.6 seconds apart.",
    comboBook: (n) => `${n} different ${plural(n, "combo")} this session`,
    next: "Up next",
    nextUnlock: (level, what) => `Level ${level} opens ${what}.`,
    nextTop: "Every call is open. Chase a Perfect.",
    nextWeek: (count, target) => `This week: ${count} of ${target} ${plural(target, "session")}.`,
    nextWeekDone: "Weekly goal reached. Rest days are part of the plan.",
    held: (pct) => `Speed held at ${pct}% of round one.`,
    eased: "Speed eased late. A shorter next session is plenty.",
    cleared: "Starting a new session clears this one. Export the CSV first to keep the punches.",
    demoKept: (n) => `Simulate is a demo, so only your Welcome Bonus (+${n} XP) is kept.`,
    demoNone: "Simulate is a demo, so none of this XP is kept.",
    label: "Label Lab",
    labelTitle: (n) => `You coached the coach: ${n} ${plural(n, "punch", "punches")} reviewed.`,
    labelTop: (top) => `The most common mix-up: ${top}.`,
    cta: { coach: "Round 1: Coach Calls", again: "Play again", warm: "Warm-up again", later: "Not now", done: "Done" },
    ctaCoach: (rounds, roundText) => `Round 1: Coach Calls (${rounds} ${plural(rounds, "round")} of ${roundText})`,
    export: "Export punches CSV",
    aria: "Recap of your round",
  },

  labelLab: { xp: "Label reviewed" },

  feedback: {
    ask: "How was that?",
    loved: "Loved it",
    fine: "Fine",
    notForMe: "Not for me",
    thanks: "Thanks. Saved on this device only.",
    settings: "Was this fun?",
    settingsHelp: "One tap. It stays on this device with your first-win time.",
    last: (choice) => `Last answer: ${choice}.`,
  },

  settings: {
    title: "Settings",
    help: "Everything here stays on this device.",
    motion: "Motion",
    motionAuto: "Follow my device",
    motionReduced: "Reduced",
    motionFull: "Full",
    sound: "Sounds",
    soundOn: "On",
    soundOff: "Off",
    voice: "Coach voice",
    calls: "Coach calls",
    on: "On",
    off: "Off",
    theme: "Look",
    themeAuto: "Auto",
    themeLight: "Light",
    themeDark: "Dark",
    units: "Speed units",
    forget: "Forget my data",
    forgetHelp: "Clears XP, badges, bests, answers and fun stats on this device. Your punches and timer settings stay.",
    forgetConfirm: "Click again to forget",
    forgot: "Forgotten. You are back at the start.",
    stats: "Fun stats on this device",
    statsHelp: "Counts only. No sensor values and no names.",
    statsCsv: "Download fun stats CSV",
    firstWin: (s) => `First win: ${s} seconds`,
    firstWinNone: "First win: not yet",
  },

  lab: {
    toggleOpen: "Show lab details",
    toggleClose: "Hide lab details",
    help: "Every table, chart and export from the lab view.",
  },

  celebrate: {
    firstWin: "First win",
    levelNote: (level, title) => `Level ${level}: ${title}`,
    dayCap: "That's a full day on the bag. Cool down.",
  },

  a11y: {
    stamp: (name, line) => `${name}. ${line}`,
    callWindow: (secs) => `${secs} seconds left to throw it`,
    punch: (type, speed, unit) => `${type}, ${speed} ${unit}`,
    live: "Game updates",
  },
};

/** Every string in COPY (functions are called with sample numbers and words), for the copy lint and the never-say list. */
export function allCopy(copy = COPY) {
  const out = [];
  const samples = [[1, "jab", 97, "x", "y"], [3, "hook", 62, 45, "3 min"], [2, "cross", 100, 0, "30 s"]];
  const walk = (v, path) => {
    if (typeof v === "string") out.push({ path, text: v });
    else if (typeof v === "function") for (const s of samples) { try { const r = v(...s); if (typeof r === "string") out.push({ path, text: r }); } catch { /* a sample the function does not take */ } }
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(copy, "COPY");
  return out;
}
