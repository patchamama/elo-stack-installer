'use strict';
// Post-install checks in a headless browser:
//  - acceptEula(): sign in to the Admin Console as the ELO administrator and accept the end-user license
//    agreement (tick the checkbox + OK) if it is shown on first login. Only run with the user's consent (wizard option).
//  - webClientCheck(): open the Web Client and report whether it is usable or blocked ("No license detected").
// Portable Chromium: downloaded once into installer/browsers (not the user's profile, not Edge/Chrome), so the tests behave the same everywhere.
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || require('path').join(__dirname, 'browsers');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(require('path').join(__dirname, '..', '..', '..', 'node_modules', 'playwright'))); }

// Headless browser: the bundled Chromium; if it was never downloaded, the Edge/Chrome already on the computer;
// as a last resort download Chromium once (npx playwright install chromium) and retry.
let installing = null;
async function launchBrowser() {
  try { return await chromium.launch(); } catch (e) {
    if (!/Executable doesn't exist|playwright install/i.test(e.message)) throw e;
    installing ||= new Promise((res, rej) => {
      let cli; try { cli = require('path').join(require('path').dirname(require.resolve('playwright/package.json')), 'cli.js'); } catch { return rej(e); }
      require('child_process').execFile(process.execPath, [cli, 'install', 'chromium'], { timeout: 600000, env: process.env, windowsHide: true }, err => err ? rej(new Error('Could not download Chromium for the browser tests (run "npx playwright install chromium" in the installer folder): ' + err.message)) : res());
    });
    await installing;
    return chromium.launch();
  }
}

async function signIn(page, url, user, pass) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  const u = await page.$('input[name=username], input#username');
  const p = await page.$('input[type=password]');
  if (u && p) {
    await u.fill(user); await p.fill(pass);
    await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), p.press('Enter')]);
    await page.waitForTimeout(4000);
  }
  if (/sign-in/.test(page.url())) {
    const msg = await page.evaluate(() => (document.querySelector('[class*=error], [role=alert]')?.innerText || '').trim());
    throw new Error(`login failed${msg ? ': ' + msg : ''}`);
  }
}

async function acceptEula({ base, repo, user, pass, screenshot }) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
    await signIn(page, `${base}/${repo}/plugin/de.elo.ix.plugin.proxy/ac/`, user, pass);
    let accepted = false;
    if (/eula/i.test(page.url())) {
      // The agreement checkbox is the only one on the page (label "I have read … EULA" / "Ich habe … gelesen").
      // PrimeFaces hides the real <input> (0x0 px): the clickable thing is the .ui-chkbox-box next to it.
      const box = page.locator('.ui-chkbox-box:visible, input[type=checkbox]:visible, [role=checkbox]:visible').first();
      await box.waitFor({ state: 'visible', timeout: 20000 }).catch(() => { throw new Error('EULA page without a visible checkbox'); });
      await box.click({ timeout: 15000 });
      const ok = page.locator('button:visible:has-text("OK"), input[type=submit][value="OK"]:visible, a:visible:has-text("OK")').first();
      await ok.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { throw new Error('EULA OK button not found'); });
      await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), ok.click({ timeout: 15000 })]);
      await page.waitForTimeout(4000);
      if (/eula/i.test(page.url())) throw new Error('EULA still shown after OK');
      accepted = true;
    }
    if (screenshot) await page.screenshot({ path: screenshot });
    return { ok: true, accepted, alreadyAccepted: !accepted, page: new URL(page.url()).pathname };
  } finally { await browser.close(); }
}

async function webClientCheck({ base, repo, user, pass, screenshot }) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
    await page.goto(`${base}/${repo}/plugin/de.elo.ix.plugin.proxy/web/`, { waitUntil: 'networkidle', timeout: 90000 });
    const text = await page.evaluate(() => document.body.innerText || '');
    if (/no licen[cs]e detected/i.test(text)) {
      if (screenshot) await page.screenshot({ path: screenshot });
      return { ok: false, reason: 'license', message: 'The ELO license has no Web Client server/user licenses ("No license detected").' };
    }
    if (await page.$('input[type=password]')) await signIn(page, page.url(), user, pass);
    await page.waitForTimeout(6000);
    if (screenshot) await page.screenshot({ path: screenshot });
    const after = await page.evaluate(() => document.body.innerText || '');
    if (/no licen[cs]e detected/i.test(after)) return { ok: false, reason: 'license', message: 'Web Client blocked: no Web Client license.' };
    return { ok: true, title: await page.title() };
  } finally { await browser.close(); }
}

module.exports = { acceptEula, webClientCheck };
