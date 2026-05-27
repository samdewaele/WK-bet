"use client";

import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Navbar from "@/components/Navbar";

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/groups");
    }
  }, [status, router]);

  if (status === "authenticated") return null;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-400/10 via-transparent to-blue-900/20 pointer-events-none" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <div className="flex justify-center mb-6">
            <span className="text-7xl">⚽</span>
          </div>
          <p className="text-amber-400 font-semibold text-lg mb-3 tracking-widest uppercase">
            FIFA World Cup 2026
          </p>
          <h1 className="text-5xl sm:text-7xl font-extrabold mb-6 leading-tight">
            Bet with{" "}
            <span className="text-amber-400">friends.</span>
          </h1>
          <p className="text-gray-400 text-xl max-w-2xl mx-auto mb-10">
            Create a private betting group, set an entry fee, invite your mates,
            and compete across the full tournament — group stage standings,
            knockout scores, and side bets.
          </p>
          <button
            onClick={() => signIn("google", { callbackUrl: "/groups" })}
            className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold px-10 py-4 rounded-xl text-lg transition-colors"
          >
            Sign in with Google — it&apos;s free
          </button>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold text-center text-white mb-10">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            {
              step: "1",
              title: "Create a group",
              body: "Pick a name and set an optional entry fee. Share the invite code with your friends.",
            },
            {
              step: "2",
              title: "Make your predictions",
              body: "Predict group standings for all 12 WC groups, then make match-by-match predictions through the knockouts.",
            },
            {
              step: "3",
              title: "Win the pot",
              body: "Exact scores win most. Correct winner still earns. Unclaimed money rolls into the Uber Pot — split across side bets.",
            },
          ].map(({ step, title, body }) => (
            <div key={step} className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
              <div className="w-10 h-10 rounded-full bg-amber-400 text-gray-900 font-extrabold text-lg flex items-center justify-center mx-auto mb-4">
                {step}
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">{title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Prize breakdown */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
          <h2 className="text-xl font-bold text-white mb-6">Prize breakdown</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-amber-400 font-semibold mb-3">50% — Group stage</p>
              <ul className="space-y-1 text-gray-400">
                <li>Split equally across 12 WC groups</li>
                <li>All 4 correct → full group prize</li>
                <li>Top 2 correct → 75%</li>
                <li>Only 1st correct → 50%</li>
              </ul>
            </div>
            <div>
              <p className="text-amber-400 font-semibold mb-3">50% — Knockout</p>
              <ul className="space-y-1 text-gray-400">
                <li>Equal prize pool per KO round</li>
                <li>Stakes double every round</li>
                <li>Exact score → full match prize</li>
                <li>Correct winner → 75%</li>
              </ul>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-gray-800 text-sm text-gray-400">
            <span className="text-white font-semibold">Uber Pot</span> — all unclaimed prize money accumulates and is split equally across admin-created side bets (top scorer, first red card, etc.)
          </div>
        </div>
      </section>

      {/* CTA footer */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 text-center">
        <div className="bg-gradient-to-r from-amber-400/20 via-amber-400/10 to-amber-400/20 border border-amber-400/30 rounded-xl p-10">
          <h2 className="text-3xl font-bold text-white mb-4">Ready to play?</h2>
          <p className="text-gray-400 mb-8">
            Create your group before the first whistle — June 2026.
          </p>
          <button
            onClick={() => signIn("google", { callbackUrl: "/groups" })}
            className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold px-10 py-4 rounded-xl text-lg transition-colors"
          >
            Get started
          </button>
        </div>
      </section>
    </div>
  );
}
