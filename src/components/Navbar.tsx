"use client";

import Link from "next/link";
import { useSession, signIn, signOut } from "next-auth/react";
import Image from "next/image";

export default function Navbar() {
  const { data: session, status } = useSession();

  return (
    <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 text-amber-400 font-bold text-xl">
            <span className="text-2xl">⚽</span>
            <span>WK Bet 2026</span>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-6">
            <Link
              href="/groups"
              className="text-gray-300 hover:text-amber-400 transition-colors font-medium"
            >
              My Groups
            </Link>
            <Link
              href="/leaderboard"
              className="text-gray-300 hover:text-amber-400 transition-colors font-medium"
            >
              Leaderboard
            </Link>
          </div>

          {/* User area */}
          <div className="flex items-center gap-3">
            {status === "loading" ? (
              <div className="w-8 h-8 rounded-full bg-gray-700 animate-pulse" />
            ) : session?.user ? (
              <div className="flex items-center gap-3">
                {session.user.image ? (
                  <Image
                    src={session.user.image}
                    alt={session.user.name ?? "User"}
                    width={32}
                    height={32}
                    className="rounded-full border-2 border-amber-400"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center text-gray-900 font-bold text-sm">
                    {session.user.name?.[0]?.toUpperCase() ?? "U"}
                  </div>
                )}
                <span className="text-gray-300 text-sm hidden sm:block">
                  {session.user.name}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-sm text-gray-400 hover:text-red-400 transition-colors"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                onClick={() => signIn("google", { callbackUrl: "/groups" })}
                className="bg-amber-400 hover:bg-amber-300 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                Sign In
              </button>
            )}
          </div>
        </div>

        {/* Mobile nav */}
        <div className="md:hidden flex gap-4 pb-3">
          <Link href="/groups" className="text-gray-300 hover:text-amber-400 text-sm transition-colors">
            My Groups
          </Link>
          <Link href="/leaderboard" className="text-gray-300 hover:text-amber-400 text-sm transition-colors">
            Leaderboard
          </Link>
        </div>
      </div>
    </nav>
  );
}
