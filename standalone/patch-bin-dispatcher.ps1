param([Parameter(Mandatory=$true)][string]$Target)

$binJs = Join-Path $Target 'app\lib\bin.js'
if (-not (Test-Path $binJs)) {
    Write-Host "[patch] ERROR: $binJs not found"
    exit 3
}

# Idempotent: check for dispatcher marker
$content = Get-Content $binJs -Raw
if ($content -match 'doctor dispatcher') {
    Write-Host '[patch] Already patched -> skipping.'
    exit 0
}

# Backup original (only first time)
$bak = "$binJs.bak"
if (-not (Test-Path $bak)) {
    Copy-Item $binJs $bak
    Write-Host "[patch] Backup saved: $bak"
} else {
    Write-Host "[patch] Backup already exists: $bak (preserving original)"
}

# The ESM-compatible doctor dispatcher block.
# Inserted BEFORE `const invocation = parseDshArgs(...)` — after all hoisted
# imports, so it runs at the right time: after module imports resolve, but
# before commander parses argv (which would reject `dsh doctor` as unknown).
$dispatcher = @'
// ---- doctor dispatcher (ESM, zero-build Path A) ---------------------------
// Runs BEFORE parseDshArgs. If argv[2] === 'doctor', forwards to
// doctor-engine.js and exits. Otherwise falls through to normal DSH parsing.
if (process.argv[2] === 'doctor') {
  const { spawnSync } = await import('node:child_process');
  const { resolve, dirname } = await import('node:path');
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const engine = resolve(__dirname, 'doctor-engine.js');
  if (!existsSync(engine)) {
    process.stderr.write(`[dsh doctor] FATAL: doctor-engine.js not found at ${engine}\n`);
    process.exit(97);
  }
  const r = spawnSync(process.execPath, [engine, ...process.argv.slice(3)], {
    stdio: 'inherit', env: process.env,
  });
  process.exit(r.status === null ? 99 : r.status);
}
// -------------------------- end doctor dispatcher ---------------------------

'@

# Insert the dispatcher right before `const invocation = parseDshArgs(`
$marker = 'const invocation = parseDshArgs('
if ($content -notmatch [regex]::Escape($marker)) {
    Write-Host "[patch] ERROR: cannot find marker: $marker"
    Write-Host "  The bin.js structure may have changed. Apply manually."
    exit 4
}

$newContent = $content -replace [regex]::Escape($marker), "$dispatcher$marker"
Set-Content -Path $binJs -Value $newContent -NoNewline
Write-Host '[patch] OK   bin.js patched with ESM doctor dispatcher.'
Write-Host '[patch]      Inserted before parseDshArgs() — runs after imports, before commander.'
exit 0
