'use strict';
// Browser terminal + access data + X desktop for the machines the installer manages.
//  - /terminal.html (xterm.js) ⇄ WebSocket /ws/terminal ⇄ a pseudo-terminal (ConPTY) running:
//      Linux machines (WSL, Hyper-V/VirtualBox VMs, servers): ssh with the installer key;  Docker containers: ssh + docker exec;
//      Windows VMs: PowerShell Direct (Enter-PSSession -VMName) as Administrator (no network or RDP needed).
//  - /api/access: SSH / PowerShell Direct / RDP data of a machine (user, password, host, port, key).
//  - /api/desktop/*: install Xfce / LXQt / GNOME (+ Firefox) with a VNC server and noVNC in a Linux machine, and open it through
//    an SSH tunnel (-L) in the browser — nothing in the machine is exposed to the network.
// Everything here is limited to requests from this computer (loopback + localhost origin).
const fs = require('fs');
const path = require('path');
const net = require('net');
const cp = require('child_process');
const WebSocket = require('ws');
const pty = require('@lydell/node-pty');
const x = require('./exec');
const machines = require('./machines');

const SSH_EXE = fs.existsSync('C:\\Windows\\System32\\OpenSSH\\ssh.exe') ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh';
const psq = s => String(s).replace(/'/g, "''");
const rnd = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
const okOrigin = req => { const o = req.headers.origin; if (!o) return true; try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(o).hostname); } catch { return false; } };

module.exports = function register({ app, wrap, SSH_KEY, VM_DIR }) {
  const localOnly = (req, res, next) => isLocal(req) && okOrigin(req) ? next() : res.status(403).json({ ok: false, error: 'only from this computer' });

  // ── WSL: SSH server + user "elo" with the installer key (WSL has no SSH by default) ──
  async function wslIp() { return (await x.shLocal('hostname -I | awk \'{print $1}\'', 60)).trim().split(/\s+/)[0]; }
  async function ensureWslSsh() {
    const rec = machines.get('wsl') || {};
    const pw = rec.password || rnd();
    const pub = fs.readFileSync(SSH_KEY + '.pub', 'utf8').trim();
    const out = await x.shLocal(`set -e; export DEBIAN_FRONTEND=noninteractive; apt-get() { command apt-get -o DPkg::Lock::Timeout=600 "$@"; }
command -v sshd >/dev/null || { apt-get update -qq; apt-get install -y -qq openssh-server >/dev/null; }
id elo >/dev/null 2>&1 || useradd -m -s /bin/bash elo
echo 'elo:${pw}' | chpasswd; usermod -aG sudo elo; getent group docker >/dev/null && usermod -aG docker elo || true
echo 'elo ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/elo; chmod 440 /etc/sudoers.d/elo
install -d -m 700 -o elo -g elo /home/elo/.ssh; grep -qF '${pub}' /home/elo/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> /home/elo/.ssh/authorized_keys
chown elo:elo /home/elo/.ssh/authorized_keys; chmod 600 /home/elo/.ssh/authorized_keys
mkdir -p /run/sshd; (systemctl enable --now ssh >/dev/null 2>&1 || systemctl enable --now sshd >/dev/null 2>&1 || service ssh start >/dev/null 2>&1); sleep 1
echo "SSH_OK $(hostname -I | awk '{print $1}')"`, 300);
    if (!/SSH_OK/.test(out)) throw new Error('could not set up SSH in WSL: ' + out.trim().split('\n').pop());
    machines.save('wsl', { os: 'linux', user: 'elo', password: pw, sshPort: 22, label: `WSL ${x.getDistro() || ''}`.trim() });
    return { host: out.match(/SSH_OK (\S+)/)[1], port: 22, user: 'elo', password: pw };
  }

  // ── what to connect to, by id ──
  // wsl | hyperv:<vm> | vbox:<vm> | target (the current SSH target) | ctr:<scope>:<container> (scope: wsl | target)
  async function resolve(id) {
    id = String(id || '');
    const ctr = /^ctr:(wsl|target):([\w.-]+)$/.exec(id);
    if (ctr) { const m = await resolve(ctr[1]); return { ...m, container: ctr[2], label: `${m.label} › ${ctr[2]}` }; }
    if (id === 'wsl') {
      // SSH is set up once; afterwards the saved IP is reused while its port 22 answers (WSL's IP changes at restarts)
      const rec = machines.get('wsl'), ok = rec?.ip && await new Promise(r => { const s = net.connect({ host: rec.ip, port: 22, timeout: 1500 }).on('connect', () => { s.destroy(); r(true); }).on('error', () => r(false)).on('timeout', () => { s.destroy(); r(false); }); });
      let ip = ok ? rec.ip : null, pw = rec?.password;
      if (!ip) { const s = await ensureWslSsh(); ip = s.host; pw = s.password; machines.save('wsl', { ip }); }
      return { os: 'linux', label: `WSL ${x.getDistro() || ''}`.trim(), ssh: { host: ip, port: 22, user: 'elo', password: pw, key: SSH_KEY } };
    }
    if (id === 'target') {
      const t = x.getTarget(); if (!t) throw new Error('no SSH target is set');
      const rec = machines.get(`${t.kind}:${t.vm}`) || {};
      return { os: 'linux', label: t.vm || `${t.user}@${t.host}`, ssh: { host: t.host, port: t.port || 22, user: t.user, password: rec.password, key: t.key || SSH_KEY } };
    }
    const m = /^(hyperv|vbox):(.+)$/.exec(id); if (!m) throw new Error('unknown machine');
    const [, kind, name] = m;
    let rec = machines.get(id);
    if (!rec && kind === 'hyperv') {   // Windows VMs of this installer created before access data was stored: password from unattend.xml
      const f = path.join(VM_DIR, name, 'unattend.xml');
      if (fs.existsSync(f)) {
        const pw = fs.readFileSync(f, 'utf8').match(/<Value>([^<]*)<\/Value>/)?.[1];
        if (pw) { rec = { os: 'windows', user: 'Administrator', password: pw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') }; machines.save(id, rec); }
      }
    }
    if (!rec) throw new Error('no access data stored for this VM (only VMs created by this installer have it)');
    if (rec.os === 'windows') {
      const ip = (await x.ps(`@((Get-VMNetworkAdapter -VMName '${psq(name)}').IPAddresses | ?{ $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' })[0]`)).out.trim();
      return { os: 'windows', label: `${name} (${rec.label || 'Windows'})`, vm: name, user: rec.user, password: rec.password, ip, rdp: ip ? `${ip}:3389` : '',
        winSsh: ip ? { host: ip, port: 22, user: rec.user, key: SSH_KEY } : null,
        ssh: rec.wslUser && ip ? { host: ip, port: 22, user: rec.wslUser, password: rec.password, key: SSH_KEY, note: 'Ubuntu in WSL inside the VM' } : null };
    }
    if (kind === 'hyperv') {
      const ip = (await x.ps(`@((Get-VMNetworkAdapter -VMName '${psq(name)}').IPAddresses | ?{ $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' })[0]`)).out.trim();
      if (!ip) throw new Error(`the VM ${name} has no IP yet (is it running?)`);
      return { os: 'linux', label: `${name} (${rec.label || 'Linux'})`, ssh: { host: ip, port: 22, user: rec.user, password: rec.password, key: SSH_KEY } };
    }
    return { os: 'linux', label: `${name} (${rec.label || 'Linux'})`, ssh: { host: '127.0.0.1', port: rec.sshPort || 2222, user: rec.user, password: rec.password, key: SSH_KEY } };
  }

  const sshArgs = (s, extra = []) => ['-i', s.key || SSH_KEY, '-p', String(s.port || 22), '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', ...extra, `${s.user}@${s.host}`];
  const sshCommand = s => `ssh -i "${s.key || SSH_KEY}" -p ${s.port || 22} ${s.user}@${s.host}`;

  // Command (file, args, env) of the pseudo-terminal for a machine.
  function termCommand(m) {
    if (m.os === 'windows' && !m.container) {
      const script = `$c=New-Object PSCredential('${psq(m.user)}',(ConvertTo-SecureString $env:HVC_PW -AsPlainText -Force)); Enter-PSSession -VMName '${psq(m.vm)}' -Credential $c`;
      return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', script], env: { HVC_PW: m.password } };
    }
    const remote = m.container ? [`docker exec -it ${m.container} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`] : [];
    return { file: SSH_EXE, args: ['-tt', ...sshArgs(m.ssh), ...remote], env: {} };
  }

  // ── access data for the UI ──
  app.get('/api/access', localOnly, wrap(async req => {
    const id = req.query.id, m = await resolve(id);
    const out = { ok: true, id, label: m.label, os: m.os };
    if (m.ssh) out.ssh = { host: m.ssh.host, port: m.ssh.port, user: m.ssh.user, password: m.ssh.password || null, key: m.ssh.key, command: sshCommand(m.ssh), note: m.ssh.note || '' };
    if (m.os === 'windows') out.windows = { vm: m.vm, user: m.user, password: m.password, ip: m.ip, rdp: m.rdp,
      psDirect: `Enter-PSSession -VMName '${m.vm}' -Credential (Get-Credential ${m.user})`, mstsc: m.ip ? `mstsc /v:${m.ip}` : '' };
    if (m.ssh && !m.container) out.desktop = await desktopState(m).catch(() => ({ installed: false }));
    return out;
  }));

  // ── WebSocket terminal ──
  function attach(server) {
    const wss = new WebSocket.Server({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      if (!req.url.startsWith('/ws/terminal')) return;   // other upgrades are not served here
      if (!isLocal(req) || !okOrigin(req)) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    });
    wss.on('connection', async (ws, req) => {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      let term;
      try {
        const m = await resolve(id);
        // Windows VMs: PowerShell Direct is not a real terminal (interactive tools such as claude/codex fail with
        // "stdin is not a terminal"), so OpenSSH of Windows (real ConPTY) is used; PowerShell Direct only as fallback.
        let viaSsh = false;
        if (m.os === 'windows' && !m.container && m.winSsh) {
          ws.send('\x1b[90mPreparing OpenSSH in the VM (first time only, can take a few minutes)…\x1b[0m\r\n');
          try { await ensureWinSsh(m); viaSsh = true; } catch (e) { ws.send(`\x1b[33mOpenSSH is not available in the VM (${e.message}); using PowerShell Direct, which is not a full terminal.\x1b[0m\r\n`); }
        }
        const c = viaSsh ? { file: SSH_EXE, args: ['-tt', ...sshArgs(m.winSsh)], env: {} } : termCommand(m);
        ws.send(`\x1b[90m${m.os === 'windows' && !m.container && !viaSsh ? 'PowerShell Direct' : 'ssh'} → ${m.label}\x1b[0m\r\n`);
        term = pty.spawn(c.file, c.args, { name: 'xterm-256color', cols: 120, rows: 32, env: { ...process.env, ...c.env } });
      } catch (e) { ws.send(`\x1b[31m${e.message}\x1b[0m\r\n`); ws.close(); return; }
      term.onData(d => ws.readyState === 1 && ws.send(d));
      term.onExit(() => { try { ws.send('\r\n\x1b[90m[session closed]\x1b[0m\r\n'); ws.close(); } catch {} });
      ws.on('message', raw => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'input') term.write(msg.data); else if (msg.type === 'resize') try { term.resize(Math.max(2, msg.cols | 0), Math.max(2, msg.rows | 0)); } catch {}
      });
      ws.on('close', () => { try { term.kill(); } catch {} });
    });
  }

  // ── X desktop (Xfce / LXQt / GNOME + Firefox) with VNC + noVNC, reached through an SSH tunnel ──
  // Streams the output of a script run by SSH on the machine (sudo) into a job log.
  function runScript(m, script, log) {
    return new Promise((resolveP, reject) => {
      const p = cp.spawn(SSH_EXE, [...sshArgs(m.ssh), 'sudo -n bash -s'], { windowsHide: true });
      p.stdin.end(script.replace(/\r/g, ''));
      const feed = d => String(d).split('\n').forEach(l => l.trim() && log(l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')));
      p.stdout.on('data', feed); p.stderr.on('data', feed);
      p.on('error', reject); p.on('close', code => code === 0 ? resolveP() : reject(new Error(`exit code ${code}`)));
    });
  }
  const DESKTOPS = {
    xfce: { label: 'Xfce', session: 'startxfce4', apt: 'xfce4 xfce4-terminal xfce4-goodies dbus-x11' },
    lxqt: { label: 'LXQt (light)', session: 'startlxqt', apt: 'lxqt qterminal dbus-x11' },
    gnome: { label: 'GNOME', session: 'gnome-session', apt: 'ubuntu-desktop-minimal dbus-x11', debApt: 'gnome-core dbus-x11' },
  };
  const desktopScript = (key, browser, user) => {
    const d = DESKTOPS[key];
    return `set -e; export DEBIAN_FRONTEND=noninteractive; . /etc/os-release; apt-get() { command apt-get -o DPkg::Lock::Timeout=600 "$@"; }
echo "__STEP__ Installing ${d.label} desktop (download of several hundred MB)"
apt-get update -qq
PK="${d.apt}"; [ "$ID" = debian ] && PK="${d.debApt || d.apt}"
apt-get install -y -qq $PK tigervnc-standalone-server tigervnc-common novnc websockify x11-xserver-utils xauth fonts-dejavu >/dev/null
${browser ? `echo "__STEP__ Installing Firefox"
if [ "$ID" = ubuntu ]; then
  apt-get install -y -qq software-properties-common >/dev/null; add-apt-repository -y ppa:mozillateam/ppa >/dev/null
  printf 'Package: *\\nPin: release o=LP-PPA-mozillateam\\nPin-Priority: 1001\\n' > /etc/apt/preferences.d/mozilla-firefox   # the deb build, not the snap
  apt-get update -qq; apt-get install -y -qq firefox >/dev/null
else apt-get install -y -qq firefox-esr >/dev/null; fi` : ''}
echo "__STEP__ Configuring the VNC desktop session and the services"
U=${user}; H=$(getent passwd $U | cut -d: -f6); install -d -o $U -g $U $H/.vnc
XS=$(command -v Xtigervnc || command -v Xvnc)
# Xtigervnc is started directly (the tigervncserver wrapper needs a writable /tmp/.X11-unix, which WSL does not have); access to
# display :1 is limited to the user by an X cookie, the VNC port listens on localhost only.
cat > /etc/systemd/system/elo-vnc.service <<UNIT
[Unit]
Description=ELO desktop X/VNC server (display :1, localhost only)
After=network.target
[Service]
User=$U
Environment=HOME=$H
ExecStartPre=/bin/sh -c 'rm -f $H/.vnc/xauth /tmp/.X1-lock; xauth -f $H/.vnc/xauth add :1 . \\$\\$(mcookie)'
ExecStart=$XS :1 -auth $H/.vnc/xauth -rfbport 5901 -localhost yes -geometry 1600x900 -depth 24 -SecurityTypes None -AlwaysShared -nolisten tcp
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/elo-desktop.service <<UNIT
[Unit]
Description=ELO desktop session (${d.label})
After=elo-vnc.service
Requires=elo-vnc.service
[Service]
User=$U
Environment=HOME=$H DISPLAY=:1 XAUTHORITY=$H/.vnc/xauth XDG_SESSION_TYPE=x11
ExecStartPre=/bin/sleep 3
ExecStart=/usr/bin/dbus-launch --exit-with-session ${d.session}
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/elo-novnc.service <<UNIT
[Unit]
Description=ELO desktop noVNC (6080 -> VNC 5901)
After=elo-vnc.service
[Service]
ExecStart=$(command -v websockify) --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5901
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload; systemctl enable elo-vnc.service elo-desktop.service elo-novnc.service >/dev/null 2>&1
systemctl restart elo-vnc.service elo-desktop.service elo-novnc.service
for i in $(seq 1 20); do ss -ltn | grep -q ':6080 ' && ss -ltn | grep -q ':5901 ' && break; sleep 2; done
ss -ltn | grep -E ':(6080|5901) ' || { echo "ERROR: the desktop services did not start"; journalctl -u elo-vnc -n 15 --no-pager; exit 1; }
sleep 4; systemctl is-active elo-desktop.service >/dev/null || { echo "ERROR: the desktop session did not start"; journalctl -u elo-desktop -n 15 --no-pager; exit 1; }
echo "__STEP__ Desktop ready: ${d.label}"`;
  };
  async function desktopState(m) {
    const out = await x.shOn(m.ssh, `test -f /etc/systemd/system/elo-vnc.service && echo yes || echo no; systemctl is-active elo-vnc.service elo-desktop.service elo-novnc.service 2>/dev/null | tr '\\n' ' '; echo; grep -o 'start[a-z0-9-]*\\|gnome-session' /etc/systemd/system/elo-desktop.service 2>/dev/null | head -1`, 30);
    const lines = out.trim().split('\n');
    return { installed: lines[0] === 'yes', running: /^(actives*){3}$/.test(lines[1] || ''), session: lines[2] || '' };
  }
  app.post('/api/desktop/install', localOnly, wrap(async req => {
    const { id, desktop = 'xfce', browser = true } = req.body || {};
    if (!DESKTOPS[desktop]) throw new Error('unknown desktop');
    const m = await resolve(id); if (!m.ssh || m.container) throw new Error('desktops can be installed in Linux machines');
    if (!/^[a-z_][a-z0-9_-]*$/.test(m.ssh.user)) throw new Error('bad user');
    return x.nodeJob('desktop', log => runScript(m, desktopScript(desktop, browser, m.ssh.user), log));
  }));
  // SSH tunnels (127.0.0.1:<local> → machine:6080 noVNC and :5901 VNC); kept until closed or the installer stops.
  const tunnels = new Map();
  const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const waitPort = async (p, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await new Promise(r => { const c = net.connect(p, '127.0.0.1').on('connect', () => { c.destroy(); r(true); }).on('error', () => r(false)); })) return true; await new Promise(r => setTimeout(r, 400)); } return false; };
  app.post('/api/desktop/open', localOnly, wrap(async req => {
    const id = req.body?.id, m = await resolve(id); if (!m.ssh || m.container) throw new Error('not a Linux machine');
    await x.shOn(m.ssh, 'systemctl start elo-vnc.service elo-desktop.service elo-novnc.service', 90);
    let t = tunnels.get(id);
    if (!t || t.proc.exitCode !== null) {
      const web = await freePort(), vnc = await freePort();
      const proc = cp.spawn(SSH_EXE, ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${web}:127.0.0.1:6080`, '-L', `127.0.0.1:${vnc}:127.0.0.1:5901`, ...sshArgs(m.ssh)], { windowsHide: true, stdio: 'ignore' });
      t = { proc, web, vnc }; tunnels.set(id, t);
      if (!(await waitPort(web))) { proc.kill(); tunnels.delete(id); throw new Error('the SSH tunnel did not come up (is the desktop installed?)'); }
    }
    return { ok: true, url: `http://127.0.0.1:${t.web}/vnc.html?autoconnect=true&resize=scale`, vnc: `127.0.0.1:${t.vnc}`, tunnel: `ssh -L ${t.web}:127.0.0.1:6080 -L ${t.vnc}:127.0.0.1:5901 ${m.ssh.user}@${m.ssh.host}` };
  }));
  app.post('/api/desktop/close', localOnly, wrap(async req => { const t = tunnels.get(req.body?.id); if (t) { t.proc.kill(); tunnels.delete(req.body.id); } return { ok: true }; }));
  process.on('exit', () => tunnels.forEach(t => { try { t.proc.kill(); } catch {} }));

  // ── Service tunnels: every ELO port of a machine through one ssh -L, on free local ports (the same number when it is free) ──
  const svcTunnels = new Map();
  const portFree = p => new Promise(r => { const s = net.createServer().once('error', () => r(false)).listen(p, '127.0.0.1', () => s.close(() => r(true))); });
  const pickPort = async (want, used) => { for (let p = want; p < want + 300 && p < 65536; p++) if (!used.has(p) && await portFree(p)) return p; return freePort(); };
  const aliveTunnel = id => { const t = svcTunnels.get(id); return t && t.proc.exitCode === null ? t : null; };
  app.post('/api/tunnel/open', localOnly, wrap(async req => {
    const { id, ports } = req.body || {}, m = await resolve(id);
    // Windows VMs: through their OpenSSH (set up on the way, like for the terminal).
    if (!m.ssh && m.os === 'windows' && m.winSsh) { await ensureWinSsh(m); m.ssh = m.winSsh; }
    if (!m.ssh || m.container) throw new Error('a tunnel needs a machine reachable by SSH');
    const old = aliveTunnel(id); if (old) return { ok: true, map: old.map };
    const list = [...new Set((ports || []).map(Number).filter(p => p > 0 && p < 65536))];
    if (!list.length) throw new Error('no ports');
    const used = new Set(), map = {}, args = ['-N', '-o', 'ExitOnForwardFailure=yes'];
    for (const p of list) { const l = await pickPort(p, used); used.add(l); map[p] = l; args.push('-L', `127.0.0.1:${l}:127.0.0.1:${p}`); }
    const proc = cp.spawn(SSH_EXE, [...args, ...sshArgs(m.ssh)], { windowsHide: true, stdio: 'ignore' });
    svcTunnels.set(id, { proc, map });
    if (!(await waitPort(map[list[0]]))) { proc.kill(); svcTunnels.delete(id); throw new Error('the SSH tunnel did not come up'); }
    return { ok: true, map };
  }));
  app.post('/api/tunnel/close', localOnly, wrap(async req => { const t = svcTunnels.get(req.body?.id); if (t) { t.proc.kill(); svcTunnels.delete(req.body.id); } return { ok: true }; }));
  app.get('/api/tunnel/list', localOnly, wrap(async () => ({ ok: true, tunnels: Object.fromEntries([...svcTunnels].filter(([, t]) => t.proc.exitCode === null).map(([id, t]) => [id, t.map])) })));
  process.on('exit', () => svcTunnels.forEach(t => { try { t.proc.kill(); } catch {} }));
  // Which ports of host answer from this computer (a TCP connect, 2 s).
  app.post('/api/reach', localOnly, wrap(async req => {
    const { host, ports } = req.body || {};
    if (!/^[\w.:-]+$/.test(host || '')) throw new Error('bad host');
    const res = {};
    await Promise.all((ports || []).map(p => new Promise(r => { const c = net.connect({ host, port: Number(p), timeout: 2000 }); c.on('connect', () => { res[p] = true; c.destroy(); r(); }); c.on('error', () => { res[p] = false; r(); }); c.on('timeout', () => { res[p] = false; c.destroy(); r(); }); })));
    return { ok: true, reach: res };
  }));

  // ── OpenSSH inside a Windows VM (through PowerShell Direct), so the terminal is a real one ──
  const winCred = m => `$c=New-Object PSCredential('${psq(m.user)}',(ConvertTo-SecureString '${psq(m.password)}' -AsPlainText -Force))`;
  // PowerShell Direct breaks when several sessions open at once on the same VM: calls to one VM run one after another.
  const vmQueue = new Map();
  const vmLock = (name, fn) => { const run = (vmQueue.get(name) || Promise.resolve()).catch(() => {}).then(fn); vmQueue.set(name, run); return run; };
  const inWinVm = (m, body, ms = 120000, args = '') => vmLock(m.vm, () => x.ps(`${winCred(m)}; Invoke-Command -VMName '${psq(m.vm)}' -Credential $c ${args} -ScriptBlock { ${body} }`, ms));
  // Readable error of a failed remote PowerShell: the exception message, not the trailing "PSComputerName" line.
  const psErr = r => {
    const s = ((r.err || '') + '\n' + (r.out || '')).replace(/\r/g, '');
    const lines = s.split('\n').map(l => l.trim()).filter(l => l && !/^\+/.test(l) && !/^(CategoryInfo|FullyQualifiedErrorId|PSComputerName)\b/.test(l));
    return lines.slice(0, 3).join(' ').slice(0, 300) || s.trim().slice(0, 300) || 'failed';
  };
  const winSshOk = new Set();
  async function ensureWinSsh(m) {
    if (winSshOk.has(m.vm)) return;
    const pub = fs.readFileSync(SSH_KEY + '.pub', 'utf8').trim();
    const r = await inWinVm(m, `param($pub); $ErrorActionPreference='Stop'
if(-not (Get-Service sshd -EA SilentlyContinue)){ Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null }
New-ItemProperty -Path HKLM:\\SOFTWARE\\OpenSSH -Name DefaultShell -Value "$env:SystemRoot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -PropertyType String -Force | Out-Null
Set-Service sshd -StartupType Automatic
$f="$env:ProgramData\\ssh\\administrators_authorized_keys"
if(-not (Test-Path $f) -or -not (Select-String -Path $f -SimpleMatch -Pattern $pub -Quiet)){ Add-Content -Path $f -Value $pub -Encoding ascii }
icacls $f /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F' | Out-Null
$u="$env:USERPROFILE\\.ssh"; New-Item -ItemType Directory -Force $u | Out-Null; $uf="$u\\authorized_keys"
if(-not (Test-Path $uf) -or -not (Select-String -Path $uf -SimpleMatch -Pattern $pub -Quiet)){ Add-Content -Path $uf -Value $pub -Encoding ascii }
if(-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -EA SilentlyContinue)){ New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null }
Restart-Service sshd; 'SSH_READY'`, 1800000, `-ArgumentList '${psq(pub)}'`);
    if (!/SSH_READY/.test(r.out)) throw new Error(psErr(r));
    winSshOk.add(m.vm);
  }

  // ── RDP: .rdp file, open in the system's mstsc with the stored credentials, enable RDP in the VM ──
  const rdpOf = async id => { const m = await resolve(id); if (m.os !== 'windows') throw new Error('RDP is for Windows machines'); if (!m.ip) throw new Error('the VM has no IP yet (is it running?)'); return m; };
  app.get('/api/rdp/file', localOnly, async (req, res) => {
    try {
      const m = await rdpOf(req.query.id);
      res.set({ 'Content-Type': 'application/x-rdp', 'Content-Disposition': `attachment; filename="${String(m.vm).replace(/[^\w.-]/g, '_')}.rdp"` });
      res.send(['full address:s:' + m.ip + ':3389', 'username:s:' + m.user, 'prompt for credentials:i:0', 'authentication level:i:2', 'screen mode id:i:2', 'desktopwidth:i:1600', 'desktopheight:i:900', 'session bpp:i:32', 'redirectclipboard:i:1', 'compression:i:1', ''].join('\r\n'));
    } catch (e) { res.status(400).send(e.message); }
  });
  app.post('/api/rdp/open', localOnly, wrap(async req => {
    const m = await rdpOf(req.body?.id);
    // The credentials go to the Windows Credential Manager of the signed-in user, so mstsc connects without asking.
    const cmd = `& cmdkey.exe '/generic:TERMSRV/${psq(m.ip)}' '/user:${psq(m.user)}' '/pass:${psq(m.password)}' | Out-Null; Start-Process mstsc.exe -ArgumentList '/v:${psq(m.ip)}'`;
    await x.detect();
    if (x.getMode() === 'wsl-user') await x.getSeatLib().runAsUser(cmd, 60); else await x.ps(cmd);
    return { ok: true, opened: m.ip };
  }));
  app.post('/api/rdp/enable', localOnly, wrap(async req => {
    const m = await resolve(req.body?.id); if (m.os !== 'windows') throw new Error('RDP is for Windows machines');
    const r = await inWinVm(m, `$ErrorActionPreference='Stop'; Set-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' fDenyTSConnections 0
netsh advfirewall firewall set rule group="@FirewallAPI.dll,-28752" new enable=Yes | Out-Null; Set-Service TermService -StartupType Automatic; Start-Service TermService -EA SilentlyContinue; 'RDP_ON'`, 120000);
    if (!/RDP_ON/.test(r.out)) throw new Error(psErr(r));
    return { ok: true };
  }));

  // ── System of a machine: OS, license, hypervisor, installed databases (PostgreSQL / SQL Server) ──
  const tcpOpen = (host, port) => new Promise(r => { const c = net.connect({ host, port, timeout: 2000 }); c.on('connect', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); c.on('timeout', () => { c.destroy(); r(false); }); });
  const LIC = ['Unlicensed', 'Licensed', 'Initial grace period', 'Additional grace period', 'Non-genuine grace period', 'Notification', 'Extended grace period'];
  const LINUX_INFO = `. /etc/os-release 2>/dev/null; echo "__OS__ $PRETTY_NAME"; echo "__VER__ $VERSION_ID"; echo "__KERNEL__ $(uname -r) $(uname -m)"; echo "__HOST__ $(hostname)"; echo "__VIRT__ $(systemd-detect-virt 2>/dev/null)"
systemctl list-units --type=service --all --no-legend 2>/dev/null | awk '{print $1" "$3}' | grep -iE '^(postgres|mssql|mysql|mariadb|docker)' | sed 's/^/__SVC__ /'
echo "__LISTEN__ $(ss -ltn 2>/dev/null | awk 'NR>1{n=split($4,a,":"); print a[n]}' | sort -un | tr '\\n' ' ')"`;
  function dbFrom(services, listen) {
    const find = re => services.find(s => re.test(s.name) || re.test(s.display || ''));
    const pg = find(/postgres/i), ms = find(/^MSSQL|^mssql-server|SQL Server \(/i);
    const mk = (s, port) => ({ installed: !!s || listen.includes(port), running: s ? /^(running|active)$/i.test(s.status) : listen.includes(port), service: s?.display || s?.name || '', port });
    return { postgres: mk(pg, 5432), mssql: mk(ms, 1433) };
  }
  app.get('/api/machine/sysinfo', localOnly, wrap(async req => {
    const id = String(req.query.id || ''), out = { ok: true, id };
    out.virt = /^hyperv:/.test(id) ? 'Hyper-V' : /^vbox:/.test(id) ? 'VirtualBox' : '';
    const m = await resolve(id);
    out.address = m.ip || m.ssh?.host || '';
    if (m.os === 'windows') {
      const r = await inWinVm(m, `$o=Get-CimInstance Win32_OperatingSystem; $cs=Get-CimInstance Win32_ComputerSystem
$lic=Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationId='55c92734-d682-4d71-983e-d6ec3f16059f' AND PartialProductKey IS NOT NULL" | Select-Object -First 1
$svc=@(Get-Service | ?{ $_.Name -match '^(postgresql|MSSQL)' -or $_.DisplayName -match 'PostgreSQL|SQL Server \\(' } | %{ [pscustomobject]@{ name=$_.Name; display=$_.DisplayName; status="$($_.Status)" } })
$listen=@(Get-NetTCPConnection -State Listen -EA SilentlyContinue | %{ [int]$_.LocalPort } | Sort-Object -Unique)
[pscustomobject]@{ host=$cs.Name; os=$o.Caption; version=$o.Version; build=$o.BuildNumber; arch=$o.OSArchitecture; model=$cs.Model; installed=$o.InstallDate.ToString('yyyy-MM-dd'); lang=($o.MUILanguages -join ','); licName=$lic.Name; licStatus=$lic.LicenseStatus; services=$svc; listen=$listen } | ConvertTo-Json -Compress -Depth 5`, 90000);
      const j = r.out.split('\n').map(s => s.trim()).filter(s => s.startsWith('{')).pop();
      if (!j) throw new Error(psErr(r));
      const d = JSON.parse(j), svcs = [].concat(d.services || []), listen = [].concat(d.listen || []);
      if (!out.virt) out.virt = /virtual machine/i.test(d.model || '') ? 'Hyper-V' : /virtualbox/i.test(d.model || '') ? 'VirtualBox' : '';
      Object.assign(out, { host: d.host, os: { name: d.os, version: d.version, build: d.build, arch: d.arch, installed: d.installed, lang: d.lang }, license: { status: LIC[d.licStatus] ?? (d.licStatus == null ? 'unknown' : String(d.licStatus)), ok: d.licStatus === 1, name: d.licName || '' }, listen, db: dbFrom(svcs.map(s => ({ ...s })), listen) });
    } else if (m.ssh) {
      const t = await x.shOn(m.ssh, LINUX_INFO, 40), g = k => (new RegExp('__' + k + '__ (.*)').exec(t) || [])[1]?.trim() || '';
      const svcs = [...t.matchAll(/__SVC__ (\S+) (\S+)/g)].map(s => ({ name: s[1], display: s[1], status: s[2] })), listen = g('LISTEN').split(/\s+/).filter(Boolean).map(Number);
      Object.assign(out, { host: g('HOST'), os: { name: g('OS'), version: g('VER'), kernel: g('KERNEL') }, listen, services: svcs, db: dbFrom(svcs, listen) });
      if (!out.virt && g('VIRT') && g('VIRT') !== 'none') out.virt = g('VIRT');
    }
    // can this computer reach the database ports of the machine?
    if (out.db && out.address) await Promise.all(Object.values(out.db).filter(d => d.installed).map(async d => { d.reachable = await tcpOpen(out.address, d.port); }));
    return out;
  }));
  // Local database clients: pgAdmin 4 (preloaded with the server, password from a pgpass file) / SQL Server tools.
  const PGA = 'C:\\Program Files\\pgAdmin 4';
  const SSMS = () => { for (const d of ['C:\\Program Files (x86)\\Microsoft SQL Server Management Studio 20', 'C:\\Program Files (x86)\\Microsoft SQL Server Management Studio 19', 'C:\\Program Files (x86)\\Microsoft SQL Server Management Studio 18', 'C:\\Program Files\\Microsoft SQL Server Management Studio 21']) { const f = path.join(d, 'Common7\\IDE\\Ssms.exe'); if (fs.existsSync(f)) return f; }
    const ads = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs\\Azure Data Studio\\azuredatastudio.exe'); return ads && fs.existsSync(ads) ? ads : ''; };
  app.get('/api/db/clients', localOnly, wrap(async () => ({ ok: true, pgadmin: x.IS_WIN && fs.existsSync(path.join(PGA, 'runtime\\pgAdmin4.exe')), mssql: x.IS_WIN ? SSMS() : '' })));
  app.post('/api/db/pgadmin', localOnly, wrap(async req => {
    const { name, host, port = 5432, user = 'elodb', password = 'elodb', db = 'postgres' } = req.body || {};
    if (!/^[\w.:-]+$/.test(host || '')) throw new Error('bad host');
    const exe = path.join(PGA, 'runtime\\pgAdmin4.exe'), py = path.join(PGA, 'python\\python.exe'), setup = path.join(PGA, 'web\\setup.py');
    if (!x.IS_WIN || !fs.existsSync(exe)) throw new Error('pgAdmin 4 is not installed on this computer (winget install PostgreSQL.pgAdmin)');
    const pass = path.join(x.RUN_DIR, 'elo-pgpass.conf');   // pgAdmin reads the password from here (PassFile)
    fs.writeFileSync(pass, `${host}:${port}:*:${user}:${password}\n`);
    const js = path.join(x.RUN_DIR, `elo-pgadmin-${Date.now().toString(36)}.json`);
    fs.writeFileSync(js, JSON.stringify({ Servers: { 1: { Name: name || `ELO ${host}`, Group: 'ELO', Host: host, Port: +port, MaintenanceDB: db, Username: user, SSLMode: 'prefer', PassFile: pass } } }));
    const r = await x.run(py, [setup, 'load-servers', js], { env: { Path: `${path.join(PGA, 'runtime')};${process.env.Path || process.env.PATH}` }, timeoutMs: 90000 });
    try { fs.unlinkSync(js); } catch {}
    if (!/Added \d+ Server|Servers? added|Loaded/i.test(r.out + r.err) && r.code !== 0) throw new Error('could not preload the server in pgAdmin: ' + (r.err || r.out).trim().split('\n').pop());
    const cmd = `Start-Process '${psq(exe)}'`;
    await x.detect();
    if (x.getMode() === 'wsl-user') await x.getSeatLib().runAsUser(cmd, 60); else await x.ps(cmd);
    return { ok: true, note: 'pgAdmin 4' };
  }));
  app.post('/api/db/mssql', localOnly, wrap(async req => {
    const { host, port = 1433, user = 'elodb' } = req.body || {};
    if (!/^[\w.:-]+$/.test(host || '')) throw new Error('bad host');
    const exe = x.IS_WIN ? SSMS() : '';
    if (!exe) throw new Error('No SQL Server client on this computer. Install one: winget install Microsoft.SQLServerManagementStudio (or Azure Data Studio). Connection: ' + `${host},${port} · ${user}`);
    const args = /azuredatastudio/i.test(exe) ? '' : `-S '${psq(host + ',' + port)}' -U '${psq(user)}'`;
    const cmd = `Start-Process '${psq(exe)}'${args ? ` -ArgumentList "${args.replace(/"/g, '`"')}"` : ''}`;
    await x.detect();
    if (x.getMode() === 'wsl-user') await x.getSeatLib().runAsUser(cmd, 60); else await x.ps(cmd);
    return { ok: true, note: path.basename(exe) };
  }));

  // ── Resources of a machine: RAM, disks, CPU (VM side from Hyper-V, guest side from inside the machine) ──
  const STATS_SH = `echo "__MEM__ $(free -m | awk '/^Mem:/{print $2" "$7}')"
echo "__CPU__ $(top -bn2 -d0.4 2>/dev/null | grep -i '^%\\?cpu' | tail -1)"
df -P -BM 2>/dev/null | awk 'NR>1 && $1 ~ /^\\/dev\\// && $6 !~ /^\\/(mnt\\/wsl|usr\\/lib\\/wsl)/ && !s[$1]++ {print "__DISK__ "$6" "$2" "$4}'
echo "__UP__ $(cut -d. -f1 /proc/uptime)"`;
  function parseLinuxStats(out) {
    const g = { disks: [] }; let m;
    if ((m = /__MEM__ (\d+) (\d+)/.exec(out))) { g.ramTotalMB = +m[1]; g.ramFreeMB = +m[2]; }
    if ((m = /__CPU__ .*?(\d+[.,]?\d*)\s*(?:%?\s*)id/i.exec(out))) g.cpu = Math.round(100 - parseFloat(m[1].replace(',', '.')));
    for (const d of out.matchAll(/__DISK__ (\S+) (\d+)M (\d+)M/g)) g.disks.push({ name: d[1], totalGB: +(d[2] / 1024).toFixed(1), freeGB: +(d[3] / 1024).toFixed(1) });
    if ((m = /__UP__ (\d+)/.exec(out))) g.uptime = +m[1];
    return g;
  }
  app.get('/api/machine/stats', localOnly, wrap(async req => {
    const id = String(req.query.id || ''), res = { ok: true, id };
    if (/^local:/.test(id) || id === 'local' || id === 'desktop') { res.guest = parseLinuxStats(await x.sh(STATS_SH, 60)); return res; }
    const hv = /^hyperv:(.+)$/.exec(id);
    const tasks = [];
    if (hv) tasks.push(x.ps(`try { $v=Get-VM -Name '${psq(hv[1])}' -EA Stop; $d=@(Get-VMHardDiskDrive -VM $v | ?{ $_.Path -and (Test-Path $_.Path) } | %{ Get-VHD $_.Path -EA SilentlyContinue }); $sz=($d | Measure-Object Size -Sum).Sum; $fs=($d | Measure-Object FileSize -Sum).Sum
"$($v.State)|$($v.ProcessorCount)|$($v.CPUUsage)|$([int]($v.MemoryAssigned/1MB))|$([int]($v.MemoryDemand/1MB))|$([int]($v.MemoryStartup/1MB))|$([int]$v.Uptime.TotalSeconds)|$sz|$fs" } catch { 'ERR|' + $_.Exception.Message }`, 60000).then(r => {
      const p = r.out.trim().split('\n').pop().split('|');
      if (p[0] === 'ERR') { res.vmError = p[1]; return; }
      res.vm = { state: p[0], vcpus: +p[1], cpu: +p[2], assignedMB: +p[3], demandMB: +p[4], startupMB: +p[5], uptime: +p[6], diskGB: p[7] ? +(p[7] / 1073741824).toFixed(1) : null, diskFileGB: p[8] ? +(p[8] / 1073741824).toFixed(1) : null };
    }));
    tasks.push((async () => {
      const m = await resolve(id).catch(e => { res.guestError = e.message; return null; }); if (!m) return;
      try {
        if (m.os === 'windows') {
          const r = await inWinVm(m, `$o=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{ ramTotalMB=[int]($o.TotalVisibleMemorySize/1024); ramFreeMB=[int]($o.FreePhysicalMemory/1024); cpu=[int](Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average; uptime=[int]((Get-Date)-$o.LastBootUpTime).TotalSeconds; disks=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | %{ [pscustomobject]@{ name=$_.DeviceID; totalGB=[math]::Round($_.Size/1GB,1); freeGB=[math]::Round($_.FreeSpace/1GB,1) } }) } | ConvertTo-Json -Compress -Depth 4`, 60000);
          const j = r.out.split('\n').map(s => s.trim()).filter(s => s.startsWith('{')).pop();
          if (!j) throw new Error(psErr(r));
          res.guest = JSON.parse(j);
        } else if (m.ssh) res.guest = parseLinuxStats(await x.shOn(m.ssh, STATS_SH, 40));
      } catch (e) { res.guestError = e.message; }
    })());
    await Promise.all(tasks);
    return res;
  }));

  // Bash script as root in the WSL of a Windows VM, over the VM's OpenSSH (set up the first time its terminal is opened).
  const winWslSh = (m, script, ms = 40000) => x.run(SSH_EXE, [...sshArgs(m.winSsh, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5']), 'wsl.exe -u root -- bash -s'], { input: script.replace(/\r/g, ''), timeoutMs: ms }).then(r => r.out);
  return { attach, resolve, DESKTOPS, localOnly, winCred, inWinVm, winWslSh, vmLock };
};
