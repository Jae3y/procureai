/**
 * What the rolling banner on the homepage says. Only facts the owner has confirmed belong here:
 * add a line when a new win, partnership or appointment is real, and not before.
 */
export type Achievement = { tag: string; text: string };

export const ACHIEVEMENTS: Achievement[] = [
  { tag: "Winner", text: "ProcureAI wins the ₦3 million first prize at the DBN Business Grant" },
  { tag: "Winner", text: "ProcureAI takes first place at the Google Developer Groups DevFest Hackathon" },
];
