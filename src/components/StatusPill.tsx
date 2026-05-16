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
  | "done"
  | "inactive"
  | "passed_on"
  | "neutral";

const STYLES: Record<StatusKind, { bg: string; fg: string; label: string }> = {
  connected:      { bg: "bg-[#F0FDF4]", fg: "text-[#166534]", label: "Connected" },
  rnr:            { bg: "bg-[#FFFBEB]", fg: "text-[#92400E]", label: "RNR" },
  reconnect:      { bg: "bg-[#EFF6FF]", fg: "text-[#1E40AF]", label: "Reconnect" },
  junk:           { bg: "bg-[#F3F4F6]", fg: "text-[#374151]", label: "Junk" },
  not_interested: { bg: "bg-[#FEF2F2]", fg: "text-[#991B1B]", label: "Not Interested" },
  passed:         { bg: "bg-[#F0FDF4]", fg: "text-[#166534]", label: "Passed" },
  failed:         { bg: "bg-[#FEF2F2]", fg: "text-[#991B1B]", label: "Failed" },
  pending:        { bg: "bg-[#FFFBEB]", fg: "text-[#92400E]", label: "Pending" },
  active:         { bg: "bg-[#F0FDF4]", fg: "text-[#166534]", label: "Active" },
  done:           { bg: "bg-[#F0FDF4]", fg: "text-[#166534]", label: "Done" },
  inactive:       { bg: "bg-[#F3F4F6]", fg: "text-[#374151]", label: "Inactive" },
  passed_on:      { bg: "bg-[#FEEEE9]", fg: "text-[#F45722]", label: "Passed on" },
  neutral:        { bg: "bg-[#F3F4F6]", fg: "text-[#6B6B6B]", label: "—" },
};

export function StatusPill({
  kind,
  label,
  className,
}: {
  kind: StatusKind;
  label?: string;
  className?: string;
}) {
  const s = STYLES[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[6px] px-2 py-[2px] text-xs font-medium whitespace-nowrap",
        s.bg,
        s.fg,
        className,
      )}
    >
      {label ?? s.label}
    </span>
  );
}
