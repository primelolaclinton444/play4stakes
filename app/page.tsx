import Link from 'next/link';

export default function Page() {
  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl font-extrabold mb-4">Play4Stakes</h1>
        <p className="text-zinc-300 mb-8">
          Preview the games instantly, or log in to create/join challenges with stakes and escrow.
        </p>
        <div className="flex gap-3">
          <Link href="/arcade" className="px-5 py-3 rounded-lg bg-white text-black font-semibold">
            Preview the Games
          </Link>
          <Link href="/auth" className="px-5 py-3 rounded-lg border border-zinc-800">
            Log in / Sign up
          </Link>
        </div>
      </div>
    </main>
  );
}
