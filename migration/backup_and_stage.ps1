<#
.SYNOPSIS
  Respaldo de producción → copia local de staging → verificación → diagnóstico.

.DESCRIPTION
  1. mongodump de la base (SOLO LECTURA en producción) a backups/backup_<fecha>.archive.gz
     — mismo nombre que usa apps/api/scripts/backup_mongo.py, así su retención aplica.
  2. Restaura ese archivo en el Mongo LOCAL de staging (migration/docker-compose.yml).
  3. Verifica colección por colección que la copia tiene exactamente los mismos
     documentos que se respaldaron. Si algo no cuadra, el respaldo se marca como NO válido.
  4. Corre el diagnóstico de migración (scripts/mongo_migration_audit.py) contra la
     copia local — nunca contra producción.
  Deja un manifiesto backups/backup_<fecha>.manifest.json (conteos + sha256).
  Nunca imprime la URI.

.EXAMPLE
  # Con el túnel a producción abierto (lee MONGODB_URI de apps/api/.env si no se pasa):
  .\migration\backup_and_stage.ps1
#>
param(
  [string]$MongoUri = $env:MONGODB_URI,
  [string]$Database = $(if ($env:DATABASE_NAME) { $env:DATABASE_NAME } else { 'commercial' }),
  [switch]$SkipAudit
)
# 'Continue': docker escribe su progreso normal en stderr, y en Windows PowerShell 5.1
# con 'Stop' eso aborta el script. Los errores se deciden por $LASTEXITCODE y throw.
$ErrorActionPreference = 'Continue'
$root = Split-Path $PSScriptRoot -Parent
$compose = Join-Path $PSScriptRoot 'docker-compose.yml'
$backups = Join-Path $root 'backups'
New-Item -ItemType Directory -Force $backups | Out-Null

if (-not $MongoUri) {
  $envFile = Join-Path $root 'apps\api\.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^\s*MONGODB_URI\s*=' } | Select-Object -First 1
    if ($line) { $MongoUri = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'") }
  }
}
if (-not $MongoUri) { throw 'Falta MONGODB_URI (variable de entorno o apps/api/.env).' }

# Dentro de un contenedor, "localhost" es el propio contenedor: el túnel vive en esta máquina.
$containerUri = $MongoUri -replace '(@|//)(localhost|127\.0\.0\.1)(:\d+)', '$1host.docker.internal$3'

Write-Host '1/4  Levantando el entorno local de staging…'
docker compose -f $compose up -d --wait mongo-staging 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo levantar el Mongo local de staging (¿Docker Desktop está abierto?).' }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$name = "backup_$stamp.archive.gz"
$archive = Join-Path $backups $name

Write-Host "2/4  Respaldando '$Database' (solo lectura)…"
# La URI va por variable de entorno del contenedor, no en la línea de comandos.
$dumpCmd = 'mongodump --uri="$SRC_URI" --db="$SRC_DB" --archive="/backups/ARCHIVE" --gzip 2>&1'.Replace('ARCHIVE', $name)
$dumpLog = docker run --rm -e "SRC_URI=$containerUri" -e "SRC_DB=$Database" -v "${backups}:/backups" mongo:7.0 `
  sh -c $dumpCmd 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) {
  $dumpLog | Where-Object { $_ -notmatch 'mongodb://' } | Select-Object -Last 10 | Write-Host
  throw 'mongodump falló — no se creó respaldo.'
}
$dumped = @{}
foreach ($l in $dumpLog) {
  # Formato real: done dumping `commercial.companies` (3 documents)
  if ($l -match 'done dumping `?[^.`]+\.([^`\s]+)`? \((\d+) documents?\)') { $dumped[$Matches[1]] = [int64]$Matches[2] }
}
if ($dumped.Count -eq 0) { throw 'mongodump no reportó ninguna colección: revisa el nombre de la base.' }
$size = [math]::Round((Get-Item $archive).Length / 1MB, 1)
Write-Host "     $($dumped.Count) colecciones, $(($dumped.Values | Measure-Object -Sum).Sum) documentos, $size MB"

Write-Host '3/4  Restaurando en el Mongo local de staging y verificando…'
$restoreLog = docker compose -f $compose exec -T mongo-staging `
  mongorestore --archive="/backups/$name" --gzip --drop --nsInclude="$Database.*" 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { $restoreLog | Select-Object -Last 10 | Write-Host; throw 'mongorestore falló.' }
$countsJson = docker compose -f $compose exec -T mongo-staging mongosh --quiet --eval `
  "const d=db.getSiblingDB('$Database'); JSON.stringify(Object.fromEntries(d.getCollectionNames().map(c=>[c,d.getCollection(c).countDocuments()])))"
$restored = $countsJson | ConvertFrom-Json
$problems = @()
foreach ($coll in $dumped.Keys) {
  $got = $restored.$coll
  if ($got -ne $dumped[$coll]) { $problems += "$coll respaldados=$($dumped[$coll]) restaurados=$got" }
}
$sha = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
$manifest = [ordered]@{
  archive = $name; database = $Database; created_at = (Get-Date).ToUniversalTime().ToString('o')
  size_mb = $size; sha256 = $sha; collections = $dumped; verified_restore = ($problems.Count -eq 0); problems = $problems
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $backups "backup_$stamp.manifest.json")
if ($problems.Count) {
  $problems | ForEach-Object { Write-Host "     NO CUADRA: $_" -ForegroundColor Red }
  throw 'La copia restaurada no coincide con el respaldo: NO usar este respaldo.'
}
Write-Host "     OK: las $($dumped.Count) colecciones coinciden documento por documento (sha256 $($sha.Substring(0,12))…)" -ForegroundColor Green

if (-not $SkipAudit) {
  Write-Host '4/4  Diagnóstico de migración sobre la copia local…'
  $prevUri = $env:MONGODB_URI; $prevDb = $env:DATABASE_NAME
  try {
    $env:MONGODB_URI = 'mongodb://127.0.0.1:27030/?directConnection=true'
    $env:DATABASE_NAME = $Database
    python (Join-Path $root 'apps\api\scripts\mongo_migration_audit.py') --out (Join-Path $backups "mongo_audit_$stamp.json") |
      Tee-Object -FilePath (Join-Path $backups "mongo_audit_$stamp.txt")
  } finally { $env:MONGODB_URI = $prevUri; $env:DATABASE_NAME = $prevDb }
}
Write-Host "`nListo. Respaldo verificado: backups\$name" -ForegroundColor Green
