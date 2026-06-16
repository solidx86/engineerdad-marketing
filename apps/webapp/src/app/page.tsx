import Link from "next/link";

export default function Dashboard() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <p className="text-slate-600 mb-6">Pick a run to inspect, or browse the entity lists under Marketing Review.</p>
      <Link href="/runs" className="inline-block bg-indigo-600 text-white rounded px-4 py-2 text-sm font-semibold hover:bg-indigo-700">
        Browse runs →
      </Link>
    </div>
  );
}
