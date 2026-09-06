/**
 * Outil de sondage d'un nouveau portail.
 *
 * Usage : node explorer_site.mjs "<url de recherche>"
 *
 * Ne scrape rien : il ouvre la page, la fait défiler, puis rapporte de quoi
 * remplir une entrée de SITES dans config.mjs :
 *   - les motifs d'URL les plus fréquents (pour repérer le lien d'annonce)
 *   - les conteneurs candidats (élément le plus petit contenant prix + lien)
 *   - les fragments de texte des 3 premières cartes trouvées
 *
 * Le piège à éviter : un motif de lien très fréquent est souvent un carrousel
 * de photos, pas une carte (cf. Century21 et ses 520 diapositives).
 */

import './lib/racine.mjs'; // doit rester en premier : fixe le dossier de travail
import fs from 'fs';
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) {
    console.error('Usage : node explorer_site.mjs "<url de recherche>"');
    process.exit(2);
}

// Empreinte réaliste : Immovlan renvoie « You were blocked » à un Chromium
// headless par défaut, mais sert la page normalement avec un vrai UA et une
// fenêtre visible.
const navigateur = await chromium.launch({
    headless: process.env.HEADLESS === '1',
    args: ['--disable-blink-features=AutomationControlled'],
});
const contexte = await navigateur.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'fr-BE',
    timezoneId: 'Europe/Brussels',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'fr-BE,fr;q=0.9,nl;q=0.8,en;q=0.7' },
});
const page = await contexte.newPage();

page.setDefaultTimeout(30000);
console.log(`🌐 Chargement de ${url}\n`);

try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) {
    console.error('❌ Échec du chargement :', e.message);
    await navigateur.close();
    process.exit(1);
}

// Cookies
for (const motif of [/accepter/i, /accept/i, /akkoord/i, /tout accepter/i, /j'accepte/i]) {
    try {
        const b = page.getByRole('button', { name: motif }).first();
        await b.waitFor({ state: 'visible', timeout: 3000 });
        await b.click();
        console.log('🍪 Bannière fermée via', motif);
        await page.waitForTimeout(1500);
        break;
    } catch {
        /* motif suivant */
    }
}

// Défilement pour déclencher le chargement paresseux
for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(500);

console.log('📄 Titre de la page :', JSON.stringify(await page.title()));
console.log('🔗 URL finale      :', page.url());
console.log('');

const rapport = await page.evaluate(() => {
    const TAGS_IGNORES = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'TEMPLATE', 'DEFS', 'IFRAME']);

    function fragmentsDe(el) {
        const out = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
            acceptNode(n) {
                let p = n.parentElement;
                while (p && p !== el) {
                    if (TAGS_IGNORES.has(p.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
                    p = p.parentElement;
                }
                return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            },
        });
        let n;
        while ((n = walker.nextNode())) {
            const t = n.nodeValue.replace(/\s+/g, ' ').trim();
            if (t && t.length <= 300) out.push(t);
        }
        return out;
    }

    // 1. Motifs d'URL
    const formes = {};
    for (const a of document.querySelectorAll('a[href]')) {
        try {
            const f = new URL(a.href).pathname
                .split('/')
                .map((s) => (/^\d+$/.test(s) ? '{id}' : /^[0-9a-f-]{16,}$/i.test(s) ? '{hash}' : s))
                .join('/');
            formes[f] = (formes[f] ?? 0) + 1;
        } catch {
            /* lien non parsable */
        }
    }
    const motifs = Object.entries(formes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 18);

    // 2. Éléments contenant un prix : on remonte au plus petit ancêtre qui
    // contient aussi un lien. C'est le conteneur de carte le plus probable.
    const REGEX_PRIX = /(?:€|EUR)\s*[\d][\d.,\s]{4,}|[\d][\d.,\s]{4,}\s*(?:€|EUR)/;
    const conteneurs = new Map();

    for (const el of document.querySelectorAll('body *')) {
        if (el.children.length !== 0) continue; // on part des feuilles
        const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!REGEX_PRIX.test(t) || t.length > 40) continue;

        let p = el;
        for (let d = 0; d < 12 && p; d++) {
            p = p.parentElement;
            if (!p || p === document.body) break;
            if (p.querySelector('a[href]')) {
                const cls = (p.className ?? '').toString().trim();
                const tag = p.tagName.toLowerCase();
                // signature stable : on retire les suffixes hachés
                const signature = `${tag}.${cls.split(/\s+/).filter(Boolean).slice(0, 3).join('.') || '(sans-classe)'}`;
                const e = conteneurs.get(signature) ?? { signature, n: 0, exemple: null };
                e.n++;
                if (!e.exemple) {
                    e.exemple = {
                        fragments: fragmentsDe(p).slice(0, 16),
                        lien: p.querySelector('a[href]')?.href ?? null,
                        nbLiens: p.querySelectorAll('a[href]').length,
                        nbImages: p.querySelectorAll('img').length,
                    };
                }
                conteneurs.set(signature, e);
                break;
            }
        }
    }

    // 3. Combien de <article> et de conteneurs à classe "card"-like ?
    const compteurs = {
        article: document.querySelectorAll('article').length,
        'li[class]': document.querySelectorAll('li[class]').length,
        '[class*="card"]': document.querySelectorAll('[class*="card"]').length,
        '[class*="Card"]': document.querySelectorAll('[class*="Card"]').length,
        '[class*="result"]': document.querySelectorAll('[class*="result"]').length,
        '[class*="list-item"]': document.querySelectorAll('[class*="list-item"]').length,
        '[class*="property"]': document.querySelectorAll('[class*="property"]').length,
        '[data-testid]': document.querySelectorAll('[data-testid]').length,
        'occurrences €': (document.body.innerText.match(/€/g) ?? []).length,
    };

    return {
        motifs,
        compteurs,
        conteneurs: [...conteneurs.values()].sort((a, b) => b.n - a.n).slice(0, 6),
    };
});

console.log("=== MOTIFS D'URL (le lien d'annonce est probablement ici) ===");
rapport.motifs.forEach(([f, n]) => console.log(`  ${String(n).padStart(4)}x  ${f}`));

console.log('\n=== COMPTEURS DE SÉLECTEURS GÉNÉRIQUES ===');
for (const [k, v] of Object.entries(rapport.compteurs)) console.log(`  ${String(v).padStart(4)}  ${k}`);

console.log('\n=== CONTENEURS CANDIDATS (contiennent un prix + un lien) ===');
rapport.conteneurs.forEach((c) => {
    console.log(`\n  ${c.n}x  ${c.signature}`);
    console.log(`      liens=${c.exemple.nbLiens} images=${c.exemple.nbImages}`);
    console.log(`      lien   : ${(c.exemple.lien ?? '').slice(0, 95)}`);
    console.log(`      frags  : ${JSON.stringify(c.exemple.fragments)}`);
});

const chemin = 'debug/sonde.html';
if (!fs.existsSync('debug')) fs.mkdirSync('debug');
fs.writeFileSync(chemin, await page.content());
console.log(`\n💾 HTML complet : ${chemin}`);

await navigateur.close();
