import { Suspense } from "react";
import { GameView } from "@/components/GameView";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-slate-500">Loading…</p>}>
      <GamePage params={params} />
    </Suspense>
  );
}

async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GameView id={id} />;
}
