// Shared by client and server; kept dependency-free so it doesn't bloat the browser bundle.

/** Max characters accepted in the "tell us when you're free" box. */
export const MAX_TEXT = 200;

export const OFF_TOPIC_MESSAGE =
  "That box is only for when you can play, e.g. “weekday evenings, not Friday”. Or just tick the slots.";

export const OFF_TOPIC_PITCH_MESSAGE =
  "That box is only for when the pitch is free, e.g. “7pm every day except Sunday”. Or use “Tap to pick”.";

/**
 * Safety ceiling on kick-off times per game. Not a product limit: the setup
 * screen can produce at most 4 weeks × 7 days × 4 times = 112.
 */
export const MAX_SLOTS = 120;
