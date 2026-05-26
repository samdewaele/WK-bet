# WK-Bet

A Next.js betting app with Google authentication, deployed on Fly.io with a persistent SQLite database.

## Local Development

### Prerequisites

- Node.js 20+
- A Google OAuth app ([create one here](https://console.cloud.google.com/apis/credentials))

### Setup

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/samdewaele/wk-bet.git
cd wk-bet
npm install
```

2. Create a `.env` file in the root:

```env
DATABASE_URL="file:./dev.db"
AUTH_SECRET="any-random-string-for-local-dev"
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"
NEXTAUTH_URL="http://localhost:3000"
```

3. Run migrations, seed, and start:

```bash
npx prisma migrate deploy
npx tsx prisma/seed.ts
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploy to Fly.io

### Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed
- A [Fly.io account](https://fly.io) with a credit card on file (required for volumes)
- Google OAuth credentials with `https://wk-bet.fly.dev/api/auth/callback/google` as an authorized redirect URI

### First-time setup

```bash
fly auth login
fly apps create wk-bet
fly volumes create wkbet_data --size 1 --region ams --app wk-bet
fly secrets set AUTH_SECRET=$(openssl rand -base64 32) GOOGLE_CLIENT_ID=your-id GOOGLE_CLIENT_SECRET=your-secret --app wk-bet
fly deploy
```

### Subsequent deploys

```bash
fly deploy
```

> Use `fly deploy`, not `fly launch`. The launch wizard auto-provisions unwanted services like Tigris object storage.