// ============================================================================
// apps/cli/src/doctor.ts
// ----------------------------------------------------------------------------
// Thin TypeScript wrapper around `doctor-engine.js` for the native
// `dsh doctor …` subcommand. It spawns the engine as a child process (same
// Node interpreter, inherited stdio, inherited env) so that:
//
//   • The engine stays a pure portable JS file and can be upgraded in a
//     shipped installer without a full TS rebuild.
//   • The engine's own exit-code semantics (0 pass / 1 fail / 2 warn) become
//     the wrapper's process exit code verbatim, so shell scripts calling
//     `dsh doctor` get the same contract as calling doctor-engine.js.
//   • No tsconfig gymnastics for mixing TS + JS: the two files resolve as
//     siblings under app/lib/ after build.
// ============================================================================

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RunDoctorOptions {
  /** Profile under $DSH_HOME/profiles to inspect. */
  readonly profile: string
  /** Extra patch overlays for the profile-tree smoke probe. */
  readonly patches: readonly string[]
  /** Emit JSON (engine's --json flag) instead of coloured terminal output. */
  readonly json: boolean
  /** Attempt automatic repairs (engine's --fix flag) then re-scan. */
  readonly fix: boolean
}

/**
 * Execute the diagnostician synchronously and return its exit status.
 *
 * Uses the current process's own Node binary (`process.execPath`) so a DSH
 * installation that boots through its bundled Node picks that same Node for
 * the doctor run — guaranteeing the Node-version check (R1) sees the exact
 * runtime DSH itself uses.
 */
export function runDoctor(opts: RunDoctorOptions): number {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname  = dirname(__filename)

  // After TS build → app/lib/doctor.js   app/lib/doctor-engine.js
  // In source tree   → apps/cli/src/*.ts → we rely on the source copy
  //  living beside doctor.ts and being carried forward by the same build
  //  step that produces the lib/ directory (tsc with `allowJs`, or a manual
  //  copy in the build pipeline — the apply-patch helper does the latter).
  let engine: string | undefined
  const candidates = [
    resolve(__dirname, 'doctor-engine.js'),
    // Fallback — in case the TS output lands in a different folder and the
    // caller still has the engine accessible via Node module resolution from
    // the launcher's own entry (e.g. bin.js resolves relative to itself).
    resolve(dirname(process.argv[1] ?? __filename), 'doctor-engine.js'),
  ]
  const fs = require('node:fs') as typeof import('node:fs')
  for (const p of candidates) if (fs.existsSync(p)) { engine = p; break }
  if (!engine) {
    process.stderr.write(
      '[dsh doctor] FATAL: doctor-engine.js not found in app/lib/.\n' +
      '  Expected candidates (sibling of doctor.js after build):\n' +
      candidates.map(c => '    - ' + c).join('\n') + '\n' +
      '  Re-apply dsh-cli-patch from dsh-doctor (see dsh-doctor/dsh-cli-patch/README.md).\n',
    )
    return 97
  }

  const argv: string[] = ['--profile', opts.profile]
  for (const patch of opts.patches) argv.push('--patch', patch)
  if (opts.json) argv.push('--json')
  if (opts.fix)  argv.push('--fix')

  const r = spawnSync(process.execPath, [engine, ...argv], {
    stdio: 'inherit',
    env: process.env,
  })
  if (r.error) {
    process.stderr.write(`[dsh doctor] FATAL: failed to spawn ${engine}: ${r.error.message}\n`)
    return 99
  }
  return r.status ?? 99
}
