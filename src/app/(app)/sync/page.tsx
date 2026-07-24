import { PageHeader } from "@/components/page-header";
import { SheetSyncSection } from "@/components/sync/sheet-sync-section";

export default function SyncPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Lead Automation"
        description="Automated lead intake via Google Forms webhook and master sheet sync will appear here once configured."
      />
      <div className="rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
        Contact your admin to set up lead source integrations.
      </div>

      <SheetSyncSection />
    </div>
  );
}
