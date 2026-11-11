import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("Windows setup waits for the installer's child process", { skip: process.platform !== "win32" }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), "meituan-setup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const installer = path.join(dir, "installer.ps1");
  const child = path.join(dir, "child.ps1");
  const marker = path.join(dir, "finished.txt");
  await writeFile(installer, [
    "$ErrorActionPreference = 'Stop'",
    "$child = '\"' + $env:MD_SETUP_TEST_CHILD + '\"'",
    "Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-File',$child) -WindowStyle Hidden",
  ].join("\n"));
  await writeFile(child, [
    "Start-Sleep -Milliseconds 600",
    "Set-Content -LiteralPath $env:MD_SETUP_TEST_MARKER -Value 'finished'",
  ].join("\n"));

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$source = [System.Management.Automation.Language.Parser]::ParseFile($env:MD_SETUP_TEST_SCRIPT, [ref]$null, [ref]$null)",
    "$definition = $source.Find({ param($item) $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Start-SetupInstaller' }, $true)",
    ". ([scriptblock]::Create($definition.Extent.Text))",
    "function Write-SetupEvent($status) { Write-Output $status }",
    "$PSDefaultParameterValues['Start-Process:WindowStyle'] = 'Hidden'",
    "$installer = '\"' + $env:MD_SETUP_TEST_INSTALLER + '\"'",
    "Start-SetupInstaller (Join-Path $PSHOME 'powershell.exe') @('-NoProfile','-File',$installer) 'fixture_installer' @(0)",
    "if (-not (Test-Path -LiteralPath $env:MD_SETUP_TEST_MARKER)) { throw 'Installer child still running' }",
  ].join("\n");
  const output = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "RemoteSigned", "-Command", script], {
    encoding: "utf8", timeout: 20000, windowsHide: true,
    env: {
      ...process.env,
      MD_SETUP_TEST_SCRIPT: fileURLToPath(new URL("../setup-windows.ps1", import.meta.url)),
      MD_SETUP_TEST_INSTALLER: installer,
      MD_SETUP_TEST_CHILD: child,
      MD_SETUP_TEST_MARKER: marker,
    },
  });
  assert.match(output, /fixture_installer/);
  assert.equal((await readFile(marker, "utf8")).trim(), "finished");
});

test("Windows setup distinguishes a running Ego process from an open window", { skip: process.platform !== "win32" }, () => {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$source = [System.Management.Automation.Language.Parser]::ParseFile($env:MD_SETUP_TEST_SCRIPT, [ref]$null, [ref]$null)",
    "$definition = $source.Find({ param($item) $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Find-EgoWindow' }, $true)",
    ". ([scriptblock]::Create($definition.Extent.Text))",
    "$script:handle = [IntPtr]::Zero",
    "function Get-Process { [pscustomobject]@{ MainWindowHandle = $script:handle } }",
    "if (Find-EgoWindow) { throw 'A background process does not have a window' }",
    "$script:handle = [IntPtr] 1",
    "if (-not (Find-EgoWindow)) { throw 'Expected the process with a window' }",
  ].join("\n");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8", timeout: 10000, windowsHide: true,
    env: { ...process.env, MD_SETUP_TEST_SCRIPT: fileURLToPath(new URL("../setup-windows.ps1", import.meta.url)) },
  });
});

test("Windows daily launch opens the installed Ego app only when needed and rejects --no-sandbox", { skip: process.platform !== "win32" }, () => {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$source = [System.Management.Automation.Language.Parser]::ParseFile($env:MD_SETUP_TEST_SCRIPT, [ref]$null, [ref]$null)",
    "$definition = $source.Find({ param($item) $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Open-EgoWindow' }, $true)",
    ". ([scriptblock]::Create($definition.Extent.Text))",
    "$script:starts = 0",
    "$script:window = $null",
    "$script:commandLine = '\"C:\\Installed Ego\\ego.exe\"'",
    "function Find-EgoWindow { $script:window }",
    "function Find-EgoApp { 'C:\\Installed Ego\\ego.exe' }",
    "function Start-Process($FilePath, $WorkingDirectory) {",
    "    if ($FilePath -ne 'C:\\Installed Ego\\ego.exe' -or $WorkingDirectory -ne 'C:\\Installed Ego' -or $args.Count) { throw 'Unexpected launcher or arguments' }",
    "    $script:starts++",
    "    $script:window = @{ Id = 42 }",
    "}",
    "function Get-CimInstance($ClassName, $Filter) {",
    "    if ($ClassName -ne 'Win32_Process' -or $Filter -ne 'ProcessId = 42') { throw 'Expected the visible browser process' }",
    "    @{ CommandLine = $script:commandLine }",
    "}",
    "Open-EgoWindow",
    "Open-EgoWindow",
    "if ($script:starts -ne 1) { throw 'Expected the existing browser to be reused' }",
    "$script:commandLine += ' --no-sandbox'",
    "$rejected = $false",
    "try { Open-EgoWindow } catch { if ($_.Exception.Message -notmatch 'was started with --no-sandbox') { throw }; $rejected = $true }",
    "if (-not $rejected -or $script:starts -ne 1) { throw 'Expected the unsupported startup to be reported without restarting the browser' }",
  ].join("\n");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8", timeout: 10000, windowsHide: true,
    env: { ...process.env, MD_SETUP_TEST_SCRIPT: fileURLToPath(new URL("../setup-windows.ps1", import.meta.url)) },
  });
});
