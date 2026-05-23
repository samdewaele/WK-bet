"use client";

import { useSession, signIn } from "next-auth/react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { ROUND_LABELS, ROUND_ORDER, getRoundPoints } from "@/lib/points";

export default function HomePage() {
  const { data: session } = useSession();

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-400/10 via-transparent to-blue-900/20 pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <div className="flex justify-center mb-6">
            <span className="text-7xl">⚽</span>
          </div>
          <p className="text-amber-400 font-semibold text-lg mb-3 tracking-widest uppercase">
            FIFA World Cup 2026
          </p>
          <h1 className="text-5xl sm:text-7xl font-extrabold mb-6 leading-tight">
            Predict.{" "}
            <span className="text-amber-400">Compete.</span>{" "}
            Win.
          </h1>
          <p className="text-gray-400 text-xl max-w-2xl mx-auto mb-10">
            Make your match predictions, earn points, and climb the leaderboard
            with friends. The first World Cup with 48 teams — 104 matches of pure football drama.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {session ? (
              <Link
                href="/predict"
                className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold px-8 py-4 rounded-xl text-lg transition-colors"
              >
                Go to Predictions →
              </Link>
            ) : (
              <button
                onClick={() => signIn("google", { callbackUrl: "/predict" })}
                className="inline-flex items-center gap-2 bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold px-8 py-4 rounded-xl text-lg transition-colors"
              >
                Sign in with Google
              </button>
            )}
            <Link
              href="/leaderboard"
              className="inline-flex items-center gap-2 border border-gray-700 hover:border-amber-400 text-gray-300 hover:text-amber-400 font-semibold px-8 py-4 rounded-xl text-lg transition-colors"
            >
              View Leaderboard
            </Link>
          </div>
        </div>
      </section>

      {/* Tournament Overview */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold text-amber-400 mb-8 text-center">Tournament Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-16">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
            <div className="text-4xl font-extrabold text-amber-400 mb-2">48</div>
            <div className="text-gray-300 font-medium">Teams</div>
            <div className="text-gray-500 text-sm mt-1">from 6 confederations</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
            <div className="text-4xl font-extrabold text-amber-400 mb-2">104</div>
            <div className="text-gray-300 font-medium">Total Matches</div>
            <div className="text-gray-500 text-sm mt-1">72 group + 32 knockout</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 text-center">
            <div className="text-4xl font-extrabold text-amber-400 mb-2">3</div>
            <div className="text-gray-300 font-medium">Host Countries</div>
            <div className="text-gray-500 text-sm mt-1">USA, Canada &amp; Mexico</div>
          </div>
        </div>

        {/* Points System */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
          <h2 className="text-2xl font-bold text-white mb-2">Points System</h2>
          <p className="text-gray-400 mb-6">
            Earn points for correct results and bonus points for exact scores. Higher-stakes rounds reward more points.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-gray-400 font-semibold">Round</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-semibold">Correct Result</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-semibold">Exact Score Bonus</th>
                  <th className="text-center py-3 px-4 text-gray-400 font-semibold">Max Points</th>
                </tr>
              </thead>
              <tbody>
                {ROUND_ORDER.map((round, i) => {
                  const pts = getRoundPoints(round);
                  return (
                    <tr
                      key={round}
                      className={`border-b border-gray-800 ${i % 2 === 0 ? "" : "bg-gray-800/30"}`}
                    >
                      <td className="py-3 px-4 text-white font-medium">{ROUND_LABELS[round]}</td>
                      <td className="py-3 px-4 text-center text-amber-400 font-bold">{pts.result}</td>
                      <td className="py-3 px-4 text-center text-green-400 font-bold">+{pts.exact}</td>
                      <td className="py-3 px-4 text-center text-white font-bold">{pts.result + pts.exact}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      {!session && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-24 text-center">
          <div className="bg-gradient-to-r from-amber-400/20 via-amber-400/10 to-amber-400/20 border border-amber-400/30 rounded-xl p-10">
            <h2 className="text-3xl font-bold text-white mb-4">Ready to play?</h2>
            <p className="text-gray-400 mb-8">
              Join now and start predicting before the first whistle blows.
            </p>
            <button
              onClick={() => signIn("google", { callbackUrl: "/predict" })}
              className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold px-10 py-4 rounded-xl text-lg transition-colors"
            >
              Sign in with Google — it&apos;s free
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
