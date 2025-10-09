'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AuthPage() {
  const router = useRouter();
  return (
    <main className="min-h-screen px-6 py-12">
      <div className="max-w-md mx-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
        <h1 className="text-2xl font-bold mb-2">Log in / Sign up</h1>
        <p className="text-sm text-zinc-400 mb-4">
          Auth placeholder — we’ll swap in Supabase Auth next.
        </p>
        <button
          onClick={() => router.push('/arcade')}
          className="w-full px-4 py-2 rounded-lg bg-white text-black font-semibold"
        >
          Continue to Arcade
        </button>
        <Link href="/" className="block text-center text-zinc-400 text-sm mt-3">
          ← Back to landing
        </Link>
      </div>
    </main>
  );
}
