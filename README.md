# elo-stack-installer

🇪🇸 [Leer en español](README.es.md)

> **Unofficial** tool, independent of ELO Digital Office GmbH. "ELO" is a trademark of its owner.

A web wizard that **installs ELO on Docker (the main target), Hyper-V, VirtualBox and WSL**. It creates and runs working
ELO environments from the official ELO container images: it checks the requirements, lists the available images, asks for
credentials and license, installs, tests and exposes the services. It can also put ELO's web apps on the desktop and in the
browsers of the machines it manages.

> ELO's images live in a private registry and need an ELO **partner/customer account**.
> This project contains no images, credentials or licenses (`.env`, `*.pk`, `*.txt`, `*.lic` are in `.gitignore`).

**Start:** `installer\start-installer.bat` (Windows, asks for administrator rights) or `installer/start-installer.sh`
(Linux). The first run does `npm install`. UI at http://localhost:3200. Needs Node.js 18+.

## Where the images are

| Resource | URL |
|---|---|
| Registry (Harbor) | https://registry.elo.com → **Login via OIDC provider** → project **`eck-services`** |
| Docker documentation (ELO 25 LTS) | https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/ |
| ELO Cloud on Kubernetes documentation | https://docs.elo.com/ops/eck/en-us/getting-started/ |
| Generated full list | [elo-docker-list.md](elo-docker-list.md) |

- **Login for `docker pull`:** registry user + **CLI secret** (user profile at https://registry.elo.com), not the password:
  `docker login registry.elo.com -u <user> --password-stdin`.
- **Platform:** all images are **`linux/amd64`**. There are **no Windows images**: on Windows they run with **WSL2 + Docker**
  (Docker Engine inside the distro, or Docker Desktop), which is what ELO recommends for tests. A native install on Windows
  Server is still the *ELO Server Setup*, not containers.
- **Base:** current ELO 25 images use **Wolfi OS** with OpenJDK 25 (OpenJ9) and Tomcat 11; older ones use Debian slim.

## Available images

<!-- images:start -->
_Updated 2026-10-29 from https://registry.elo.com — full details per image in [elo-docker-list.md](elo-docker-list.md)._

| Image | ELO lines | Latest stable ELO 25 | Latest tag | Size | Updated | Pulls | Base | Links |
|---|---|---|---|---|---|---|---|---|
| [`ix-import`](elo-docker-list.md#ix-import) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 241 MB | 2026-10-16 | 13237 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ix-import/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix-import.html) |
| [`search`](elo-docker-list.md#search) | 25, 23, 21, 20 | `v25-1.0` | `v25-1.0` | 1.08 GB | 2026-10-16 | 12629 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/search/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-search.html) |
| [`server`](elo-docker-list.md#server) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 1.15 GB | 2026-10-16 | 12294 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/server/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-server.html) |
| [`ix-setup`](elo-docker-list.md#ix-setup) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 1.05 GB | 2026-10-16 | 11895 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ix-setup/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix-setup.html) |
| [`flows-worker`](elo-docker-list.md#flows-worker) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 354 MB | 2026-10-16 | 10792 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-worker/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-flows-worker.html) |
| [`flows`](elo-docker-list.md#flows) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 341 MB | 2026-10-16 | 10728 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-flows.html) |
| [`as`](elo-docker-list.md#as) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 528 MB | 2026-10-16 | 9909 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/as/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-as.html) |
| [`tr2`](elo-docker-list.md#tr2) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 1.94 GB | 2026-10-16 | 6849 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/tr2/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-tr2.html) |
| [`ix`](elo-docker-list.md#ix) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 995 MB | 2026-10-16 | 3448 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ix/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ix.html) |
| [`postgresql`](elo-docker-list.md#postgresql) | — | — | `nightly` | 91 MB | 2021-10-14 | 3426 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/postgresql/artifacts-tab) |
| [`ui`](elo-docker-list.md#ui) | 25, 23, 21, 20 | `v25-0.30.1` | `v25-1.0.0-beta` | 375 MB | 2026-10-16 | 3393 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/ui/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-ui.html) |
| [`busybox`](elo-docker-list.md#busybox) | — | — | `1.32.0` | 1 MB | 2021-07-12 | 1572 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/busybox/artifacts-tab) |
| [`rest`](elo-docker-list.md#rest) | 23, 21, 20 | — | `v23-0.30` | 230 MB | 2026-09-22 | 1486 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/rest/artifacts-tab) |
| [`cv`](elo-docker-list.md#cv) | 21, 20 | — | `v20-0.3` | 381 MB | 2024-04-12 | 1311 | debian:12.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/cv/artifacts-tab) |
| [`sl`](elo-docker-list.md#sl) | 25, 23, 21 | `v25-0.30.1` | `v25-1.0.0-beta` | 256 MB | 2026-10-16 | 903 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/sl/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-sl.html) |
| [`traefik`](elo-docker-list.md#traefik) | 2 | — | `v2.10.0` | 41 MB | 2024-01-19 | 823 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/traefik/artifacts-tab) |
| [`ocr-setup`](elo-docker-list.md#ocr-setup) | 21, 20 | — | `v20-0.3` | 231 MB | 2024-04-12 | 643 | debian:12.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/ocr-setup/artifacts-tab) |
| [`ocr`](elo-docker-list.md#ocr) | 21, 20 | — | `v20-0.3` | 847 MB | 2024-04-12 | 619 | debian:12.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/ocr/artifacts-tab) |
| [`flows-registry`](elo-docker-list.md#flows-registry) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 253 MB | 2026-10-16 | 578 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-registry/artifacts-tab) |
| [`flows-worker-base`](elo-docker-list.md#flows-worker-base) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 273 MB | 2026-10-16 | 457 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/flows-worker-base/artifacts-tab) |
| [`cmis`](elo-docker-list.md#cmis) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 252 MB | 2026-10-16 | 376 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/cmis/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-cmis.html) |
| [`elo-sync`](elo-docker-list.md#elo-sync) | 25, 23 | `v25-0.30.1` | `v25-1.0.0-beta` | 236 MB | 2026-10-16 | 155 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/elo-sync/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/cloud-elo-sync.html) |
| [`model-processor`](elo-docker-list.md#model-processor) | 25 | — | `v25-1.0.0-beta` | 253 MB | 2026-10-16 | 52 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/model-processor/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/en-us/administration-docker/images/cloud-mp.html) |
| [`entity-extraction-service`](elo-docker-list.md#entity-extraction-service) | 25 | — | `v25-1.0.0-beta` | 371 MB | 2026-10-16 | 51 | wolfiOS | [registry](https://registry.elo.com/harbor/projects/2/repositories/entity-extraction-service/artifacts-tab) · [docs](https://docs.elo.com/ops/eck-images/en-us/administration-docker/images/cloud-ees.html) |
| [`aio`](elo-docker-list.md#aio) | 23 | — | `v23-3.2` | 2.07 GB | 2024-07-09 | 46 | debian:12.2-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/aio/artifacts-tab) |
| [`postgresql-exporter`](elo-docker-list.md#postgresql-exporter) | — | — | `12.5.0` | 43 MB | 2021-10-14 | 45 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/postgresql-exporter/artifacts-tab) |
| [`rp`](elo-docker-list.md#rp) | 21, 20 | — | `v21-3.0` | 163 MB | 2022-10-21 | 25 | debian:11.5-slim | [registry](https://registry.elo.com/harbor/projects/2/repositories/rp/artifacts-tab) |
| [`analytics`](elo-docker-list.md#analytics) | 21 | — | `v21-1.0` | 360 MB | 2021-12-16 | 20 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/analytics/artifacts-tab) |
| [`imo`](elo-docker-list.md#imo) | — | — | `20.00.002-0.1` | 149 MB | 2020-11-05 | 6 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/imo/artifacts-tab) |
| [`replication`](elo-docker-list.md#replication) | — | — | — |  |  | 1 |  | [registry](https://registry.elo.com/harbor/projects/2/repositories/replication/artifacts-tab) |
<!-- images:end -->

Regenerate with:

```
node tools/registry-inventory.js ../../.elo-credentials.json inventory.json
node tools/inventory-md.js inventory.json elo-docker-list.md --readme README.md
```

## What works (tested)

- `docker-compose.yml` + `elo.sh`: **ELO 25** stack (`v25-0.30.1`) following the official guide: `server` (Index Server +
  Web Client + Admin Console), `ix-setup`, `ix-import`, `as`, `search` (Elasticsearch 8), `flows`, `flows-worker`, `tr2`
  (Textreader 2 + OCR) and PostgreSQL.
  - `elo.sh env` generates a `.env` with random internal passwords (once) and uses the `elo-license.lic` license or the
    **`ELO_25*.pk` private key** (ELO downloads the license from its license servers).
  - `elo.sh pull | up | status | down | cache | sources | diagnose`.
- `tools/registry-inventory.js`: logs into the registry (ELO OIDC) and dumps all images, tags, sizes, dates, OS/arch and OCI
  labels (IX, Web Client, Admin Console, plugin, JDK and Tomcat versions).
- `tools/inventory-md.js`: generates `elo-docker-list.md` and the images block of this README.

**Real test (ELO 25 `v25-0.30.1`, WSL2 + Docker Engine 29):** 9 images pulled in 995 s (~16 GB uncompressed); repository
operational ~2 min after start; `.pk` license downloaded by `ix-setup`; Index Server, Admin Console, iSearch and Textreader OK;
administrator login OK (EULA on first login). The Web Client is blocked when the license has no Web Client server/user
licenses (`Missing Webclient Server License`). Memory in use ~10.8 GB.

## The web installer (`installer/`)

Node backend (`server.js`, `exec.js`, `provision.js`, …) + a single-page frontend (`public/index.html`), in English, German
and Spanish, with system/light/dark theme.

- **Install targets:** WSL2 + Docker Engine, Docker Desktop, a **Hyper-V VM**, an **Oracle VirtualBox VM**, a Linux server
  **over SSH** (ed25519 key generated by the installer, passwordless `sudo`) and native Linux. **On Linux (Ubuntu/Debian) it
  works directly with Docker Engine**, no VM, which is the most efficient option. On Windows the images always need a Linux
  VM (WSL2, Docker Desktop or a Hyper-V Ubuntu VM).
- **Wizard steps:** welcome and target → system requirements (software, free memory ~16 GB for the full ELO 25 stack, disk,
  `vm.max_map_count`, ports, registry access) → registry credentials (CLI secret) → live image list and version choice →
  license (`.pk` or text) → configuration (repository, language, license type, passwords, public URL, optional services,
  ports, instance name) → download with progress → installation as a background job → automatic tests (containers,
  **Admin Console login with automatic EULA acceptance via Playwright**, Web Client diagnosis) → access panel and credentials.
- **Automatic provisioning:** WSL + Ubuntu 24.04/Debian, Docker Desktop, Hyper-V, VirtualBox, and **Ubuntu 24.04 / Debian 13
  VMs** on Hyper-V (Gen2) or VirtualBox from the official cloud image (`qemu-img` + cloud-init, SSH key of the installer).
  **Windows Server 2016-2025 VMs** on Hyper-V (evaluation or own ISO, applied with DISM + `unattend.xml`); on 2022/2025 it also
  sets up WSL2 + Ubuntu inside so Docker and ELO install like on any Linux.
- **Several ELO instances side by side** (e.g. ELO 25 and ELO 23 in the same Docker): each is a Compose project with its own
  name, containers, network, volumes and `.env` (`instances/<name>/.env`), with port conflict detection.
- **Administration:** memory per service, start/stop/restart services or the whole stack, logs, container and image tables,
  image backup (`docker save`) and restore, license upload and re-apply, **delete installations** (Docker instances, VMs
  created by the installer), disk usage, WSL memory limit and shutdown, view in Hyper-V `vmconnect`/VirtualBox/Docker Desktop.
- **Last-run diagnosis:** every install/start writes `last-run-<instance>.log` and ends with a per-container diagnosis (memory,
  OOM events, exit code, ports).
- **Local cache and sources:** `elo.sh pull` uses Docker, then the `backup/*.tar` cache, then the network; extra cache sources
  (folders, network shares, FTP/HTTP) are searched before the registry. A stack can be installed **without registry access**.
- **pgAdmin** (optional): `dpage/pgadmin4` preconfigured with the ELO database, opens already connected.
- **Web terminal and machine access:** user, password, SSH/RDP/PowerShell Direct data of every machine the installer created,
  an in-browser terminal, and an X desktop (Xfce / LXQt / GNOME + Firefox, VNC + noVNC through an SSH tunnel).

### ELO links (desktop and browsers of the machines)

Panel **"ELO links"** inside each machine's "Access" (`installer/elolinks.js`, `/api/elolinks/{status,scan,apply,prepare}`).
When a machine is opened it is checked automatically, and the **"Add ELO links"** button only appears if something is missing.
It is idempotent (nothing is duplicated) and the dry run changes nothing.

| Machine | Reached by | Desktop | Browsers |
|---|---|---|---|
| **Windows** (Hyper-V via PowerShell Direct; VirtualBox via guest control) | the VM's user/password (asked for if not stored) | `.lnk` / `.url` in `C:\Users\Public\Desktop` for ELO Application Servers (`setup.bat --status`), Server Setup, Admin Console, Web Client, Workflow Client, Java Client, Dropzone, Desktop… only what is **detected** (`ELO` folder on any drive, ports from `conf\server.xml`) | one **ELO** folder on the bookmarks bar of Chrome and Edge (edits `Bookmarks`, backup `.bak-elo-installer`; skipped while the browser is open unless "close browsers" is ticked); Firefox through `distribution\policies.json` |
| **Linux** (SSH: Hyper-V/VirtualBox VM, WSL) | SSH + `sudo` | `.desktop` files in `~/Desktop` and the applications menu, URLs per instance (`elo.sh`, `instances/*/.env`, or running `eck-services/server` containers) | Firefox `/etc/firefox/policies/policies.json`; Chrome / Chromium managed policy `ManagedBookmarks` (folder "ELO") |

**All bookmarks go into a single "ELO" folder** of each browser's bookmarks bar.

**Linux requirements:** the panel shows what is there (`python3`, the `venv` module, `xdg-open`, `gio`) and, if something is
missing, offers **"Install requirements"**: it installs the packages with the machine's package manager (`apt-get`, `dnf`,
`zypper` or `pacman`) and creates a **private venv** in `/opt/elo-installer/venv`, from which the scripts run (standard library
only). The system python is untouched. On Windows nothing needs installing.

Tested on a Windows Server VM (native ELO 25, Chrome + Edge) and on WSL Ubuntu (ELO 23 in Docker, Firefox).

## Roadmap

- [ ] Pin the links to the Windows taskbar (no supported scripted way on Windows 10/11; consider `LayoutModification.xml`) and
      to the Xfce / LXQt / GNOME panels.
- [ ] Linux: verify the Firefox policy on Debian (`firefox-esr`) and Snap, and Chrome/Chromium with synced profiles; add
      Brave/Vivaldi.
- [ ] Offer the same links for the host itself (Windows/Linux with ELO in local Docker) and for containers with a desktop.
- [ ] Detect a missing desktop on Linux machines and offer to install it before creating launchers (today it only warns).
- [ ] Self-signed `https://` ELO certificates show a browser warning: consider importing the CA.
- [ ] Automated tests for the scan/apply scripts (`testDir` is already supported on Windows).
- [ ] Kubernetes variant (ELO Cloud on Kubernetes operator + Helm), including multitenancy.
- [ ] Full-stack run with the ELO 25 license documented with real times, memory and URLs.

## License

elo-stack-installer is free software under the **GNU General Public License v3.0 or later** (`GPL-3.0-or-later`, see
[LICENSE](LICENSE)). You can use, study and modify it; if you distribute a modified version you must publish it under the same
license with its source code. It does not include or redistribute ELO software, images or licenses: "ELO" is a trademark of
ELO Digital Office GmbH and its images require a partner/customer account.
