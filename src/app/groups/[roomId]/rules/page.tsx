import Link from "next/link";
import Navbar from "@/components/Navbar";
import { calculatePot, KO_ROUNDS } from "@/lib/pot";

type Props = {
  params: Promise<{ roomId: string }>;
};

export default async function RulesPage({ params }: Props) {
  const { roomId } = await params;

  const examplePot = calculatePot(10, 10);

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <Link
            href={`/groups/${roomId}`}
            className="text-gray-400 hover:text-amber-400 text-sm transition-colors"
          >
            ← Back to group
          </Link>
          <h1 className="text-3xl font-bold text-white mt-3">How It Works</h1>
          <p className="text-gray-400 mt-1">Full rules for the WK Bet 2026 betting pool.</p>
        </div>

        <div className="space-y-8">
          {/* Pot breakdown */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-bold text-amber-400 mb-4">The Pot</h2>
            <p className="text-gray-300 mb-4">
              All entry fees are pooled together. The pot is split equally into two halves:
            </p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-amber-400">50%</div>
                <div className="text-sm text-gray-400 mt-1">Group Stage</div>
                <div className="text-xs text-gray-500 mt-1">Split across 12 WC groups</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-amber-400">50%</div>
                <div className="text-sm text-gray-400 mt-1">Knockout Rounds</div>
                <div className="text-xs text-gray-500 mt-1">Higher rounds = bigger prizes</div>
              </div>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <div className="font-semibold text-blue-300 mb-1">Uber Pot</div>
              <p className="text-sm text-gray-300">
                Any unclaimed money (e.g. no one predicted the correct winner) flows into the Uber
                Pot. This is distributed equally across all side bets. At least 1 side bet is
                required for the Uber Pot to pay out.
              </p>
            </div>
          </section>

          {/* Group stage */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-bold text-amber-400 mb-4">Group Stage Predictions</h2>
            <p className="text-gray-300 mb-4">
              Predict the final 1st–4th place standings for each of the 12 WC groups (A–L).
              Predictions lock once the first match of that group kicks off.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2">Prediction accuracy</th>
                  <th className="text-right py-2">Prize share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                <tr>
                  <td className="py-3 text-gray-200">All 4 positions correct</td>
                  <td className="py-3 text-right text-amber-400 font-bold">100%</td>
                </tr>
                <tr>
                  <td className="py-3 text-gray-200">Top 2 (1st & 2nd) correct</td>
                  <td className="py-3 text-right text-amber-400 font-bold">75%</td>
                </tr>
                <tr>
                  <td className="py-3 text-gray-200">Only 1st place correct</td>
                  <td className="py-3 text-right text-amber-400 font-bold">50%</td>
                </tr>
                <tr>
                  <td className="py-3 text-gray-200">No match</td>
                  <td className="py-3 text-right text-gray-500">0%</td>
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-gray-500 mt-3">
              Prize shares are split equally among all players who achieve the same level of
              accuracy for that group.
            </p>
          </section>

          {/* Knockout */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-bold text-amber-400 mb-4">Knockout Predictions</h2>
            <p className="text-gray-300 mb-4">
              Predict the exact score of each knockout match. Locks at kickoff.
            </p>
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2">Prediction accuracy</th>
                  <th className="text-right py-2">Prize share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                <tr>
                  <td className="py-3 text-gray-200">Exact score</td>
                  <td className="py-3 text-right text-amber-400 font-bold">100%</td>
                </tr>
                <tr>
                  <td className="py-3 text-gray-200">Correct winner / draw</td>
                  <td className="py-3 text-right text-amber-400 font-bold">75%</td>
                </tr>
                <tr>
                  <td className="py-3 text-gray-200">Wrong result</td>
                  <td className="py-3 text-right text-gray-500">0%</td>
                </tr>
              </tbody>
            </table>

            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              Prize per match (example: 10 players × €10 entry)
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left py-2">Round</th>
                  <th className="text-right py-2">Matches</th>
                  <th className="text-right py-2">Prize per match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {KO_ROUNDS.map((round) => (
                  <tr key={round}>
                    <td className="py-3 text-gray-200">{round}</td>
                    <td className="py-3 text-right text-gray-400">
                      {round === "R32" ? 16 : round === "R16" ? 8 : round === "QF" ? 4 : round === "SF" ? 2 : 1}
                    </td>
                    <td className="py-3 text-right text-amber-400 font-bold">
                      €{examplePot.prizePerKOMatch[round].toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Side bets */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-bold text-amber-400 mb-4">Side Bets</h2>
            <p className="text-gray-300 mb-3">
              Admins create fun side bets (e.g. &ldquo;Who will be top scorer?&rdquo;). All players submit their
              answer. The admin settles by picking the winning entry.
            </p>
            <p className="text-gray-300 mb-3">
              The Uber Pot is divided equally across all side bets. Each settled side bet winner
              claims their share.
            </p>
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4 text-sm text-orange-300">
              At least 1 side bet must exist for the Uber Pot to be distributed. If there are no
              side bets, unclaimed funds stay in the Uber Pot.
            </div>
          </section>

          {/* P2P bets */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-bold text-amber-400 mb-4">Player vs Player Bets</h2>
            <p className="text-gray-300 mb-3">
              Challenge any other member to a custom side bet for any amount. P2P bets are
              completely separate from the main pot.
            </p>
            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
              <li>Propose a bet with a description and amount (optionally target a specific player).</li>
              <li>The other player accepts or declines.</li>
              <li>Once settled, the proposer marks the winner.</li>
            </ol>
          </section>

          {/* Deadlines */}
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-bold text-amber-400 mb-4">Prediction Deadlines</h2>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>
                <span className="text-white font-medium">Group standings:</span> Locked when the
                first match of that WC group kicks off.
              </li>
              <li>
                <span className="text-white font-medium">Knockout matches:</span> Locked at match
                kickoff time.
              </li>
              <li>
                <span className="text-white font-medium">Side bets:</span> Open until the admin
                settles them.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
