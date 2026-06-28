# Handoff: fix wrong KO teams + kickoff times (uid-anchored seeding)

> Working note for continuing across sessions. Branch: `claude/betting-webapp-friends-fD4yG`.
> Delete this file once the fix lands.

## Status
- ✅ **Done & pushed** (`b0df929`): KO bracket tiles now show each match's playing
  date (`formatKickoff` in `src/lib/ko-bracket.ts`, rendered in
  `src/components/KnockoutBracket.tsx`). Unit + e2e tests added. 553 vitest pass.
- ⏳ **Open task:** the dates AND teams shown for KO matches can be wrong because
  the API→slot binding is broken. See diagnosis below.

## Symptom (reported by user)
Wrong starting times **and** wrong teams on KO matches. "Our seeding is completely
broken." User's directive: *"you need a proper uid for each slot — a match exists
irrespective of the teams that play it or the time it takes place."* (Official
seeding: the slot is the stable entity, identified by a stable match id.)

## Root cause
`prisma/seed.ts` (~lines 158-175) binds API fixtures to bracket slots **by date**:

```js
const stageMatches = allApiMatches.filter(m => m.stage === stage)
                                  .sort((a,b) => date(a) - date(b));   // ← BUG
for (let i = 0; i < count; i++) {
  const apiM = stageMatches[i];           // i-th by DATE
  db.match.create({ matchNumber, kickoff: apiM.utcDate, fdMatchId: apiM.id });
  matchNumber++;                          // slot 73,74,... by TOPOLOGY
}
```

Bracket slots (matchNumber 73-104) are ordered by **official FIFA topology**
(`src/lib/ko-seeding.ts` `R32_SLOTS`, `NEXT_ROUND_SLOT`), NOT by kickoff date.
So the i-th-by-date fixture's `id`+`kickoff` get stapled to the wrong slot →
- wrong **kickoff/date** per slot, and
- wrong **fdMatchId** → when that fixture finishes, `sync-matches.ts` (~286,
  `byFdMatchId`) writes its score onto the wrong slot → wrong **teams/score**.

Compounding: `sync-matches.ts:~328` only refreshes `kickoff` for finished/live
matches — scheduled KO kickoffs are never corrected, so a wrong future date sticks.

## The fix (uid-anchored, user's principle)
Bind each slot to its fixture by a **stable id in official order**, never by date
or teams. Then source `kickoff` from the bound fixture on every sync (incl.
scheduled matches), so dates self-correct.

### The one thing that needs a REAL API sample to verify
Does football-data return KO fixtures in an order whose per-stage sequence matches
the app's official `matchNumber` order (LAST_32[0..15] → slots 73..88, etc.)?
- If **yes** (their `id` order == official match order): replace `.sort(by date)`
  with `.sort(by id ascending)` per stage. Clean fix.
- If **no**: build an explicit `officialMatchNumber → fixture.id` map (a constant,
  derived once from the real schedule).

Cannot determine this without seeing one live response.

## How to get the sample
`api.football-data.org` is **egress-blocked** in the default (Trusted) network
policy. To fetch from the sandbox you need a NEW session created after:
1. Environment settings → **Network access = Custom**, add `api.football-data.org`
   (keep default package managers ticked).
2. Same dialog → **Environment variables** → `FOOTBALL_DATA_API_KEY = <key>`.
3. **Start a brand-new session** (changes don't apply to a resumed session).

Then run:
```bash
echo "${FOOTBALL_DATA_API_KEY:+key present}"
curl -s -H "X-Auth-Token: $FOOTBALL_DATA_API_KEY" \
  "https://api.football-data.org/v4/competitions/WC/matches" \
  | jq '[.matches[] | select(.stage|test("LAST_|QUARTER|SEMI|THIRD|FINAL"))
         | {id, stage, utcDate, status, home:.homeTeam.name, away:.awayTeam.name}]'
```
(Alternatively the user pastes that JSON into chat — then no new session needed.)

## Implementation plan once the sample is in hand
1. Decide id-order vs explicit-map from the sample.
2. Fix the binding in `prisma/seed.ts` (KO loop) — bind fdMatchId+kickoff by uid/
   official order.
3. In `sync-matches.ts`: refresh `kickoff` for scheduled KO matches too (bind via
   fdMatchId), so already-seeded prod rows self-heal.
4. Unit-test the binding logic with mocked API fixtures (out-of-order dates,
   in-order ids → assert correct slot mapping). This IS testable offline.
5. Consider a one-off repair/migration for already-seeded prod rows (re-bind
   fdMatchId+kickoff by official order).
6. Verify: `npm test`, and if possible an e2e run.

## Env setup notes for a fresh session (sandbox specifics)
Prisma client + better-sqlite3 must be built before tests/app run:
- `npx prisma generate` fails on its own downloader (TLS reset); workaround:
  `curl` the `schema-engine.gz` from `binaries.prisma.sh/all_commits/<commit>/
  debian-openssl-3.0.x/schema-engine.gz`, gunzip, place at
  `node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x`, chmod +x,
  then `npx prisma generate` works.
- `npm rebuild better-sqlite3` (build tools present).
- e2e DB: `DATABASE_URL=file:./e2e.db npx prisma migrate deploy` then
  `DATABASE_URL=file:./e2e.db E2E_TEST=true npx tsx prisma/seed.ts`.
- Playwright browser mismatch: pinned 1223 vs installed 1194 at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Use a local-only config
  (gitignored `playwright.local.config.ts`) setting `launchOptions.executablePath`
  to that, run with `--config=playwright.local.config.ts`.
- Always export `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
