'use strict';
// Windows only: run PowerShell / WSL commands as the signed-in interactive user.
// The installer usually runs elevated, often as another account than the user who is signed in, while WSL distros are registered
// per Windows user. Commands for WSL therefore run through a one-shot scheduled task as the interactive user (slower, ~10-30 s).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const RUN_DIR = 'C:\\ProgramData\\hvc-run';
const psq = s => String(s).replace(/'/g, "''");   // PowerShell single-quoted

function runPS(script, timeoutMs = 600000) {
  return new Promise(resolve => {
    let out = '', err = '';
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script], { windowsHide: true });
    const t = setTimeout(() => ps.kill(), timeoutMs);
    ps.stdout.on('data', d => out += d.toString('utf8'));
    ps.stderr.on('data', d => err += d.toString('utf8'));
    ps.on('close', () => { clearTimeout(t); resolve({ out: out.trim(), err: err.trim() }); });
    ps.on('error', e => { clearTimeout(t); resolve({ out: '', err: e.message }); });
  });
}

// Run a PowerShell script as the signed-in interactive user (limited token) and return its output.
async function runAsUser(script, timeoutSec = 600) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const file = path.join(RUN_DIR, `${id}.ps1`), outFile = path.join(RUN_DIR, `${id}.out`);
  fs.writeFileSync(file, `$ErrorActionPreference='Continue'\r\n& {\r\n${script}\r\n} *>&1 | Out-File -FilePath '${psq(outFile)}' -Encoding utf8\r\n`, 'utf8');
  const r = await runPS(
    `$user=(Get-CimInstance Win32_ComputerSystem).UserName; if(-not $user){ 'ERROR:No interactive user is signed in'; exit }; ` +
    `$name='ELO-Installer-${id}'; ` +
    // conhost --headless (Windows 11 / 10 2004+) runs the console program with no window at all; -WindowStyle Hidden alone still flashes one.
    `$ps='-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${psq(file)}"'; ` +
    `if([Environment]::OSVersion.Version.Build -ge 19041 -and (Test-Path "$env:SystemRoot\\System32\\conhost.exe")){ $a=New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ('--headless powershell.exe '+$ps) } else { $a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $ps }; ` +
    `$p=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited; ` +
    `Register-ScheduledTask -TaskName $name -Action $a -Principal $p -Force | Out-Null; ` +
    `try { Start-ScheduledTask -TaskName $name; $dl=(Get-Date).AddSeconds(${timeoutSec}); ` +
    // 267011 = not run yet, 267009 = running
    `do { Start-Sleep -Milliseconds 400; $c=(Get-ScheduledTaskInfo -TaskName $name).LastTaskResult } while(($c -eq 267011 -or $c -eq 267009) -and (Get-Date) -lt $dl) } ` +
    `finally { Unregister-ScheduledTask -TaskName $name -Confirm:$false -EA SilentlyContinue }`, (timeoutSec + 30) * 1000);
  let out = '';
  for (let i = 0; i < 10; i++) {   // the file can still be held briefly by the finishing task
    try { out = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''); fs.unlinkSync(outFile); break; }
    catch { await new Promise(res => setTimeout(res, 300)); }
  }
  try { fs.unlinkSync(file); } catch {}
  if (/^ERROR:/m.test(r.out)) throw new Error(r.out.match(/ERROR:(.*)/)[1]);
  return out.replace(/\r/g, '');
}

// Run a bash script as root in the user's WSL distro (kept running with a hidden "sleep infinity").
async function runWsl(distro, bash, timeoutSec = 600) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const file = path.join(RUN_DIR, `${id}.sh`);
  fs.writeFileSync(file, `#!/bin/bash\n${bash}\n`.replace(/\r/g, ''), 'utf8');
  try {
    return await runAsUser(
      `if(-not (Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { $_.CommandLine -match 'sleep infinity' -and $_.CommandLine -match '${psq(distro)}' })) { ` +
      `Start-Process wsl.exe -ArgumentList '-d','${psq(distro)}','-u','root','--','sleep','infinity' -WindowStyle Hidden; Start-Sleep 4 }\r\n` +
      `wsl.exe -d '${psq(distro)}' -u root -- bash '/mnt/c/ProgramData/hvc-run/${id}.sh' 2>&1`, timeoutSec);
  } finally { try { fs.unlinkSync(file); } catch {} }
}

module.exports = { runAsUser, runWsl, runPS };
