// Ready-to-paste WhatsApp messages. Pure functions over the game state.
import type { GameState } from "./service";
import { formatSlot } from "./time";
import { gbp } from "./logic";

const name = (s: GameState, id: string) => {
  const p = s.people.find((x) => x.id === id);
  return p ? (p.isGuest ? `${p.name} (${p.hostName}'s mate)` : p.name) : "?";
};

export function announcementText(s: GameState, url: string) {
  const g = s.game;
  const lines = [
    `⚽ *${g.title}*`,
    g.location ? `📍 ${g.location}${g.mapsUrl ? ` – ${g.mapsUrl}` : ""}` : null,
    `💷 ${gbp(g.costPence)} pitch, split between everyone (~${gbp(Math.ceil(g.costPence / g.cap / 10) * 10)} each if we get ${g.cap})`,
    ``,
    `When can you play?`,
    ...s.slots.map((sl) => `• ${formatSlot(sl.startsAt)}`),
    ``,
    `👉 Tick your times here (takes 10 seconds): ${url}`,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

export function lineupText(s: GameState, url: string) {
  const g = s.game;
  const kit = Object.entries(g.kit ?? {})
    .map(([duty, id]) => `${duty === "ball" ? "⚽ Ball" : "🟧 Bibs"}: ${name(s, id)}`)
    .join("\n");
  return [
    `✅ *${g.title}* is ON – ${g.kickoff ? formatSlot(g.kickoff) : ""}`,
    g.location ? `📍 ${g.location}${g.mapsUrl ? ` – ${g.mapsUrl}` : ""}` : null,
    ``,
    `*Playing (${s.lineup.in.length}/${g.cap})*`,
    ...s.lineup.in.map((id, i) => `${i + 1}. ${name(s, id)}`),
    s.lineup.waitlist.length ? `\n*Waitlist*` : null,
    ...s.lineup.waitlist.map((id, i) => `${i + 1}. ${name(s, id)}`),
    kit ? `\n${kit}` : null,
    s.money ? `\n💷 ${gbp(s.money.perHead)} each` : null,
    ``,
    `Can't make it? Drop out here so the next person gets in: ${url}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function paymentReminderText(s: GameState, url: string) {
  const owing = (s.money?.payers ?? []).filter((p) => p.total > 0);
  if (!owing.length) return `💷 *${s.game.title}* – everyone's paid up. Legends 🙌`;
  return [
    `💷 *${s.game.title}* – ${gbp(s.money!.perHead)} each`,
    ``,
    `Still owed:`,
    ...owing.map((p) => {
      const extras = [p.guests.length ? `incl. ${p.guests.join(", ")}` : "", p.carried > 0 ? `incl. ${gbp(p.carried)} from before` : ""].filter(Boolean).join("; ");
      return `• ${p.name} – ${gbp(p.total)}${extras ? ` (${extras})` : ""}`;
    }),
    ``,
    `One-tap Monzo link for your exact amount here: ${url}`,
  ].join("\n");
}
