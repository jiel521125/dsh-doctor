# dsh-doctor Integration Guide

Three ways to ship `dsh doctor` with the DeepSeek Harness portable installer.

## A. Standalone script (already done)

Use `doctor.js` as a standalone file. Drop it into the installer at:

```
DeepSeekHarness/
  node/node.exe        ← bundled Node 22.19+
  app/
    lib/
      bin.js           ← existing dsh CLI entry
      doctor.js        ← this file  🆕
```

Run with:

```bat
REM Windows (installer root = current dir)
node\node.exe app\lib\doctor.js --profile web
node\node.exe app\lib\doctor.js --profile web --fix
node\node.exe app\lib\doctor.js --profile web --json > report.json
```

The `run-doctor.cmd` wrapper does the equivalent for you without having to
remember the paths.

---

## B. Wire `dsh doctor` as a real `dsh` CLI subcommand

This makes `dsh doctor --profile web` behave identically to `dsh web` /
`dsh plugin` — first-class support in `args.ts` and `bin.ts`.

### 1. `apps/cli/src/args.ts`

Add a new invocation type and a new `doctor` subcommand beside `web` and `plugin`:

```diff
 /** Boot a named profile … */
 interface ProfileInvocation { mode: 'profile'; … }
 interface DumpConfigInvocation { mode: 'dump-config'; … }
 interface PluginInvocation     { mode: 'plugin'; … }
+/** Run the environment diagnostician and exit by status. */
+interface DoctorInvocation {
+  mode: 'doctor'
+  profile: string
+  patches: string[]
+  json: boolean
+  fix: boolean
+}
-export type DshInvocation = ProfileInvocation | DumpConfigInvocation | PluginInvocation
+export type DshInvocation = ProfileInvocation | DumpConfigInvocation | PluginInvocation | DoctorInvocation
```

In `parseDshArgs()` add this subcommand (same pattern as `plugin`):

```ts
const doctor = program.command('doctor')
  .description('run the environment diagnostician (node/pnpm/git/profile/sandbox/session) and print a report')
doctor
  .requiredOption('--profile <name>', 'the profile to inspect (e.g. web, headless, tui)')
  .option('--patch <path>', 'extra patch overlay for config composition (repeatable)', collect)
  .option('--json', 'emit JSON instead of colored terminal output')
  .option('--fix', 'attempt automatic repairs for simple issues then re-scan')
  .action((_args, options) => {
    rejectParentOptions('doctor')
    if (options.profile === '') program.error(`error: --profile needs a name`)
    resolved = {
      mode: 'doctor',
      profile: options.profile,
      patches: options.patch ?? [],
      json: !!options.json,
      fix:  !!options.fix,
    }
  })
```

### 2. `apps/cli/src/bin.ts`

Add a new switch arm:

```diff
 switch (invocation.mode) {
   case 'profile':  { … await runProfile(…); break }
   case 'plugin':   { process.exit(runPlugin(invocation.profile, invocation.args)); break }
   case 'dump-config': { runDumpConfig(…); break }
+  case 'doctor': {
+    const { runDoctor } = await import('./doctor.ts')
+    process.exit(runDoctor({
+      profile: invocation.profile,
+      patches: invocation.patches,
+      json: invocation.json,
+      fix:  invocation.fix,
+    }))
+    break
+  }
   default: invocation satisfies never
 }
```

### 3. `apps/cli/src/doctor.ts` (new file)

This thin wrapper re-exports the standalone `doctor.js` logic but with one
important adaptation: `runDoctor()` resolves `DSH_HOME` through the same
`resolveDshHome()` the launcher uses (`@deepseek-ai/dsh-home-paths`), so the
doctor and a real `dsh web` boot inspect the same directories. The
standalone `doctor.js` has a fallback resolver in case the package isn't
importable.

```ts
// apps/cli/src/doctor.ts
export interface RunDoctorOptions { profile: string; patches: readonly string[]; json: boolean; fix: boolean }

export function runDoctor(opts: RunDoctorOptions): number {
  // Drive the same engine as doctor.js.  Three options — pick one:
  //
  // (a) Import the standalone doctor entry as a sibling module and invoke its
  //     main() with process.argv overridden.  Smallest code footprint, but you
  //     lose direct control over exit behaviour via spawnSync.
  //
  // (b) Move the engine itself into a shared module
  //     (packages/util/src/dsh-doctor.ts) and have both the CLI wrapper and
  //     the standalone entry import from it.  Cleanest long-term layout.
  //
  // (c) Simply spawn node.exe running the standalone script, passing the
  //     resolved values via env vars.  Decouples CLI versioning from the
  //     doctor logic, which makes it safe to hot-patch doctor.js in a
  //     released installer:
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
  const args = [
    require.resolve('./doctor.js'),
    '--profile', opts.profile,
    ...opts.patches.flatMap(p => ['--patch', p]),
    ...(opts.json ? ['--json'] : []),
    ...(opts.fix  ? ['--fix']  : []),
  ]
  const r = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: { ...process.env },
  })
  return r.status ?? 99
}
```

### 4. Print the launcher own help

The launcher `dsh -h` (no profile) will now list `doctor` as a subcommand.
Because `doctor` owns its own flags through commander, `dsh doctor --help`
prints the doctor-specific flag help automatically — same pattern `web` uses
to hand `-h` off to the app.

---

## C. Cordis plugin (optional)

If you want the doctor to be **callable from inside a running Harness**
(e.g. the agent can self-diagnose when a tool call reports `SANDBOX_UNAVAILABLE`),
ship it as a bundle plugin instead of a CLI subcommand.

`cordis.patch.yml` row:

```yaml
- id: dsh-doctor-service
  name: dsh-doctor-service
  config:
    # Registers ctx.doctor.run(opts) returning a serializable report +
    # registers a `doctor_run_diagnosis` tool the agent can invoke.
```

The plugin's `apply(ctx)`:

```ts
import { defineTool, type Context } from '@deepseek-ai/cordis'
import { runAll, Ctx, formatJson } from './doctor-engine.js'   // shared engine

export const name = 'dsh-doctor-service'

export function apply(ctx: Context) {
  ctx.provide('doctor', {
    async run(opts) {
      const c = new Ctx({ profile: opts?.profile ?? 'web', patches: [], json: true, fix: false, help: false })
      const results = await runAll(c)
      return JSON.parse(formatJson(c, results).trim())
    },
  })
  ctx.tools.register(defineTool({
    name: 'doctor_run_diagnosis',
    description: 'Run the DSH environment diagnostician. Call this tool when tool calls report sandbox issues, bundle resolution errors, or the user asks "is my setup broken". Returns a PASS/WARN/FAIL report per check plus fix suggestions.',
    parameters: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: 'Profile name to inspect. Defaults to the booted profile.' },
        include_fixes: { type: 'boolean', description: 'If true, also attempt automatic repairs.' },
      },
    },
    async execute(args) {
      const c = new Ctx({ profile: args.profile ?? 'web', patches: [], json: true, fix: !!args.include_fixes, help: false })
      let results = await runAll(c)
      if (args.include_fixes) { /* … apply autoFixes, rerun … */ }
      return JSON.parse(formatJson(c, results).trim())
    },
  }))
}
```

---

## Exit codes (all three forms)

| Exit | Meaning |
|------|---------|
| 0    | All 24 checks passed |
| 1    | ≥ 1 FAIL — hard errors that prevent DSH from booting |
| 2    | Only WARNINGs — DSH may boot but has issues (e.g. no API key, port occupied, no bwrap) |
| 97–99| Fatal runner errors (missing script, missing node, unhandled exception) |
