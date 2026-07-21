import { cn } from "@/lib/utils";

export type StatusKind =
  | "connected"
  | "rnr"
  | "reconnect"
  | "junk"
  | "not_interested"
  | "passed"
  | "failed"
  | "pending"
  | "active"
  | "inactive"
  | "neutral";

const STYLES: Record<StatusKind, { className: string; label: string }> = {
  connected: { className: "bg-success/10 text-success", label: "Connected" },
  rnr: { className: "bg-amber-100 text-amber-800", label: "RNR" },
  reconnect: { className: "bg-blue-100 text-blue-800", label: "Reconnect" },
  junk: { className: "bg-muted text-muted-foreground", label: "Junk" },
  not_interested: { className: "bg-destructive/10 text-destructive", label: "Not Interested" },
  passed: { className: "bg-success/10 text-success", label: "Passed" },
  failed: { className: "bg-destructive/10 text-destructive", label: "Failed" },
  pending: { className: "bg-amber-100 text-amber-800", label: "Pending" },
  active: { className: "bg-success/10 text-success", label: "Active" },
  inactive: { className: "bg-muted text-muted-foreground", label: "Inactive" },
  neutral: { className: "bg-muted text-muted-foreground", label: "—" },
};

export function StatusPill({ kind, label, className }: { kind: StatusKind; label?: string; className?: string }) {
  const s = STYLES[kind] ?? STYLES.neutral;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium",
        s.className,
        className,
      )}
    >
      {label ?? s.label}
    </span>
  );
}

export function stageToPill(stage: string): { kind: StatusKind; label: string } {
  if (stage === "calling_pending") return { kind: "pending", label: "Calling" };
  if (stage === "profile_creation_pending") return { kind: "pending", label: "Expert Creation" };
  const m = stage.match(/^round_(\d+)_pending$/);
  if (m) return { kind: "pending", label: `Round ${m[1]}` };
  if (stage === "active") return { kind: "active", label: "Active" };
  if (stage === "profile_created") return { kind: "passed", label: "Profile Created" };
  if (stage === "failed") return { kind: "failed", label: "Failed" };
  if (stage === "junk") return { kind: "junk", label: "Junk" };
  if (stage === "not_interested") return { kind: "not_interested", label: "Not Interested" };
  return { kind: "neutral", label: stage };
}
