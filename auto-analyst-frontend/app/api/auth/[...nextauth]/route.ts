import NextAuth from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { profileUtils } from "@/lib/redis"

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code"
        }
      }
    }),
    CredentialsProvider({
      name: "Admin Access",  // or whatever you prefer
      credentials: {
        password: { label: "Admin Code", type: "password" },
        isAdmin: { label: "Is Admin", type: "text" }
      },
      async authorize(credentials) {
        if (credentials?.password === process.env.NEXT_PUBLIC_ANALYTICS_ADMIN_PASSWORD && credentials?.isAdmin === "true") {
          return {
            id: "admin",
            name: "Administrator",
            email: "admin@example.com",
            image: "https://4q2e4qu710mvgubg.public.blob.vercel-storage.com/Auto-analysts%20icon%20small-S682Oi8nbFhOADUHXJSD9d0KtSWKCe.png"
          }
        }
        return null
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
    signOut: '/signout',
  },
  callbacks: {
    async session({ session, token }) {
      // Pass the admin status to the session
      if (token.email === "admin@example.com") {
        session.user.isAdmin = true
      }
      return session
    },
    async jwt({ token, user }) {
      if (user?.email === "admin@example.com") {
        token.isAdmin = true
      }
      return token
    },
    async signIn({ user, account, profile }) {
      // Save the user profile info to Redis when they sign in
      if (user && user.email) {
        try {
          await profileUtils.saveUserProfile(user.id || user.email, {
            email: user.email,
            name: user.name || '',
            image: user.image || '',
            joinedDate: new Date().toISOString().split('T')[0],
            role: 'Free'
          });
        } catch (error) {
          console.error('Error saving user profile during signin:', error);
          // Continue with sign in even if profile saving fails
        }
      }
      return true
    },
  },
})

export { handler as GET, handler as POST } 