# start_proxy.ps1 — SOCKS5 local + bore.pub tunnel + auto-update Wasender
# Uso: .\start_proxy.ps1
# Lee WASENDER_PAT, WASENDER_SESSION_ID del .env automaticamente

param(
    [string]$WasenderPAT = "",
    [int]   $SessionId   = 0,
    [int]   $Port        = 1080,
    [string]$ProxyUser   = "wasender",
    [string]$ProxyPass   = "S3cur3Pr0xy"
)

# --- Leer .env ---
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.+)$') {
            $k = $Matches[1].Trim(); $v = $Matches[2].Trim()
            if ($k -eq "WASENDER_PAT"        -and -not $WasenderPAT) { $WasenderPAT = $v }
            if ($k -eq "WASENDER_SESSION_ID" -and $SessionId -eq 0)  { $SessionId  = [int]$v }
        }
    }
}

if (-not $WasenderPAT) {
    Write-Host "ERROR: Falta WASENDER_PAT en .env" -ForegroundColor Red; exit 1
}
if ($SessionId -eq 0) {
    Write-Host "ERROR: Falta WASENDER_SESSION_ID en .env" -ForegroundColor Red; exit 1
}

$boreExe    = Join-Path $PSScriptRoot "bore.exe"
$proxyScript = Join-Path $PSScriptRoot "socks5_proxy.py"
$boreLog    = "$env:TEMP\bore_output.txt"
$boreErr    = "$env:TEMP\bore_err.txt"

function Start-Proxy {
    # Matar instancias previas
    Get-Process -Name "bore" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-Process -Name "python*" -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine
        if ($cmd -like "*socks5_proxy*") { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    }
    Start-Sleep -Milliseconds 500

    # Iniciar SOCKS5
    $proxy = Start-Process python `
        -ArgumentList @($proxyScript, $Port, $ProxyUser, $ProxyPass) `
        -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 400

    if ($proxy.HasExited) {
        Write-Host "ERROR: SOCKS5 proxy no arrancó" -ForegroundColor Red
        return $null
    }
    Write-Host "SOCKS5 proxy corriendo (PID $($proxy.Id))" -ForegroundColor Green

    # Iniciar bore y capturar puerto
    if (Test-Path $boreLog) { Remove-Item $boreLog -Force }
    if (Test-Path $boreErr) { Remove-Item $boreErr -Force }

    $bore = Start-Process $boreExe `
        -ArgumentList @("local", $Port, "--to", "bore.pub") `
        -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $boreLog `
        -RedirectStandardError $boreErr

    # Esperar hasta 8 seg a que bore asigne puerto
    $borePort = ""
    for ($i = 0; $i -lt 16; $i++) {
        Start-Sleep -Milliseconds 500
        $out = Get-Content $boreLog -ErrorAction SilentlyContinue
        $err = Get-Content $boreErr -ErrorAction SilentlyContinue
        $combined = ($out + $err) -join "`n"
        if ($combined -match "listening at bore\.pub:(\d+)") {
            $borePort = $Matches[1]; break
        }
        if ($bore.HasExited) {
            Write-Host "ERROR: bore terminó inesperadamente" -ForegroundColor Red
            Write-Host $combined
            return $null
        }
    }

    if (-not $borePort) {
        Write-Host "ERROR: No se pudo obtener el puerto de bore.pub" -ForegroundColor Red
        $bore.Kill()
        return $null
    }

    $proxyUrl = "socks5://${ProxyUser}:${ProxyPass}@bore.pub:$borePort"
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║  Proxy activo: $proxyUrl" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""

    # Actualizar Wasender
    $body = @{ proxy_url = $proxyUrl; always_online = $false; account_protection = $false } | ConvertTo-Json
    try {
        $r = Invoke-RestMethod -Method PUT `
            -Uri "https://www.wasenderapi.com/api/whatsapp-sessions/$SessionId" `
            -Headers @{ Authorization = "Bearer $WasenderPAT"; "Content-Type" = "application/json" } `
            -Body $body -ErrorAction Stop
        if ($r.success) {
            Write-Host "Wasender (session $SessionId) actualizado con proxy." -ForegroundColor Green
        }
    } catch {
        Write-Host "ADVERTENCIA: No se pudo actualizar Wasender: $_" -ForegroundColor Yellow
        Write-Host "Configúralo manualmente: $proxyUrl"
    }

    return @{ proxy = $proxy; bore = $bore; port = $borePort }
}

# --- Bucle principal con auto-restart ---
Write-Host "Iniciando proxy con auto-restart..." -ForegroundColor Cyan
$procs = Start-Proxy

if (-not $procs) { exit 1 }

Write-Host "Monitoreando (Ctrl+C para detener)..." -ForegroundColor Cyan
try {
    while ($true) {
        Start-Sleep -Seconds 15
        if ($procs.bore.HasExited -or $procs.proxy.HasExited) {
            Write-Host "Túnel caído, reiniciando..." -ForegroundColor Yellow
            $procs = Start-Proxy
            if (-not $procs) {
                Write-Host "No se pudo reiniciar. Reintentando en 30s..." -ForegroundColor Red
                Start-Sleep -Seconds 30
                $procs = Start-Proxy
            }
        }
    }
} finally {
    Write-Host "Deteniendo..." -ForegroundColor Cyan
    if ($procs) {
        $procs.bore.Kill()  -ErrorAction SilentlyContinue 2>$null
        $procs.proxy.Kill() -ErrorAction SilentlyContinue 2>$null
    }
    Get-Process -Name "bore" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
