// Simplified SM-2 spaced repetition, shared by the desktop (Electron) and mobile apps.
//   grade 0 = Again, 1 = Hard, 2 = Good, 3 = Easy
// Wrong answers reset the card and bring it back in a minute. Cards with a
// history of lapses also get shorter intervals afterwards, so cards you
// struggle with keep showing up more often.

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export function schedule(card, grade, now = Date.now()) {
  let ease = card.ease ?? 2.5;
  let interval = card.interval_days ?? 0;
  const reps = card.repetitions ?? 0;
  const lapses = card.lapses ?? 0;

  if (grade <= 0) {
    return {
      ease: Math.max(1.3, ease - 0.2),
      interval_days: 0,
      repetitions: 0,
      lapses: lapses + 1,
      due_at: now + MINUTE,
    };
  }

  if (grade === 1) {
    ease = Math.max(1.3, ease - 0.15);
    interval = reps === 0 ? 10 / (24 * 60) : Math.max(1, interval * 1.2);
  } else if (grade === 2) {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(interval + 1, interval * ease);
  } else {
    ease += 0.15;
    interval = reps === 0 ? 3 : reps === 1 ? 6 : Math.max(interval + 1, interval * ease * 1.3);
  }

  if (grade >= 2 && lapses > 0) interval *= 1 / (1 + 0.15 * lapses);
  interval = Math.min(365, interval);

  return {
    ease: Math.round(ease * 100) / 100,
    interval_days: interval,
    repetitions: reps + 1,
    lapses,
    due_at: now + Math.round(interval * DAY),
  };
}

/** Next-due interval (ms) for each grade, used to label the review buttons. */
export function previews(card, now = Date.now()) {
  return [0, 1, 2, 3].map((g) => schedule(card, g, now).due_at - now);
}
