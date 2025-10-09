import Link from 'next/link';
export default function Page() {
  return (
    <main style={{padding: 24}}>
      <h1>Play4Stakes</h1>
      <p>Landing page.</p>
      <Link href="/arcade">Go to Arcade →</Link>
    </main>
  );
}
