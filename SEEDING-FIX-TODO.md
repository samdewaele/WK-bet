# KO bracket correctness — progress + remaining

> Branch: `claude/betting-webapp-friends-fD4yG`. Delete when the last item lands.

## Root causes (all verified against the official 2026 bracket + a real
## football-data.org response)
1. **Wrong dates** — the seed bound football-data fixtures to bracket slots by
   date order. football-data's KO ids are scrambled vs the bracket and later-
   round teams are null, so dates landed on the wrong slots.
2. **Wrong feeder tree** — `BRACKET_PATH` used a naive "73+74, 75+76…" pairing.
   The official R16 interleaves: M89=W74/W77, M90=W73/W75, etc.
3. **Wrong R32 third-place teams** — the app guesses which 3rd-place team fills
   each eligible slot via an MRV heuristic (`assignThirdPlaceTeams`); FIFA's
   actual draw differs (e.g. app put Bosnia in slot 74; reality = Paraguay).

## DONE (commit a855c0f)
- Added `src/lib/ko-schedule.ts` — static `KO_SCHEDULE` (match# -> official UTC
  kickoff), the team-independent source of truth, cross-checked to the minute
  against football-data. No stadiums (per request).
- Corrected `BRACKET_PATH` to the official tree; derived `NEXT_ROUND_SLOT` and
  `BRACKET_POSITIONS` from it (single source of truth, layout correct by
  construction). ko-seeding imports NEXT_ROUND_SLOT.
- Bracket + list read dates from KO_SCHEDULE; seed sets KO kickoffs from it and
  no longer date-binds fdMatchId (left null).
- Tests: official feeders, NEXT_ROUND_SLOT-inverse, layout, KO_SCHEDULE; scoring
  R16 cases updated. 558 unit + 3 e2e bracket tests pass; verified visually.

## DONE (commit 34ffa7b)
### A. R32 third-place real teams — FIXED
- `src/lib/ko-r32-binding.ts` pure resolver (anchor on group winner) reads the
  real third-place team per slot from LAST_32 fixtures. Unit-tested against the
  real response (74→Paraguay, 77→Sweden, 79→Ecuador, 80→Congo DR, 81→Bosnia,
  82→Senegal, 85→Algeria, 87→Ghana).
- `resolveR32Bracket` takes a third-place override; `populateR32FromApi` builds
  it from football-data and also binds each slot's fdMatchId. Idempotent +
  self-healing (only rewrites unplayed slots that differ) so it corrects R32
  rows already seeded with the wrong heuristic teams in prod. Sync runs it
  whenever LAST_32 carries real teams; heuristic kept as fallback / for sim.
- Needs prod live-verify (sandbox has no football-data egress).

## REMAINING
### B. fdMatchId rebind for R16+ (lower priority)
- R16+ slots get teams via populateNextRoundSlot as rounds resolve; sync pass-2
  team-matches null-fdMatchId rows for scoring. Optionally bind fdMatchId for
  R16+ the same way populateR32FromApi does, once those slots' teams are known,
  so pass-1 fdMatchId matching is used. Dates already correct via KO_SCHEDULE.

## Reference data
Real football-data KO response saved at (scratchpad, not committed):
`wc-ko.json`. Authoritative slot->fixture map and third-place truth were
derived in `verify3.mjs`.

## Sandbox env setup (fresh session)
- `npx prisma generate` downloader fails on TLS; curl the schema-engine.gz from
  binaries.prisma.sh, gunzip into node_modules/@prisma/engines, chmod +x.
- `npm rebuild better-sqlite3`.
- e2e db: `DATABASE_URL=file:./e2e.db npx prisma migrate deploy` then
  `... E2E_TEST=true npx tsx prisma/seed.ts`.
- Playwright: pinned 1223 vs installed 1194; gitignored `playwright.local.config.ts`
  sets launchOptions.executablePath to /opt/pw-browsers/chromium-1194/...
- Always `export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
- football-data egress is blocked in default network policy; only WebSearch works.
