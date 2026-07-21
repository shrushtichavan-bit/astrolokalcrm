// Exact priority color rule from spec: P1 red, P2 orange (brand primary),
// P3 amber, P4/P5+ grey. Uses the literal hex values rather than the
// semantic badge variants since this mapping is priority-specific, not a
// general status color.
function priorityStyle(priority: number): { bg: string; fg: string } {
  if (priority === 1) return { bg: "#FBCDCD", fg: "#D32F2F" };
  if (priority === 2) return { bg: "#FEEEE9", fg: "#F45722" };
  if (priority === 3) return { bg: "#FFF9F1", fg: "#B3721E" };
  return { bg: "#ECECEE", fg: "#5D727C" };
}

export function PriorityBadge({ priority, className }: { priority: number; className?: string }) {
  const s = priorityStyle(priority);
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${className ?? ""}`}
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      P{priority}
    </span>
  );
}
