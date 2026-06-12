import { auth } from "@auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/signin");

  const user = session.user;

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 py-16">
        <h1 className="text-2xl font-bold mb-8">My Account</h1>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-4">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name ?? ""}
                className="w-16 h-16 rounded-full border-2 border-amber-400"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-amber-400 flex items-center justify-center text-gray-900 font-bold text-2xl">
                {user.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            <div>
              <p className="text-lg font-semibold">{user.name ?? "Unknown"}</p>
              <p className="text-sm text-gray-400">{user.email}</p>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Your profile is managed through Google. To change your name or picture, update your Google account.
          </p>
        </div>
        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="mt-6 w-full block text-center bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 font-semibold px-6 py-3 rounded-xl text-sm transition-colors"
          >
            Sign out
          </button>
        </form>
        <Link
          href="/groups"
          className="mt-3 block text-center text-gray-500 hover:text-gray-300 text-sm transition-colors"
        >
          ← Back to my groups
        </Link>
      </div>
    </div>
  );
}
