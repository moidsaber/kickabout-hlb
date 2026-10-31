import { Suspense } from "react";
import { AdminView } from "@/components/AdminView";

export const metadata = { robots: { index: false } };

export default function Page(props: { params: Promise<{ id: string }>; searchParams: Promise<{ key?: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-slate-500">Loading…</p>}>
      <AdminPage {...props} />
    </Suspense>
  );
}

async function AdminPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ key?: string }> }) {
  const [{ id }, { key }] = await Promise.all([params, searchParams]);
  if (!key) return <p className="p-4 text-rose-700">Missing admin key.</p>;
  return <AdminView id={id} adminKey={key} />;
}
