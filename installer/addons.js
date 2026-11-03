'use strict';
// ELO add-ons (docXtractor, ELO Business Solutions) from the packages installed in a repository.
// Source: Index Server JSON API, PackageService.checkoutPackages with HTTP Basic (ELO 25: empty name list = all packages).
const x = require('./exec');

const PKG_KEYS = { docXtractor: ['docx', 'docxtractor', 'aiml', 'intelligent'], 'BS Common': ['common'], 'BS Invoice': ['invoice'], 'BS Contract': ['contract'],
  'BS Contact': ['contact'], 'BS DATEV': ['datev'], 'BS Development': ['development'] };

// Customer packages of ELO 25 use their own UPPER_CASE namespace (OUTGOING_INVOICE, PRJ…); ELO's start with ELO_.
const isCustomerPackage = p => /^[A-Z0-9_]+$/.test(p.namespace) && !/^ELO_/.test(p.namespace);

// packages: [{ name, namespace, version }] → one entry per add-on with the packages that prove it.
function classify(packages, extraEvidence = {}) {
  return Object.keys(PKG_KEYS).map(k => {
    const hit = (packages || []).filter(p => !isCustomerPackage(p) && PKG_KEYS[k].some(w => `${p.namespace} ${p.name}`.toLowerCase().includes(w)));
    return { name: k, found: hit.length > 0 || !!extraEvidence[k], installed: hit.length > 0, versions: [...new Set(hit.map(p => p.version).filter(Boolean))],
      evidence: [...hit.map(p => `package ${p.namespace} ${p.name} ${p.version}`.trim()), ...(extraEvidence[k] || [])].slice(0, 6) };
  });
}

const normalize = j => (j?.packageDataList || j?.packages || [])
  .map(p => ({ name: p.name || '', namespace: p.namespace || '', version: p.pkgVersion || p.version || '' }));

// From this machine (curl.exe / curl): base = IX REST root, e.g. https://172.21.5.4:9093/ix-Contelo/rest
async function fetchPackages(base, user, password) {
  const tries = [['PackageService/checkoutPackages', []], ['PackageService/checkoutPackages', ['*']]];
  for (const [ep, names] of tries) {
    const body = JSON.stringify({ packageZ: { bset: '2097151' }, checkoutInfo: { nameOrGuids: names } });
    const r = await x.run('curl', ['-sk', '-m', '60', '-u', `${user}:${password}`, '-X', 'POST', '-H', 'Content-Type: application/json', '-d', body, `${base}/${ep}`], { timeoutMs: 90000 });
    let j; try { j = JSON.parse(r.out); } catch { continue; }
    if (j?.result && Object.keys(j.result).length) return { endpoint: ep, packages: normalize(j.result) };
  }
  return null;
}

module.exports = { PKG_KEYS, classify, normalize, fetchPackages, isCustomerPackage };
