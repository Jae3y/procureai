import { addDays, formatCivilDate, lagosDate } from "@/lib/ai/dates";

export interface ExampleRequest {
  short: string;
  full: string;
}

const BASE = [
  { short: "300 T-shirts for an event", what: "300 branded T-shirts, under ₦1.5m", leadDays: 21 },
  { short: "120 lab coats for a class", what: "120 lab coats, under ₦1.1m", leadDays: 28 },
  { short: "40 cartons for a shop", what: "40 cartons of noodles, under ₦600k", leadDays: 14 },
] as const;

/**
 * The sample purchases shown on the homepage and the purchase page. Their delivery dates are worked out from today
 * (Lagos time) on every request, so an example never asks for a date that has already passed.
 */
export function exampleRequests(now: Date = new Date()): ExampleRequest[] {
  const today = lagosDate(now);
  return BASE.map((e) => ({ short: e.short, full: `${e.what}, delivered by ${formatCivilDate(addDays(today, e.leadDays))}` }));
}
