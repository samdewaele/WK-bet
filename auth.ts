import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(db as any),
  providers: [Google],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      const isHardcodedAdmin = user.email === "samdewaele1988@gmail.com";
      session.user.role = isHardcodedAdmin ? "admin" : ((user as any).role ?? "user");
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});