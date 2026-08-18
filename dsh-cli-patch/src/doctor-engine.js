#!/usr/bin/env node
/**
 * dsh-doctor — DeepSeek Harness environment & configuration diagnostician.
 *
 * Usage (portable installer):
 *   .\node\node.exe .\app\lib\doctor.js --profile web
 *   .\node\node.exe .\app\lib\doctor.js --profile web --json
 *   .\node\node.exe .\app\lib\doctor.js --profile web --fix
 *
 * Usage (this repo, with installer at /path/to/DeepSeekHarness):
 *   node doctor.js --profile web
 *   set DSH_HOME=/path/to/dsh-home && node doctor-engine.js --profile web
 *
 * Zero external dependencies. Works with DSH's bundled Node.js (22.19+).
 * Pure ESM — uses only Node builtins and an in-file minimal YAML parser.
 *
 * Diagnostic categories:
 *   R. Runtime environment     (node/pnpm/git/DSH_HOME/tmp)
 *   I. Installer integrity     (bundled node/cli/electron/exe)
 *   P. Profile completeness    (profile dir/cordis.yml/package.json/bundles)
 *   D. Dependency & plugin health (bundle resolves, known conflicts)
 *   S. Storage & session log   (storages/, seq overlap in session logs)
 *   M. Smoke probes            (port, sandbox, API key)
 *
 * @module dsh-doctor
 */

import {
  accessSync, constants as fsConstants, existsSync, readFileSync, readdirSync,
  statSync, writeFileSync, mkdirSync, unlinkSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  basename, dirname, isAbsolute, join, resolve,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import os from 'node:os'
import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// §0  Anchors — resolve installer & DSH app roots.
//
// Heuristic: if a sibling/parent DeepSeekHarness directory exists with an
// app/package.json inside, use that. Otherwise walk up from CWD. The env var
// DSH_INSTALLER_ROOT overrides everything.
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function findInstallerRoot() {
  // 1. Environment override wins — user explicitly pins it.
  if (process.env.DSH_INSTALLER_ROOT) {
    const r = resolve(process.env.DSH_INSTALLER_ROOT)
    return existsSync(join(r, 'app', 'package.json')) ? r : null
  }
  // 2. Self-location heuristic: doctor.js is shipped INSIDE the installer at
  //    DeepSeekHarness/app/lib/doctor.js  →  ../.. = DeepSeekHarness/
  {
    const r = resolve(__dirname, '..', '..')
    if (existsSync(join(r, 'app', 'package.json'))) return r
  }
  // 3. Walk up from CWD looking for a DeepSeekHarness/app/package.json or a
  //    folder whose name ends in DeepSeekHarness containing app/package.json.
  let cur = process.cwd()
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(cur, 'app', 'package.json'))) {
      const leaf = basename(cur).toLowerCase()
      if (leaf === 'deepseekharness' || existsSync(join(cur, 'node', 'node.exe')) || existsSync(join(cur, 'shell', 'main.js'))) {
        return cur
      }
    }
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  // 4. CWD sibling dsh-home/ might sit beside a DeepSeekHarness dir.
  {
    const r = resolve(process.cwd(), '..', 'DeepSeekHarness')
    if (existsSync(join(r, 'app', 'package.json'))) return r
  }
  // Nothing found — gracefully degrade. Installer checks are skipped with a
  // clear warning, and everything else (runtime / profile / storage / smoke)
  // still runs based on DSH_HOME.
  return null
}

const INSTALLER_ROOT = findInstallerRoot()
const APP_ROOT = INSTALLER_ROOT ? resolve(INSTALLER_ROOT, 'app') : null
const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// §1  Minimal YAML parser — only the subset DSH config actually uses:
//     • flow sequences []
//     • block sequences with - items
//     • block mappings key: value
//     • plain scalars (strings, numbers, booleans, null)
//     • comments (# to EOL)
//     • quoted strings "..." / '...'
// Not a spec-compliant parser. Good enough for cordis.yml + cordis.patch.yml.
// ---------------------------------------------------------------------------
function yamlParse(src) {
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1)
  const lines = src.split(/\r?\n/)
  let idx = 0
  function consumed() { idx += 1 }

  function parseBlock(startIndent) {
    const buf = []
    while (idx < lines.length) {
      const raw = lines[idx]
      const noComment = raw.replace(/#.*$/, '')
      if (noComment.trim() === '') { consumed(); continue }
      const indent = raw.match(/^\s*/)[0].length
      if (indent < startIndent) break
      buf.push({ indent, text: noComment })
      consumed()
    }
    if (buf.length === 0) return undefined
    const firstDedent = buf[0].text.slice(buf[0].indent).trimStart()
    // Single-line flow form (flow [] / flow {} / quoted / plain scalar):
    // cordis.yml root is literally "[]" on its own line — not a block form at all.
    if (buf.length === 1) {
      // Only treat as block mapping if the line has the shape "key:" or "key: value".
      const isBlockMappingLine = /^[A-Za-z_][\w./-]*:(?:\s|$)/.test(firstDedent)
      const isBlockSequenceLine = firstDedent.startsWith('- ')
      if (!isBlockMappingLine && !isBlockSequenceLine) {
        return parseScalarOrInline(firstDedent)
      }
    }
    if (firstDedent.startsWith('- ')) {
      const out = []
      let i = 0
      while (i < buf.length) {
        const baseIndent = buf[i].indent
        const head = buf[i].text.slice(baseIndent + 2)
        let j = i + 1
        while (j < buf.length && buf[j].indent > baseIndent + 2) j += 1
        const keyMatch = /^([A-Za-z_][\w./-]+):\s*$/.exec(head)
        if (keyMatch && j < buf.length) {
          const keyName = keyMatch[1]
          const childBuf = []
          let k = j
          while (k < buf.length && buf[k].indent > baseIndent) {
            childBuf.push({ indent: buf[k].indent - baseIndent - 2, text: buf[k].text.slice(baseIndent + 2) })
            k += 1
          }
          const nestedSrc = childBuf.map(b => ' '.repeat(Math.max(0, b.indent)) + b.text).join('\n')
          out.push({ [keyName]: yamlParse(nestedSrc) })
          i = k
        } else {
          out.push(parseScalarOrInline(head))
          i = j
        }
      }
      return out
    }
    const obj = {}
    let i = 0
    while (i < buf.length) {
      const baseIndent = buf[i].indent
      const line = buf[i].text.slice(baseIndent)
      const m = /^([A-Za-z_][\w./-]*):(?:\s+(.*))?$/.exec(line)
      if (!m) break
      const key = m[1]
      const inline = m[2]
      if (inline !== undefined && inline !== '') {
        obj[key] = parseScalarOrInline(inline)
        i += 1
      } else {
        const childBuf = []
        let j = i + 1
        while (j < buf.length && buf[j].indent > baseIndent) {
          childBuf.push({ indent: buf[j].indent - baseIndent - 2, text: buf[j].text.slice(baseIndent + 2) })
          j += 1
        }
        if (childBuf.length === 0) { obj[key] = null; i = j; continue }
        const nestedSrc = childBuf.map(b => ' '.repeat(Math.max(0, b.indent)) + b.text).join('\n')
        obj[key] = yamlParse(nestedSrc)
        i = j
      }
    }
    return obj
  }

  function parseScalarOrInline(tok) {
    tok = tok.trim()
    if (tok === '') return ''
    if (tok.startsWith('[') && tok.endsWith(']')) {
      const inner = tok.slice(1, -1).trim()
      if (inner === '') return []
      return splitTopLevel(inner, ',').map(s => parseScalarOrInline(s))
    }
    if (tok.startsWith('{') && tok.endsWith('}')) {
      const inner = tok.slice(1, -1).trim()
      if (inner === '') return {}
      const obj = {}
      for (const part of splitTopLevel(inner, ',')) {
        const colon = part.indexOf(':')
        if (colon < 0) continue
        const k = parseScalarOrInline(part.slice(0, colon).trim())
        const v = parseScalarOrInline(part.slice(colon + 1).trim())
        obj[String(k)] = v
      }
      return obj
    }
    if (/^"(?:[^"\\]|\\.)*"$/.test(tok)) { try { return JSON.parse(tok) } catch { return tok } }
    if (/^'(?:[^']|'')*'$/.test(tok)) return tok.slice(1, -1).replace(/''/g, "'")
    if (tok === 'null' || tok === '~') return null
    if (tok === 'true') return true
    if (tok === 'false') return false
    if (/^-?\d+$/.test(tok)) return Number(tok)
    if (/^-?\d+\.\d+$/.test(tok)) return Number(tok)
    return tok
  }

  function splitTopLevel(str, sep) {
    const out = []
    let depth = 0; let inStr = null; let start = 0
    for (let i = 0; i < str.length; i++) {
      const ch = str[i]
      if (inStr) {
        if (ch === '\\') { i += 1; continue }
        if (ch === inStr) inStr = null
      } else {
        if (ch === '"' || ch === "'") inStr = ch
        else if (ch === '[' || ch === '{') depth += 1
        else if (ch === ']' || ch === '}') depth -= 1
        else if (ch === sep && depth === 0) { out.push(str.slice(start, i)); start = i + 1 }
      }
    }
    out.push(str.slice(start))
    return out
  }

  return parseBlock(0)
}

// ---------------------------------------------------------------------------
// §2  CLI args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    profile: process.env.DSH_PROFILE || 'web',
    json: false,
    fix: false,
    help: false,
    patches: [],
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--profile') opts.profile = argv[++i] || opts.profile
    else if (a.startsWith('--profile=')) opts.profile = a.slice('--profile='.length)
    else if (a === '--json' || a === '--json=true') opts.json = true
    else if (a === '--no-json' || a === '--json=false') opts.json = false
    else if (a === '--fix') opts.fix = true
    else if (a === '-h' || a === '--help') opts.help = true
    else if (a === '--patch') opts.patches.push(argv[++i])
    else if (a.startsWith('--patch=')) opts.patches.push(a.slice('--patch='.length))
    // Bare positional (not a flag) → treat as profile name, mirroring
    // `dsh web` = `dsh --profile web`. Only the first one wins.
    else if (!a.startsWith('-') && opts.profile === (process.env.DSH_PROFILE || 'web')) opts.profile = a
  }
  return opts
}

const HELP = `dsh-doctor — DeepSeek Harness environment diagnostician

Usage:
  dsh doctor --profile <name> [--patch <path>...] [--fix] [--json]
  node doctor.js --profile <name> [options]

Options:
  --profile <name>   Profile to inspect (default: web, env: DSH_PROFILE)
  --patch <path>     Extra patch overlay to include in config-composition check
  --fix              Attempt automatic repairs for simple issues
  --json             Emit JSON report instead of colored terminal output
  -h, --help         Show this help

Environment:
  DSH_HOME           Override home directory (profiles/ + storages/)
  DSH_INSTALLER_ROOT Override installer root (DeepSeekHarness/ dir)
  DSH_PROFILE        Default profile name

Exit codes:
  0   All checks passed
  1   One or more checks FAILED (hard errors)
  2   One or more checks WARNED, no failures
`

// ---------------------------------------------------------------------------
// §3  Check framework
// ---------------------------------------------------------------------------
const PASS = 'pass'
const WARN = 'warn'
const FAIL = 'fail'

const COLOR = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
}
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined
function c(str, color) { return useColor ? `${COLOR[color]}${str}${COLOR.reset}` : str }

function check(code, title, runner) { return { code, title, runner } }

// ---- Context passed to every check ---------------------------------------
class Ctx {
  constructor(opts) {
    this.opts = opts
    this.startTime = Date.now()
    this.host = {
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      totalMem: os.totalmem(),
      freemem: os.freemem(),
      cpuCores: os.cpus().length,
    }
    // Resolved paths; nullable — if installer root isn't located, any check
    // that depends on bundled binaries / the app tree simply warns instead
    // of crashing.
    this.installerRoot = INSTALLER_ROOT
    this.appRoot = APP_ROOT
    this.bundledNode = INSTALLER_ROOT
      ? join(INSTALLER_ROOT, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
      : null
    this.dshHome = this.resolveDshHome()
    this.profileName = opts.profile
    this.profileDir = this.resolveProfileDir(opts.profile)
    this._profilePkg = null
  }
  resolveDshHome() {
    if (process.env.DSH_HOME) return resolve(process.env.DSH_HOME)
    if (INSTALLER_ROOT) {
      const besideInstaller = resolve(INSTALLER_ROOT, '..', 'dsh-home')
      if (existsSync(besideInstaller)) return besideInstaller
    }
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir()
    return join(home, '.dsh')
  }
  resolveProfileDir(name) { return join(this.dshHome, 'profiles', name) }
  run(cmd, args = [], spawnOpts = {}) {
    const shell = process.platform === 'win32'
    try {
      const r = spawnSync(cmd, args, {
        encoding: 'utf8', shell, windowsHide: true, timeout: 10_000, ...spawnOpts,
      })
      return {
        ok: (r.status ?? 1) === 0,
        status: r.status ?? -1,
        stdout: (r.stdout ?? '').trim(),
        stderr: (r.stderr ?? '').trim(),
        error: r.error ? r.error.message : undefined,
      }
    } catch (e) {
      return { ok: false, status: -1, stdout: '', stderr: '', error: String(e) }
    }
  }
  readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
  profilePackage() {
    if (this._profilePkg) return this._profilePkg
    this._profilePkg = this.readJson(join(this.profileDir, 'package.json'))
    return this._profilePkg
  }
  // Helpers used by many checks — treat nullable installer/app roots safely.
  appResolvePaths(extra = []) {
    const paths = [this.profileDir, ...extra]
    if (this.appRoot) paths.push(this.appRoot)
    return paths
  }
  installerLocated() { return !!this.installerRoot }
}

// ---------------------------------------------------------------------------
// §4  Checks — grouped by category
// ---------------------------------------------------------------------------

// R. Runtime --------------------------------------------------------------
const R1_NODE = check('R1', 'Node.js version (>=22.19.0 or 24+)', () => {
  const raw = process.versions.node
  const [maj, min] = raw.split('.').map(Number)
  const ok = (maj === 22 && min >= 19) || maj >= 24
  if (!ok) return { status: FAIL, detail: `Found Node v${raw}. Required: v22.19+ or v24+.`, fix: 'Upgrade bundled Node.js to 22.19+ (download from nodejs.org and replace DeepSeekHarness/node/) or run with a system Node matching the floor.' }
  return { status: PASS, detail: `Node v${raw} (${process.platform} ${process.arch})` }
})

const R2_PNPM = check('R2', 'pnpm availability (corepack-enabled, ~11.7)', (ctx) => {
  const corepackBin = INSTALLER_ROOT
    ? (process.platform === 'win32'
      ? join(INSTALLER_ROOT, 'node', 'corepack.cmd')
      : join(INSTALLER_ROOT, 'node', 'corepack'))
    : null
  const candidates = []
  if (corepackBin) candidates.push([corepackBin, ['pnpm', '--version']])
  candidates.push(['corepack', ['pnpm', '--version']])
  candidates.push(['pnpm', ['--version']])
  let result = null
  for (const [cmd, args] of candidates) {
    if (typeof cmd !== 'string') continue
    const guardedByInstaller = INSTALLER_ROOT && cmd.startsWith(INSTALLER_ROOT)
    if (!guardedByInstaller || existsSync(cmd)) {
      const r = ctx.run(cmd, args)
      if (r.ok && /^\d+\.\d+\.\d+/.test(r.stdout)) { result = r.stdout; break }
    }
  }
  if (!result) {
    return {
      status: FAIL,
      detail: 'Neither `corepack pnpm --version` nor `pnpm --version` succeeded.',
      fix: 'Enable corepack: `corepack enable` (bundled at DeepSeekHarness/node/corepack.cmd on Windows). DSH pins pnpm@11.7.0.',
      autoFix: (c) => {
        const tries = []
        if (corepackBin) tries.push(corepackBin)
        tries.push('corepack')
        for (const cp of tries) {
          const guarded = INSTALLER_ROOT && cp.startsWith(INSTALLER_ROOT)
          if (!guarded || existsSync(cp)) {
            const r = c.run(cp, ['enable'])
            if (r.ok) return `Ran ${cp} enable`
          }
        }
        return undefined
      },
    }
  }
  const [maj, min] = result.split('.').map(Number)
  const status = (maj === 11 && min >= 5) ? PASS : WARN
  return { status, detail: `pnpm ${result}${status === WARN ? ' (recommended: 11.7.x)' : ''}` }
})

const R3_GIT = check('R3', 'Git version (>=2.26)', (ctx) => {
  const r = ctx.run('git', ['--version'])
  if (!r.ok) return { status: WARN, detail: 'git --version did not run (Git may be missing from PATH). Not fatal for runtime, but plugin management and hooks need it.', fix: 'Install Git (git-scm.com) and ensure `git` is on PATH.' }
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(r.stdout)
  if (!m) return { status: WARN, detail: `Unparseable git version: ${r.stdout}` }
  const [maj, min] = [+m[1], +m[2]]
  const ok = (maj > 2) || (maj === 2 && min >= 26)
  return { status: ok ? PASS : WARN, detail: `Git ${m[1]}.${m[2]}.${m[3]}${ok ? '' : ' (<2.26: git worktree hooks may misbehave)'}` }
})

const R4_HOME = check('R4', 'DSH_HOME resolvable & writable', (ctx) => {
  const p = ctx.dshHome
  if (!existsSync(p)) {
    return {
      status: FAIL,
      detail: `DSH_HOME does not exist: ${p}`,
      fix: `Create the directory tree, or set DSH_HOME env var. Expected layout: ${p}/profiles/<name>/{package.json,cordis.yml}.`,
      autoFix: (c) => {
        try {
          mkdirSync(join(c.dshHome, 'profiles', c.profileName), { recursive: true })
          mkdirSync(join(c.dshHome, 'storages'), { recursive: true })
          return `Created directory skeleton under ${c.dshHome}`
        } catch { return undefined }
      },
    }
  }
  try { accessSync(p, fsConstants.W_OK) }
  catch { return { status: FAIL, detail: `DSH_HOME exists but not writable: ${p}` } }
  return { status: PASS, detail: `DSH_HOME = ${p}` }
})

const R5_TMP = check('R5', 'TMP directory writable', (ctx) => {
  const tmp = os.tmpdir()
  const probe = join(tmp, `dsh-doctor-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`)
  try { writeFileSync(probe, 'ok', { flag: 'wx' }); unlinkSync(probe); return { status: PASS, detail: `TMP = ${tmp}` } }
  catch (e) { return { status: FAIL, detail: `Failed write to TMP (${tmp}): ${e.message}` } }
})

// I. Installer integrity ------------------------------------------------
const I1_NODE_BIN = check('I1', 'Bundled node binary present', (ctx) => {
  if (!ctx.installerLocated()) {
    return { status: WARN, detail: 'Installer root not located — set DSH_INSTALLER_ROOT env var (the folder containing node/, app/, shell/). Bundled-binary check skipped.', fix: 'Set DSH_INSTALLER_ROOT=/path/to/DeepSeekHarness or place doctor.js inside DeepSeekHarness/app/lib/.' }
  }
  const p = ctx.bundledNode
  return existsSync(p)
    ? { status: PASS, detail: `${p} (${statSync(p).size.toLocaleString()} bytes)` }
    : { status: FAIL, detail: `Missing bundled Node at ${p}`, fix: 'Download Node 22.19+ (x64) and extract it into DeepSeekHarness/node/, OR set DSH_INSTALLER_ROOT to a valid installer layout.' }
})

const I2_CLI_BIN = check('I2', 'DSH app CLI entry present (lib/bin.js)', (ctx) => {
  if (!ctx.installerLocated() || !ctx.appRoot) {
    return { status: WARN, detail: 'Installer root not located — DSH app CLI check skipped.', fix: 'Set DSH_INSTALLER_ROOT=/path/to/DeepSeekHarness.' }
  }
  const p = join(ctx.appRoot, 'lib', 'bin.js')
  return existsSync(p)
    ? { status: PASS, detail: p }
    : { status: FAIL, detail: `Missing ${p} — the app tree inside DeepSeekHarness/app/ is incomplete or corrupted.` }
})

const I3_ELECTRON = check('I3', 'Electron shell present (optional)', (ctx) => {
  if (!ctx.installerLocated()) {
    return { status: WARN, detail: 'Installer root not located — Electron shell check skipped.', fix: 'Set DSH_INSTALLER_ROOT=/path/to/DeepSeekHarness.' }
  }
  const shellMain = join(ctx.installerRoot, 'shell', 'main.js')
  const electron = join(ctx.installerRoot, 'electron')
  if (!existsSync(shellMain)) return { status: WARN, detail: 'Electron shell missing — only the CLI / web-surface via browser is available.' }
  const hasElectronDir = existsSync(electron)
  return { status: hasElectronDir ? PASS : WARN, detail: hasElectronDir ? `shell + electron runtime at ${electron}` : 'shell/main.js found but electron runtime directory is missing — use web surface via CLI + browser.' }
})

const I4_EXE = check('I4', 'Launcher executable present (optional)', (ctx) => {
  if (!ctx.installerLocated()) {
    return { status: WARN, detail: 'Installer root not located — launcher check skipped.', fix: 'Set DSH_INSTALLER_ROOT=/path/to/DeepSeekHarness.' }
  }
  const exe = join(ctx.installerRoot, process.platform === 'win32' ? 'DeepSeekHarness.exe' : 'DeepSeekHarness')
  return existsSync(exe)
    ? { status: PASS, detail: `${exe} (${statSync(exe).size.toLocaleString()} bytes)` }
    : { status: WARN, detail: `No ${basename(exe)} launcher — invoke through the bundled node CLI.` }
})

// P. Profile completeness -------------------------------------------------
const P1_DIR = check('P1', 'Profile directory exists', (ctx) => {
  const p = ctx.profileDir
  return existsSync(p)
    ? { status: PASS, detail: p }
    : {
        status: FAIL,
        detail: `Missing profile dir: ${p}`,
        fix: 'Run `dsh plugin --profile <name> add <pkg>` (auto-inits on first use), or copy the template package.json + cordis.yml skeleton by hand.',
        autoFix: (c) => {
          try {
            mkdirSync(c.profileDir, { recursive: true })
            writeFileSync(join(c.profileDir, 'cordis.yml'), `# dsh profile root — an empty entry list.\n[]\n`)
            writeFileSync(join(c.profileDir, 'package.json'), JSON.stringify({
              name: `dsh-profile-${c.profileName}`,
              private: true,
              dependencies: {},
              dsh: { profile: { bundles: [] } },
            }, null, 2) + '\n')
            return `Wrote skeleton profile to ${c.profileDir} (bundles list is empty — add @deepseek-ai/dsh-base + app bundle).`
          } catch { return undefined }
        },
      }
})

const P2_CORDIS_YML = check('P2', 'cordis.yml parses as valid YAML', (ctx) => {
  const p = join(ctx.profileDir, 'cordis.yml')
  if (!existsSync(p)) return { status: FAIL, detail: `Missing ${p}` }
  let parsed
  try { parsed = yamlParse(readFileSync(p, 'utf8')) }
  catch (e) { return { status: FAIL, detail: `Parse error in ${p}: ${e.message}` } }
  if (!Array.isArray(parsed)) return { status: WARN, detail: `cordis.yml root is not an array. Actual type: ${typeof parsed} — DSH loader expects [] and layers patches above it.` }
  return { status: PASS, detail: `cordis.yml root array with ${parsed.length} entries (expected 0 for profile root).` }
})

const P3_PKG = check('P3', 'Profile package.json + dsh.profile.bundles', (ctx) => {
  const p = join(ctx.profileDir, 'package.json')
  if (!existsSync(p)) return { status: FAIL, detail: `Missing ${p}` }
  const pkg = ctx.profilePackage()
  if (!pkg) return { status: FAIL, detail: `${p} is not valid JSON.` }
  const bundles = pkg?.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) {
    return { status: FAIL, detail: `${p} is missing dsh.profile.bundles (array of bundle package names).`, fix: 'Add `"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "<app-bundle>"] } }`.', }
  }
  return { status: PASS, detail: `${bundles.length} bundle(s): ${bundles.join(', ') || '(empty)'}` }
})

const P6_NODE_MODULES = check('P6', 'Profile node_modules/ exists', (ctx) => {
  const nm = join(ctx.profileDir, 'node_modules')
  return existsSync(nm)
    ? { status: PASS, detail: `${nm} (${readdirSync(nm).length} top-level entries)` }
    : {
        status: WARN,
        detail: `Missing ${nm} — bundles declared in package.json cannot resolve.`,
        fix: `cd ${ctx.profileDir} && pnpm install`,
        autoFix: (c) => {
          const r = c.run('pnpm', ['install', '--prefer-offline'], { cwd: c.profileDir })
          return r.ok ? `Ran pnpm install in profile dir` : undefined
        },
      }
})

const P4_BUNDLES_RESOLVE = check('P4', 'Each declared bundle resolves on disk', (ctx) => {
  const pkg = ctx.profilePackage()
  const bundles = pkg?.dsh?.profile?.bundles ?? []
  if (bundles.length === 0) return { status: WARN, detail: 'Bundle list is empty — nothing will mount. Minimum useful profile needs at least @deepseek-ai/dsh-base.' }
  const bad = []
  const good = []
  for (const name of bundles) {
    let resolved
    try { resolved = require.resolve(name + '/package.json', { paths: ctx.appResolvePaths() }) }
    catch { /* keep undefined */ }
    if (resolved && existsSync(resolved)) {
      const manifest = ctx.readJson(resolved)
      const hasPatch = !!manifest?.dsh?.bundle?.patch
      good.push(hasPatch ? name : `${name} (⚠ no dsh.bundle.patch — loader skips)`)
      if (!hasPatch) bad.push(`${name}: package has no dsh.bundle.patch declaration`)
    } else {
      bad.push(`${name}: not found under node_modules (try pnpm install in profile dir)`)
    }
  }
  if (bad.length > 0) {
    return {
      status: FAIL,
      detail: `${bad.length}/${bundles.length} bundle(s) unresolved:\n  - ${bad.join('\n  - ')}`,
      fix: `Run pnpm install in the profile dir. For git-hosted plugins you may need to allow their prepare script in pnpm-workspace.yaml (allowBuilds).`,
      autoFix: (c) => {
        const r = c.run('pnpm', ['install', '--prefer-offline'], { cwd: c.profileDir })
        return r.ok ? `Ran pnpm install in profile dir` : undefined
      },
    }
  }
  return { status: PASS, detail: `${good.length} bundle(s) resolvable.` }
})

const P5_PATCH_YML = check('P5', 'cordis.patch.yml files parse as valid YAML', (ctx) => {
  const candidates = [
    join(ctx.profileDir, 'cordis.patch.yml'),
    join(ctx.dshHome, 'cordis.patch.yml'),
    ...ctx.opts.patches.filter(isAbsolute),
  ]
  const bad = []
  const ok = []
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try { yamlParse(readFileSync(p, 'utf8')); ok.push(p) }
    catch (e) { bad.push(`${p}: ${e.message}`) }
  }
  if (bad.length > 0) return { status: FAIL, detail: bad.join('\n') }
  return { status: PASS, detail: ok.length === 0 ? 'No patch file layers present (pure bundle defaults).' : `${ok.length} patch file(s) OK.` }
})

// D. Dependency & plugin health -----------------------------------------
const D1_DUP_BUNDLES = check('D1', 'No duplicate entries in dsh.profile.bundles', (ctx) => {
  const bundles = ctx.profilePackage()?.dsh?.profile?.bundles ?? []
  const seen = new Map()
  bundles.forEach((b, i) => {
    if (!seen.has(b)) seen.set(b, [])
    seen.get(b).push(i)
  })
  const dup = [...seen.entries()].filter(([, idxs]) => idxs.length > 1)
  if (dup.length === 0) return { status: PASS }
  return { status: WARN, detail: `Duplicate bundle declarations: ${dup.map(([b, i]) => `${b} @ indices ${i.join(', ')}`).join('; ')} — wasteful and may cause surprising row ordering.` }
})

const D2_DSH_TOOLS_CONFLICT = check('D2', 'No @deepseek-ai/dsh-tools tool-prepare conflict', (ctx) => {
  // GH Discussion #1697: any plugin that lists @deepseek-ai/dsh-tools as a DIRECT
  // dependency duplicates the prepare symbol and breaks EVERY tool call.
  const pkg = ctx.profilePackage()
  const deps = Object.keys(pkg?.dependencies ?? {})
  const suspects = []
  for (const d of deps) {
    const dp = join(ctx.profileDir, 'node_modules', d, 'package.json')
    if (!existsSync(dp)) continue
    const m = ctx.readJson(dp)
    const direct = m?.dependencies?.['@deepseek-ai/dsh-tools']
    if (direct) suspects.push(`${d} (direct dep on dsh-tools: ${direct})`)
  }
  if (suspects.length > 0) {
    return {
      status: FAIL,
      detail: `Known conflict (GH #1697) — these plugins depend DIRECTLY on @deepseek-ai/dsh-tools:\n  - ${suspects.join('\n  - ')}\nIt duplicates the internal Tool.prepare tagging symbol and breaks every tool call.`,
      fix: 'Report to the plugin author. Plugins should import from specific @deepseek-ai/dsh-tool-* packages instead and remove dsh-tools from their "dependencies".',
    }
  }
  return { status: PASS }
})

const D3_WORKSPACE_ALLOWBUILDS = check('D3', 'pnpm-workspace.yaml allowBuilds (git plugin prepare needs)', (ctx) => {
  const wf = join(ctx.profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(wf)) return { status: WARN, detail: `No ${wf} — pnpm 10+ blocks prepare () builds for github:-sourced plugins by default.` }
  try {
    const parsed = yamlParse(readFileSync(wf, 'utf8'))
    const has = parsed && typeof parsed === 'object' && 'allowBuilds' in parsed
    return { status: has ? PASS : WARN, detail: has ? `pnpm-workspace.yaml allowBuilds present` : `pnpm-workspace.yaml has no allowBuilds — git-sourced plugins will fail prepare() builds.` }
  } catch (e) { return { status: WARN, detail: `pnpm-workspace.yaml parse error: ${e.message}` } }
})

// S. Storage & session log ----------------------------------------------
const S1_STORAGES = check('S1', 'storages directory exists & writable', (ctx) => {
  const s = join(ctx.dshHome, 'storages')
  if (!existsSync(s)) {
    return {
      status: WARN,
      detail: `No storages dir at ${s} — will be created on first boot.`,
      autoFix: (c) => { try { mkdirSync(s, { recursive: true }); return `Created ${s}` } catch { return undefined } },
    }
  }
  try { accessSync(s, fsConstants.W_OK) }
  catch { return { status: FAIL, detail: `${s} not writable` } }
  const ws = join(s, 'workspace.json')
  if (existsSync(ws)) {
    const parsed = ctx.readJson(ws)
    if (!parsed) return { status: FAIL, detail: `${ws} is not valid JSON` }
  }
  return { status: PASS, detail: s }
})

const S2_SESSION_SEQ = check('S2', 'Session-log seq counters: no overlap/regression', (ctx) => {
  const sessionDirs = [
    join(ctx.dshHome, 'storages', 'sessions'),
    join(ctx.profileDir, 'sessions'),
  ].filter(existsSync)
  const findings = []
  let checked = 0
  for (const dir of sessionDirs) {
    let sessionFiles
    try { sessionFiles = readdirSync(dir).filter(f => f.endsWith('.jsonl')) }
    catch { continue }
    for (const f of sessionFiles) {
      const fp = join(dir, f)
      let text
      try { text = readFileSync(fp, 'utf8') } catch { continue }
      const lines = text.split(/\r?\n/).filter(l => l.trim() !== '')
      if (lines.length === 0) continue
      const seqs = []
      for (const line of lines) {
        try {
          const row = JSON.parse(line)
          if (typeof row?.seq === 'number') seqs.push(row.seq)
        } catch { /* skip */ }
      }
      checked += 1
      const seen = new Set()
      let last = -Infinity
      let regressions = 0
      let overlaps = 0
      for (const s of seqs) {
        if (s < last) regressions += 1
        if (seen.has(s)) overlaps += 1
        seen.add(s)
        last = Math.max(last, s)
      }
      if (overlaps > 0 || regressions > 0) {
        findings.push(`${fp}: overlaps=${overlaps}, regressions=${regressions}, total events=${seqs.length}`)
      }
    }
  }
  if (findings.length > 0) {
    return {
      status: WARN,
      detail: `Integrity issues in ${findings.length}/${checked} session(s):\n  ${findings.join('\n  ')}`,
      fix: 'Resume/fork operations on corrupted sessions may fail. Back up the JSONL. In a copy, deduplicate rows by seq (keep last occurrence) and reorder by ascending seq.',
    }
  }
  return { status: PASS, detail: checked === 0 ? 'No session logs yet (fresh profile).' : `${checked} session log(s), all seq monotonic & non-overlapping.` }
})

// M. Smoke probes -------------------------------------------------------
const M1_CONFIG_COMPOSE = check('M1', 'Profile patch-stack composes into a non-empty row tree', (ctx) => {
  const pkg = ctx.profilePackage()
  const bundles = pkg?.dsh?.profile?.bundles ?? []
  const rows = new Map()
  const problems = []
  for (const name of bundles) {
    let pkgJsonPath
    try { pkgJsonPath = require.resolve(name + '/package.json', { paths: ctx.appResolvePaths() }) }
    catch { problems.push(`${name}: unresolvable`); continue }
    const manifest = ctx.readJson(pkgJsonPath) ?? {}
    const patchRel = manifest?.dsh?.bundle?.patch
    if (!patchRel) { problems.push(`${name}: no dsh.bundle.patch`); continue }
    const patchAbs = resolve(dirname(pkgJsonPath), patchRel)
    if (!existsSync(patchAbs)) { problems.push(`${name}: patch file not found at ${patchAbs}`); continue }
    let parsed
    try { parsed = yamlParse(readFileSync(patchAbs, 'utf8')) }
    catch (e) { problems.push(`${name}: patch parse error — ${e.message}`); continue }
    if (!Array.isArray(parsed)) { problems.push(`${name}: patch root is not an array`); continue }
    for (const row of parsed) {
      if (row && typeof row === 'object' && typeof row.id === 'string') rows.set(row.id, row)
    }
  }
  for (const layer of [
    join(ctx.profileDir, 'cordis.patch.yml'),
    join(ctx.dshHome, 'cordis.patch.yml'),
    ...ctx.opts.patches.filter(isAbsolute),
  ]) {
    if (!existsSync(layer)) continue
    try {
      const arr = yamlParse(readFileSync(layer, 'utf8'))
      if (Array.isArray(arr)) for (const row of arr) {
        if (row && typeof row === 'object' && typeof row.id === 'string') {
          if (row.disabled === true) rows.delete(row.id)
          else rows.set(row.id, { ...(rows.get(row.id) ?? {}), ...row })
        }
      }
    } catch { /* reported in P5 */ }
  }
  if (problems.length > 0) return { status: FAIL, detail: problems.join('\n') }
  const coreRows = ['llm', 'tools', 'sessions', 'workspace', 'sandbox-policy']
  const present = coreRows.filter(k => rows.has(k))
  return {
    status: present.length >= 3 ? PASS : WARN,
    detail: `Composed tree: ${rows.size} row ids. Core rows present: ${present.length}/${coreRows.length} (${present.join(', ') || '—'}).`,
  }
})

const M2_SANDBOX = check('M2', 'Sandbox backend available for platform', (ctx) => {
  const plat = process.platform
  if (plat === 'win32') {
    const probe = ctx.run('whoami', ['/groups'])
    return probe.ok
      ? { status: PASS, detail: `Windows: whoami /groups query works (write-restricted-token backend path available).` }
      : { status: WARN, detail: `whoami /groups did not run — sandbox restrictions may fall back to none.` }
  }
  if (plat === 'linux') {
    const bw = ctx.run('bwrap', ['--version'])
    return bw.ok ? { status: PASS, detail: `Linux: bubblewrap ${bw.stdout.split('\n')[0]}` }
                 : { status: WARN, detail: `Linux: bubblewrap not on PATH; install bwrap for strongest isolation.` }
  }
  if (plat === 'darwin') {
    const sb = ctx.run('which', ['sandbox-exec'])
    return sb.ok ? { status: PASS, detail: `macOS: sandbox-exec available (seatbelt backend).` }
                 : { status: WARN, detail: `macOS: sandbox-exec not on PATH.` }
  }
  return { status: WARN, detail: `Unknown platform ${plat} — no sandbox backend probe defined.` }
})

const M3_PORT = check('M3', 'Web default port 3080 currently free', (ctx) => {
  const net = ctx.run('netstat', process.platform === 'win32' ? ['-ano'] : ['-an', '-p', 'tcp'])
  const lines = (net.stdout + '\n' + net.stderr).split(/\r?\n/)
  const occupied = lines.some(l => /[:.]3080\b/.test(l) && /LISTEN|ESTABLISHED/.test(l))
  return occupied
    ? { status: WARN, detail: `Port 3080 already in use — web surface fails to bind. Stop the occupying process or use a free port.` }
    : { status: PASS, detail: 'Port 3080 free (listening sockets not detected).' }
})

const M4_API_KEY = check('M4', 'DEEPSEEK_API_KEY configured (optional)', () => {
  const v = process.env.DEEPSEEK_API_KEY
  if (!v) return { status: WARN, detail: 'DEEPSEEK_API_KEY not set in env. Real-API agent runs fall back to mock or fail.' }
  const masked = v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)} (len=${v.length})` : `(len=${v.length})`
  return { status: PASS, detail: `DEEPSEEK_API_KEY present: ${masked}` }
})

// ---------------------------------------------------------------------------
// §5  Runner
// ---------------------------------------------------------------------------
const ALL_CHECKS = [
  R1_NODE, R2_PNPM, R3_GIT, R4_HOME, R5_TMP,
  I1_NODE_BIN, I2_CLI_BIN, I3_ELECTRON, I4_EXE,
  P1_DIR, P2_CORDIS_YML, P3_PKG, P6_NODE_MODULES, P4_BUNDLES_RESOLVE, P5_PATCH_YML,
  D1_DUP_BUNDLES, D2_DSH_TOOLS_CONFLICT, D3_WORKSPACE_ALLOWBUILDS,
  S1_STORAGES, S2_SESSION_SEQ,
  M1_CONFIG_COMPOSE, M2_SANDBOX, M3_PORT, M4_API_KEY,
]

async function runAll(ctx) {
  const results = []
  for (const chk of ALL_CHECKS) {
    let res
    try {
      const out = (await chk.runner(ctx)) ?? { status: PASS }
      res = { status: out.status || PASS, detail: out.detail, fix: out.fix, autoFix: out.autoFix }
    } catch (e) {
      res = { status: FAIL, detail: `Check threw: ${e && e.stack ? e.stack : String(e)}` }
    }
    results.push({ code: chk.code, title: chk.title, ...res })
  }
  return results
}

// ---------------------------------------------------------------------------
// §6  Formatters
// ---------------------------------------------------------------------------
function formatTerminal(ctx, results) {
  const lines = []
  const catOf = (code) => ({ R: 'Runtime', I: 'Installer', P: 'Profile', D: 'Dependencies', S: 'Storage', M: 'Smoke' })[code[0]] || 'Misc'
  const grouped = new Map()
  for (const r of results) {
    const k = catOf(r.code)
    if (!grouped.has(k)) grouped.set(k, [])
    grouped.get(k).push(r)
  }
  const t0 = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
  lines.push(c(` dsh doctor — report generated ${t0} `, 'bold'))
  lines.push(`${c('Platform', 'dim')}: ${ctx.host.platform} ${ctx.host.arch} · Node ${process.versions.node} · ${ctx.host.cpuCores} cores · ${Math.round(ctx.host.totalMem / 1024**3)} GB RAM`)
  lines.push(`${c('Installer', 'dim')}: ${ctx.installerRoot ? ctx.installerRoot : c('not located (set DSH_INSTALLER_ROOT or place doctor.js in DeepSeekHarness/app/lib/)', 'yellow')}`)
  lines.push(`${c('DSH_HOME', 'dim')}: ${ctx.dshHome}`)
  lines.push(`${c('Profile',  'dim')}: ${ctx.profileName} → ${ctx.profileDir}`)
  lines.push('')

  let pass = 0, warn = 0, fail = 0
  for (const [cat, rs] of grouped) {
    lines.push(c(`── ${cat} ` + '─'.repeat(Math.max(4, 60 - cat.length)), 'dim'))
    for (const r of rs) {
      let badge, color
      if (r.status === PASS) { badge = 'PASS'; color = 'bgGreen'; pass += 1 }
      else if (r.status === WARN) { badge = 'WARN'; color = 'bgYellow'; warn += 1 }
      else { badge = 'FAIL'; color = 'bgRed'; fail += 1 }
      lines.push(`${c(` ${badge} `, color)} ${c(r.code, 'cyan')}  ${r.title}`)
      if (r.detail) lines.push(`       ${c(r.detail.split('\n').join('\n       '), 'gray')}`)
      if (r.fix)  lines.push(`       ${c('→  ', 'magenta')}${c(r.fix.split('\n').join('\n          '), 'yellow')}`)
    }
    lines.push('')
  }
  const total = pass + warn + fail
  const verdict = fail > 0 ? c('FAILED', 'red') : warn > 0 ? c('ISSUES', 'yellow') : c('HEALTHY', 'green')
  const elapsed = ((Date.now() - ctx.startTime) / 1000).toFixed(2)
  lines.push(c('── Summary ' + '─'.repeat(53), 'dim'))
  lines.push(`Result: ${verdict}  ·  ${c(String(pass), 'green')} pass  ·  ${c(String(warn), 'yellow')} warn  ·  ${c(String(fail), 'red')} fail  ·  ${total} checks in ${elapsed}s`)
  lines.push('')
  lines.push(c('Tip: re-run with ', 'dim') + c('--fix', 'bold') + c(' to attempt auto-repairs, or with ', 'dim') + c('--json', 'bold') + c(' for machine-readable output.', 'dim'))
  return lines.join('\n')
}

function formatJson(ctx, results) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    host: ctx.host,
    paths: {
      installerRoot: ctx.installerRoot ?? null,
      appRoot: ctx.appRoot ?? null,
      dshHome: ctx.dshHome,
      profileName: ctx.profileName,
      profileDir: ctx.profileDir,
    },
    checks: results.map(r => ({
      code: r.code, title: r.title, status: r.status,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.fix ? { fix: r.fix } : {}),
    })),
    summary: {
      pass: results.filter(r => r.status === PASS).length,
      warn: results.filter(r => r.status === WARN).length,
      fail: results.filter(r => r.status === FAIL).length,
      total: results.length,
      elapsedMs: Date.now() - ctx.startTime,
    },
  }, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// §7  Auto-fix
// ---------------------------------------------------------------------------
function runFixes(ctx, results) {
  const actions = []
  for (const r of results) {
    if (r.status === PASS) continue
    if (typeof r.autoFix !== 'function') continue
    try {
      const note = r.autoFix(ctx)
      if (note) actions.push({ code: r.code, note })
    } catch (e) { actions.push({ code: r.code, error: String(e) }) }
  }
  return actions
}

// ---------------------------------------------------------------------------
// §8  main
// ---------------------------------------------------------------------------
function exitFromResults(results) {
  if (results.some(r => r.status === FAIL)) process.exit(1)
  if (results.some(r => r.status === WARN)) process.exit(2)
  process.exit(0)
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) { process.stdout.write(HELP); process.exit(0) }
  const ctx = new Ctx(opts)
  let results = await runAll(ctx)
  let fixReport
  if (opts.fix) {
    fixReport = runFixes(ctx, results)
    results = await runAll(ctx)
  }
  if (opts.json) {
    const out = JSON.parse(formatJson(ctx, results).trim())
    if (fixReport && fixReport.length > 0) out.fixes = fixReport
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  } else {
    process.stdout.write(formatTerminal(ctx, results))
    if (fixReport && fixReport.length > 0) {
      process.stdout.write('\n' + c('── Auto-fixes applied ' + '─'.repeat(45), 'dim') + '\n')
      for (const a of fixReport) {
        const body = a.error ? c(`ERROR ${a.error}`, 'red') : c(a.note, 'green')
        process.stdout.write(`  ${c(a.code, 'cyan')}  ${body}\n`)
      }
    }
  }
  exitFromResults(results)
}
main().catch((e) => {
  process.stderr.write(`dsh-doctor: fatal error — ${e && e.stack ? e.stack : String(e)}\n`)
  process.exit(99)
})
