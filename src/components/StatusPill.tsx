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
  connected:     { bg: "bg-[#DCFCE7]", fg: "text-[#166534]", label: "Connected" },
  rnr:           { bg: "bg-[#FEF3C7]", fg: "text-[#92400E]", label: "RNR" },
  reconnect:     { bg: "bg-[#DBEAFE]", fg: "text-[#1E3A8A]", label: "Reconnect" },
  junk:          { bg: "bg-[#E5E7EB]", fg: "text-[#374151]", label: "Junk" },
  not_interested:{ bg: "bg-[#FEE2E2]", fg: "text-[#7F1D1D]", label: "Not Interested" },
  passed:        { bg: "bg-[#DCFCE7]", fg: "text-[#166534]", label: "Passed" },
  failed:        { bg: "bg-[#FEE2E2]", fg: "text-[#7F1D1D]", label: "Failed" },
  pending:       { bg: "bg-[#FEF3C7]", fg: "text-[#92400E]", label: "Pending" },
  active:        { bg: "bg-[#DCFCE7]", fg: "text-[#166534]", label: "Active" },
  done:          { bg: "bg-[#DCFCE7]", fg: "text-[#166534]", label: "Done" },
  inactive:      { bg: "bg-[#E5E7EB]", fg: "text-[#374151]", label: "Inactive" },
  passed_on:     { bg: "bg-[#FEEEE9]", fg: "text-[#F45722]", label: "Passed to next" },
  neutral:       { bg: "bg-[#FEEEE9]", fg: "text-[#6B6B6B]", label: "—" },
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
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        s.bg,
        s.fg,
        className,
      )}
    >
      {label ?? s.label}
    </span>
  );
}
