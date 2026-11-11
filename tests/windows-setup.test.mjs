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
