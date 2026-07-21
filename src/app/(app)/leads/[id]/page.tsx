import { getSessionUser } from "@/lib/auth";
import { LeadDetailClient } from "@/components/leads/lead-detail-client";

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  return <LeadDetailClient id={params.id} userEmail={user!.email} />;
}
