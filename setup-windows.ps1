param([switch] $Check)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$originalPath = $env:Path

function Refresh-SetupPath {
    $env:Path = @(
        $originalPath
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) -join ';'
}

function Find-Node {
    foreach ($command in Get-Command node.exe -All -CommandType Application -ErrorAction SilentlyContinue) {
        if ($command.Source -like '*\Microsoft\WindowsApps\*') { continue }
        $version = & $command.Source --version
        if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int] $Matches[1] -ge 20) {
            return $command.Source
        }
    }
}

function Find-EgoCli {
    $command = Get-Command ego-browser.exe -CommandType Application -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
}

function Find-EgoApp {
    $running = Get-Process -Name ego -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1
    if ($running) { return $running.Path }
    foreach ($directory in @($env:ProgramW6432, $env:ProgramFiles, $env:LOCALAPPDATA)) {
        if (-not $directory) { continue }
        $app = Join-Path $directory 'Citro Labs\ego lite\Application\ego.exe'
        if (Test-Path -LiteralPath $app -PathType Leaf) { return $app }
    }
}

function Find-EgoWindow {
    Get-Process -Name ego -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
        Select-Object -First 1
}

function Write-SetupEvent($status) {
    @{ status = $status } | ConvertTo-Json -Compress
}

function Write-SetupState {
    Refresh-SetupPath
    $node = Find-Node
    $egoCli = Find-EgoCli
    $egoApp = Find-EgoApp
    $status = if ($node -and $egoCli) { 'ready' } else { 'setup_needed' }
    @{ status = $status; nodePath = $node; egoBrowserPath = $egoCli; egoAppPath = $egoApp } | ConvertTo-Json -Compress
}

function Start-SetupInstaller($file, $arguments, $event, $successCodes) {
    $options = @{ FilePath = $file; Wait = $true; PassThru = $true }
    if ($arguments) { $options.ArgumentList = $arguments }
    Write-SetupEvent $event
    $process = Start-Process @options
    if ($process.ExitCode -notin $successCodes) {
        throw "Installer exited with code $($process.ExitCode): $event"
    }
}

function Get-SetupInstaller($url, $file) {
    Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing -TimeoutSec 600
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid') {
        throw "Installer signature could not be verified: $($signature.Status)"
    }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This setup script is for Windows.' }
if ($Check) {
    Write-SetupState
    return
}
Refresh-SetupPath
if ((Find-EgoCli) -and (Find-Node)) {
    Write-SetupState
    return
}
if (-not [Environment]::UserInteractive) { throw 'Run setup on the Windows desktop where Ego Lite will be used.' }

$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if (-not (Find-EgoCli) -and -not (Find-EgoApp)) {
    if ($architecture -ne 'X64') { throw 'The automatic Ego Lite download is for Windows x64.' }
    $installer = Join-Path ([IO.Path]::GetTempPath()) ("egoliteSetup-" + [guid]::NewGuid().ToString('N') + ".exe")
    try {
        Get-SetupInstaller 'https://cdn.ego.app/setup/windows/x64/egoliteSetup.exe' $installer
        Start-SetupInstaller $installer $null 'ego_installer' @(0)
    } finally {
        Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
    }
    Refresh-SetupPath
}

if (-not (Find-EgoCli)) {
    $app = Find-EgoApp
    if (-not $app) { throw 'Ego Lite was not found after installation.' }
    if (-not (Find-EgoWindow)) { Start-Process -FilePath $app }
    $shown = $false
    $windowDeadline = (Get-Date).AddSeconds(30)
    $deadline = (Get-Date).AddMinutes(10)
    do {
        Refresh-SetupPath
        if (Find-EgoCli) { break }
        if (-not $shown) {
            if (Find-EgoWindow) {
                Write-SetupEvent 'ego_setup'
                $shown = $true
            } elseif ((Get-Date) -ge $windowDeadline) {
                throw 'The Ego Lite window did not appear.'
            }
        }
        Start-Sleep -Seconds 2
    } until ((Get-Date) -ge $deadline)
    if (-not (Find-EgoCli)) { throw 'Ego Lite setup has not made ego-browser available yet.' }
}

if (-not (Find-Node)) {
    $platform = switch ($architecture) {
        'X64' { 'x64' }
        'ARM64' { 'arm64' }
        default { throw "No automatic Node.js installer for $architecture." }
    }
    $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 30
    $release = $releases | Where-Object { $_.lts -and $_.files -contains "win-$platform-msi" } | Select-Object -First 1
    if ($release.version -notmatch '^v\d+\.\d+\.\d+$') { throw 'Node.js LTS installer was not found.' }
    $fileName = "node-$($release.version)-$platform.msi"
    $installer = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N') + '-' + $fileName)
    try {
        Get-SetupInstaller "https://nodejs.org/dist/$($release.version)/$fileName" $installer
        Start-SetupInstaller 'msiexec.exe' @('/i', ('"' + $installer + '"'), '/passive', '/norestart') 'node_installer' @(0, 3010)
    } finally {
        Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
    }
}

Write-SetupState
