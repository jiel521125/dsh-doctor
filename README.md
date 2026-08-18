# dsh-doctor — DeepSeek Harness Environment Diagnostician

A **zero-external-dependency** diagnostic for DeepSeek Harness (DSH) installations,
profiles, and runtimes. Ships as a single portable `doctor-engine.js` that runs
with the Node already bundled in the DSH portable installer — no `pnpm install`,
no TS build, no git required to *run* the check itself.

```
  24 checks  ·  6 categories  ·  --json output  ·  --fix auto-repair
```

- GitHub-ready: **everything lives under this folder**, no absolute paths, no
  references to machines outside the repo.
- Zero hardcoded paths: the engine resolves the installer root, `DSH_HOME`, and
  the profile via heuristics + env vars only.

---

## Quick start (run without installing anything into DSH)

All you need is any Node.js 22.19+ on your PATH. From this repo:

```bash
node doctor-engine.js --profile web                  # terminal report
node doctor-engine.js --profile web --fix            # + auto-repair common issues
node doctor-engine.js --profile headless --json      # machine-readable JSON
node doctor-engine.js --help                         # full usage
```

On Windows, double-click / run `run-doctor.cmd`:

```bat
run-doctor.cmd web --fix
```

No DSH source checkout, no build, no TS compiler needed.

---

## Two ways to integrate with `dsh`

Pick one. If you don't want to rebuild DSH pick **Path A**; if you want
`dsh doctor` to appear as a native subcommand in `dsh -h` pick **Path B**.

### Path A — Standalone deployment (zero build, recommended)

Copy the pre-made file tree from [`standalone/DeepSeekHarness/`](standalone/DeepSeekHarness)
into your released DSH portable installer:

```
DeepSeekHarness/                    ← your installer folder
├── dsh-doctor.cmd                  ← new (double-click or cli: dsh-doctor web --fix)
├── app/lib/
│   ├── bin.js                      ← existing (dsh CLI entry, unchanged)
│   └── doctor-engine.js            ← new (this is the engine)
├── node/node.exe                   ← existing bundled Node
└── electron/ shell/ ...
```

See [`standalone/DEPLOY.md`](standalone/DEPLOY.md) for the 3-line deployment
procedure and a **bonus 10-line dispatcher** you can paste in front of `bin.js`
so `dsh doctor ...` works as an *alias inside the existing entry* without
recompiling DSH.

### Path B — Native `dsh doctor` subcommand (requires one DSH rebuild)

Patch your DSH source tree once so `dsh -h` lists `doctor` beside `web` and
`plugin`. Everything you need is in [`dsh-cli-patch/`](dsh-cli-patch):

```
dsh doctor --profile web            # exactly the same flags as doctor-engine.js
dsh doctor --profile web --json
dsh doctor --profile web --fix
```

Steps:

1. Copy the four files from [`dsh-cli-patch/src/`](dsh-cli-patch/src) into your
   DSH source tree at `apps/cli/src/`.
2. Apply [`dsh-cli-patch/patches/args.ts.patch`](dsh-cli-patch/patches/args.ts.patch)
   and [`bin.ts.patch`](dsh-cli-patch/patches/bin.ts.patch) to
   `apps/cli/src/{args,bin}.ts`, or overwrite them with the ready-made
   reference copies at [`dsh-cli-patch/reference/`](dsh-cli-patch/reference).
3. Run the normal DSH build (`pnpm build` or use the included
   `apply-patch.cmd` helper).

See [`dsh-cli-patch/README.md`](dsh-cli-patch/README.md) for full details.

---

## What it checks (24 checks, 6 families)

| Code  | Family      | Title |
|-------|-------------|-------|
| R1–R5 | Runtime     | Node version, pnpm/corepack, git, `DSH_HOME` writable, `TMP` writable |
| I1–I4 | Installer   | Bundled node binary, `lib/bin.js`, Electron shell, launcher `.exe` |
| P1–P6 | Profile     | Dir exists, `cordis.yml` YAML parse, `package.json` + bundles, bundle resolution, patch YAML parse, profile `node_modules/` present |
| D1–D3 | Dependencies| Duplicate bundles, `tool-prepare` plugin conflict, `pnpm-workspace.yaml` `allowBuilds` |
| S1–S2 | Storage     | `storages/` dir + writable, session-log seq counters no overlap/regression |
| M1–M4 | Smoke probes| Patch stack composes into a row tree, sandbox backend (bwrap/WSL/write-restricted-token), web port 3080 free, `DEEPSEEK_API_KEY` set |

## Exit codes

| Exit | Meaning |
|------|---------|
| 0    | All 24 checks passed |
| 1    | ≥ 1 FAIL — hard errors that prevent DSH from booting |
| 2    | Only WARNINGs — DSH may boot but has issues |
| 97   | runner error (`doctor-engine.js` missing) |
| 98   | runner error (no Node interpreter found) |
| 99   | unhandled exception inside the engine |

## Files in this repo

```
dsh-doctor/
├── README.md                   ← you are here
├── doctor-engine.js            ← the full diagnostician (portable, run anywhere)
├── run-doctor.cmd              ← Windows one-click runner (auto finds Node, installer, DSH_HOME)
├── integration.md              ← extended notes (cordis plugin variant, CLI wiring details)
├── standalone/
│   ├── DEPLOY.md               ← deployment steps for Path A
│   └── DeepSeekHarness/        ← drop this tree on top of your released installer
│       ├── dsh-doctor.cmd
│       └── app/lib/doctor-engine.js
└── dsh-cli-patch/              ← everything for Path B (native subcommand)
    ├── README.md
    ├── apply-patch.cmd         ← one-shot: copy files + build for Windows
    ├── apply-patch.sh          ← one-shot: copy files + build for macOS/Linux
    ├── patches/
    │   ├── args.ts.patch       ← unified diff: adds DoctorInvocation + doctor subcommand
    │   └── bin.ts.patch        ← unified diff: adds doctor switch branch
    ├── reference/
    │   ├── args.ts             ← fully-patched args.ts (option: just overwrite!)
    │   └── bin.ts              ← fully-patched bin.ts
    └── src/
        ├── doctor.ts           ← thin TS wrapper: spawnSync(…) into doctor-engine.js
        └── doctor-engine.js    ← engine copy (goes beside bin.ts after build at app/lib/)
```

## Author

- **作者**：周龙（天枢智能）
- **微信**：longling1031
- **邮箱**：1033085514@qq.com
- **地址**：中国-浙江-嘉兴-平湖

## License / provenance

Bundled alongside DeepSeek Harness; written to be a drop-in companion. The
engine uses only Node builtins (`node:fs`, `node:path`, `node:os`,
`node:child_process`, `node:crypto`, `node:module`) — no third-party packages,
so it is safe to ship inside the installer without bloating the bundle.

## Copyright

Copyright © 2026 周龙（天枢智能）, 中国-浙江-嘉兴-平湖. All rights reserved.

Permission is hereby granted to use, copy, modify, and distribute this software
in source and binary forms, with or without modification, provided that the
above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
