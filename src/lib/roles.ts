// Display labels for role values. The DB/role-check value stays "lma" etc —
// only the label shown in the UI changes. Keep in sync with Role in auth.ts.
export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  lma: "Telecaller",
  kam: "Round Taker",
  sme: "Expert Creation",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
