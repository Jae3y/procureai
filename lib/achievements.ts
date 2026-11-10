import { COMPANY_NAME, COMPANY_RC } from "./legal";

/**
 * What the rolling banner on the homepage says. Only facts the owner has confirmed belong here:
 * add a line when a new win, partnership or registration is real, and not before.
 */
export type Achievement = { tag: string; text: string };

export const ACHIEVEMENTS: Achievement[] = [
  { tag: "Winner", text: "ProcureAI wins first prize at the DBN Business Grant" },
  { tag: "Winner", text: "ProcureAI takes first place at the GDG x DevFest Hackathon" },
  { tag: "Registered", text: `${COMPANY_NAME} is registered with the CAC, RC ${COMPANY_RC}` },
];
