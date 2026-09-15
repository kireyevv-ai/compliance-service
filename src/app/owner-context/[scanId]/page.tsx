import { notFound, redirect } from "next/navigation";
import { getOwnerContextForScan } from "@/app/api/owner-context/helpers";
import { OwnerContextFlow } from "@/app/owner-context/components/owner-context-flow";

export const dynamic = "force-dynamic";

export default async function OwnerContextPage({
  params,
  searchParams
}: {
  params: Promise<{ scanId: string }>;
  searchParams: Promise<{ step?: string; done?: string }>;
}) {
  const { scanId } = await params;
  const query = await searchParams;
  const result = await getOwnerContextForScan(scanId);

  if (!result.ok) {
    notFound();
  }

  if (result.ownerContext.shouldSkipOwnerFlow) {
    redirect(`/results/${scanId}`);
  }

  return (
    <main className="shell owner-context-shell">
      <OwnerContextFlow
        initialContext={result.ownerContext}
        initialDone={query.done === "1"}
        initialStepKey={query.step}
      />
    </main>
  );
}
