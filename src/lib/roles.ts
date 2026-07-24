// Display labels for role values. Keep in sync with Role in auth.ts.
// admin: full access. kam: allotment + oversight (allotment, all leads, add
// lead, config, sync, dashboard). lma: round 1/2 interviews + expert profile
// creation. telecaller: calling attempts only.
export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  kam: "KAM",
  lma: "LMA",
  telecaller: "Telecaller",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
