import { ScanStatusView } from "@/app/components/scan-status";

export const dynamic = "force-dynamic";

export default async function ScanStatusPage({ params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;

  return (
    <main className="shell">
      <ScanStatusView scanId={scanId} />
    </main>
  );
}
