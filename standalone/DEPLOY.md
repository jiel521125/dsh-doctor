# Path A — Standalone deployment (zero build)

This is the **recommended deployment path** when shipping a DSH portable
installer. No TypeScript, no `pnpm build`, no touching the DSH source tree.

## Tools in this folder

| File | What it does |
|---|---|
| [deploy.cmd](deploy.cmd) | **One-shot deployment** for Windows: validates target → copies files → patches bin.js → verifies |
| [deploy.sh](deploy.sh) | Same for macOS / Linux |
| [patch-bin-dispatcher.cmd](patch-bin-dispatcher.cmd) | **Standalone bin.js patcher**: inserts the 10-line `dsh doctor` dispatcher at the top of the existing bin.js (auto-backup, idempotent) |
| [verify.cmd](verify.cmd) | **Post-deploy check**: runs `doctor-engine.js --profile web` with the installer's bundled Node to confirm the deployment works |
| [DeepSeekHarness/](DeepSeekHarness) | The source file tree that gets copied into your installer |
| [TUTORIAL.md](TUTORIAL.md) | **Full step-by-step tutorial** (Chinese) with screenshots, FAQ, rollback procedure |

## Quick deploy (one command)

### Windows
```bat
cd dsh-doctor\standalone
deploy.cmd  C:\path\to\DeepSeekHarness
```

### macOS / Linux
```bash
cd dsh-doctor/standalone
chmod +x deploy.sh
./deploy.sh  /path/to/DeepSeekHarness
```

That's it. `deploy.cmd` does all 5 steps for you:

```
[1/5] Validate target installer (node\node.exe + app\lib\bin.js)
[2/5] Copy doctor-engine.js → app\lib\
[3/5] Copy dsh-doctor.cmd → installer root
[4/5] Patch bin.js with 10-line dispatcher (auto-backup → bin.js.bak)
[5/5] Run verify to confirm it works
```

## Manual deploy (if you prefer)

### 1. Copy files

```bat
xcopy /E /I /Y  dsh-doctor\standalone\DeepSeekHarness  D:\path\to\DeepSeekHarness
```

This puts `doctor-engine.js` into `app\lib\` and `dsh-doctor.cmd` into the
installer root.

### 2. (Optional) Patch bin.js for `dsh doctor …` native syntax

```bat
patch-bin-dispatcher.cmd  D:\path\to\DeepSeekHarness
```

This inserts a 10-line dispatcher at the top of `app\lib\bin.js` (backed up
to `bin.js.bak`) that forwards `dsh doctor …` to the engine. After this:

```bat
node app\lib\bin.js doctor web --fix      REM works exactly like dsh web
```

### 3. Verify

```bat
verify.cmd  D:\path\to\DeepSeekHarness
```

## Post-deploy layout

```
DeepSeekHarness/
├── dsh-doctor.cmd              ← NEW: user entry point
├── app/
│   └── lib/
│       ├── bin.js              ← EXISTING + 10-line dispatcher at top
│       ├── bin.js.bak          ← NEW: original bin.js backup
│       ├── doctor-engine.js    ← NEW: 24-check engine (42 KB, zero deps)
│       └── ...
├── node/node.exe               ← EXISTING bundled Node
├── shell/  electron/ …         ← EXISTING
```

## Usage after deploy

```bat
REM Via standalone entry
dsh-doctor.cmd web
dsh-doctor.cmd web --fix
dsh-doctor.cmd web --json > report.json

REM Via bin.js dispatcher (after patch-bin-dispatcher.cmd)
node app\lib\bin.js doctor web
node app\lib\bin.js doctor web --fix
node app\lib\bin.js doctor web --json
```

## Full tutorial

See [TUTORIAL.md](TUTORIAL.md) for:
- Step-by-step walkthrough with expected output
- FAQ (common errors, rollback, idempotency)
- CI integration examples (GitHub Actions, .bat)
- Comparison with Path B (native subcommand)
