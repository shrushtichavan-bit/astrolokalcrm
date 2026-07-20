import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDuplicateLog } from "@/lib/admin.functions";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/admin/duplicates")({
  component: DuplicatesPage,
});

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DuplicatesPage() {
  const fn = useServerFn(getDuplicateLog);
  const q = useQuery({ queryKey: ["admin-duplicates"], queryFn: () => fn() });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Leads blocked because their contact number matched an existing lead — from both the Add Lead
        form and sheet sync.
      </p>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Incoming Name</th>
                <th className="px-4 py-2 text-left">Contact</th>
                <th className="px-4 py-2 text-left">Source</th>
                <th className="px-4 py-2 text-left">Matched Lead</th>
                <th className="px-4 py-2 text-left">Detected By</th>
                <th className="px-4 py-2 text-left">Detected At</th>
              </tr>
            </thead>
            <tbody>
              {(q.data?.rows ?? []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-4 py-2">{r.incoming_name ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums">{r.incoming_contact}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.incoming_source ?? "—"}</td>
                  <td className="px-4 py-2">
                    {r.matched_lead_id ? (
                      <Link
                        to="/leads/$id"
                        params={{ id: r.matched_lead_id }}
                        className="text-[#F45722] hover:underline"
                      >
                        View lead
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        Duplicate within same sheet batch
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.detected_by}</td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDateTime(r.detected_at)}</td>
                </tr>
              ))}
              {!q.isLoading && (q.data?.rows ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    No duplicates caught
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
