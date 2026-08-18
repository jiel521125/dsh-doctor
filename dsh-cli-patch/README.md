# Path B — Native `dsh doctor` subcommand

Integrates the diagnostician as a **first-class `dsh` CLI subcommand**, so
`dsh doctor --profile web --fix` sits alongside `dsh web` and `dsh plugin` in
`dsh -h`, owns its own `--help`, and shares the commander-based parser used by
the launcher.

Use this path when you are building a DSH release **from source** and want
`dsh doctor` printed in the launcher's own help + usage examples.

## Files in this folder

```
dsh-cli-patch/
├── README.md                 ← you are here
├── apply-patch.cmd           ← one-step: copy files into staging & build instructions (Windows)
├── apply-patch.sh            ← same, bash (macOS / Linux)
├── patches/
│   ├── args.ts.patch         ← human-readable patch: adds DoctorInvocation + the subcommand
│   └── bin.ts.patch          ← human-readable patch: adds a case 'doctor' branch
├── reference/
│   ├── args.ts               ← FULLY-PATCHED args.ts (fast path: overwrite directly)
│   └── bin.ts                ← FULLY-PATCHED bin.ts
└── src/
    ├── doctor.ts             ← thin TS wrapper (→ spawnSync doctor-engine.js)
    └── doctor-engine.js      ← the 24-check engine (also in repo root)
```

## Three ways to apply, pick one

### Option 1 — Run the helper script (easiest)

```bat
REM Windows
cd dsh-doctor\dsh-cli-patch
apply-patch.cmd  D:\repos\DeepSeek\staging
```

```bash
# macOS / Linux
cd dsh-doctor/dsh-cli-patch
chmod +x apply-patch.sh
./apply-patch.sh  ~/repos/DeepSeek/staging
```

This copies `src/{doctor.ts,doctor-engine.js}` into `apps/cli/src/`, backs up
the original `args.ts` / `bin.ts` as `.bak`, and overwrites them with the
fully-patched `reference/` copies.

### Option 2 — Overwrite by hand

```bash
# from your DSH source tree root (apps/cli/src/ lives here under staging/)
cp dsh-doctor/dsh-cli-patch/src/doctor.ts         apps/cli/src/doctor.ts
cp dsh-doctor/dsh-cli-patch/src/doctor-engine.js   apps/cli/src/doctor-engine.js
cp dsh-doctor/dsh-cli-patch/reference/args.ts      apps/cli/src/args.ts
cp dsh-doctor/dsh-cli-patch/reference/bin.ts       apps/cli/src/bin.ts
```

Compare against the backups afterwards with:
```bash
git diff --no-index apps/cli/src/args.ts.bak apps/cli/src/args.ts
```

### Option 3 — Apply patches to your own modified args/bin (advanced)

If your DSH fork has *local changes* to `args.ts` / `bin.ts`, overwriting them
with the `reference/` copies would lose your changes. In that case apply the
chunked patches from `patches/args.ts.patch` and `patches/bin.ts.patch` by
hand, or use a 3-way merge:

```bash
diff3 -m apps/cli/src/args.ts \
        apps/cli/src/args.ts.bak \
        dsh-doctor/dsh-cli-patch/reference/args.ts
```

## Build (mandatory after any of the three options)

Run your normal DSH build from the repo root (not from `staging/` — check your
own project's `package.json` for the correct script name; typical for DSH is
`pnpm build`):

```bash
pnpm install   # if needed
pnpm build
```

Afterwards `apps/cli/lib/` contains:
```
apps/cli/lib/
├── bin.js              ← DSH launcher entry, now with the doctor dispatch arm
├── doctor.js           ← compiled TS wrapper (spawnSync into doctor-engine.js)
├── doctor-engine.js    ← engine (copy through src/ alongside bin.ts — if your
│                          tsc does not copy JS, add a build step to cp it)
├── dump-config.js
├── plugin.js
└── profile-boot.js
```

If TypeScript does **not** copy `doctor-engine.js` from `src/` into `lib/`
because `allowJs: false`, add a single line to the `apps/cli` build script,
e.g. in `package.json` scripts:

```json
"build": "tsc -p tsconfig.json && cp src/doctor-engine.js lib/doctor-engine.js"
```

## Deploy the built artifacts

Copy everything in `apps/cli/lib/` into the released installer at
`DeepSeekHarness/app/lib/`. Optionally also ship the
[`standalone/DeepSeekHarness/dsh-doctor.cmd`](../standalone/DeepSeekHarness/dsh-doctor.cmd)
beside the launcher so users have both entry points.

Resulting user command:

```bash
dsh doctor --profile web           # coloured terminal report
dsh doctor --profile web --json    # JSON → CI / dashboard
dsh doctor --profile web --fix     # diagnose + auto-repair
```

Exit codes match the engine's own contract (0 pass / 1 fail / 2 warn / 97–99
internal error), so shell pipelines treat `dsh doctor` identically to invoking
`doctor-engine.js` directly.
