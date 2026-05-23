import { redirect } from "next/navigation";
import { auth } from "@auth";
import { db } from "@/lib/db";
import Navbar from "@/components/Navbar";
import RoomsClient from "@/components/RoomsClient";

export default async function RoomsPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const userId = session.user.id;

  const memberships = await db.roomMember.findMany({
    where: { userId },
    include: {
      room: {
        include: {
          members: true,
        },
      },
    },
  });

  const rooms = memberships.map((m) => ({
    id: m.room.id,
    name: m.room.name,
    inviteCode: m.room.inviteCode,
    memberCount: m.room.members.length,
    createdAt: m.room.createdAt.toISOString(),
  }));

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white">Rooms</h1>
          <p className="text-gray-400 mt-1">
            Compete with friends in private leaderboards.
          </p>
        </div>
        <RoomsClient rooms={rooms} />
      </div>
    </div>
  );
}
