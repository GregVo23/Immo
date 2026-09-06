/**
 * Récolte des annonces sur les 4 portails.
 *
 * Principe : le navigateur ne fait QUE ramasser du texte brut (fragments,
 * lien, image). Aucun parsing ici. Tout est écrit dans annonces-brutes.json,
 * puis parsé en Node par lib/parse.mjs.
 *
 * Pourquoi : corriger une regex ne demande plus de re-scraper les 4 sites
 * (~10 min et du trafic inutile). Il suffit de relancer `npm run reparse`.
 */

import './lib/racine.mjs'; // doit rester en premier : fixe le dossier de travail
import fs from 'fs';
import { PlaywrightCrawler, Dataset } from '@crawlee/playwright';
import { URLS, FICHIERS, getSiteConfig } from './config.mjs';
import { parserToutesLesAnnonces } from './parse_annonces.mjs';

/**
 * Scroll adaptatif : continue tant que de nouveaux éléments se chargent
 * (scroll infini de Zimmo/Century21) et s'arrête dès que la hauteur de page
 * se stabilise plusieurs fois de suite.
 */
async function autoScroll(page, log, { maxScrolls = 60, stableThreshold = 4, waitMs = 1200 } = {}) {
    let lastHeight = 0;
    let stableCount = 0;
    for (let i = 0; i < maxScrolls; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(waitMs);
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        if (newHeight === lastHeight) {
            stableCount++;
            if (stableCount >= stableThreshold) {
                log.info(`📜 Fin du scroll (contenu stable après ${i + 1} scrolls).`);
                break;
            }
        } else {
            stableCount = 0;
        }
        lastHeight = newHeight;
    }
}

/**
 * Récolte navigateur. Exécutée dans la page, donc sans accès aux imports :
 * tout ce dont elle a besoin est passé en argument sérialisable.
 */
function recolterCartes({ selector, source, lienPattern }) {
    const TAGS_IGNORES = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'TEMPLATE', 'DEFS', 'SYMBOL', 'USE', 'IFRAME', 'CANVAS']);

    /** Texte de chaque nœud, dans l'ordre du DOM, sans le bruit technique. */
    function fragmentsDe(element) {
        const frags = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                let p = node.parentElement;
                while (p && p !== element) {
                    // toUpperCase() est indispensable : pour un élément SVG,
                    // tagName renvoie le nom local en minuscules ("svg",
                    // "style"), contrairement aux éléments HTML. Sans ça, le
                    // CSS interne des icônes SVG ressortait comme du texte
                    // d'annonce (".st0{fill:#FFB000;}").
                    if (TAGS_IGNORES.has(p.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
                    p = p.parentElement;
                }
                return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            },
        });
        let n;
        while ((n = walker.nextNode())) {
            const t = n.nodeValue.replace(/\s+/g, ' ').trim();
            // Un texte très long n'est jamais un champ de carte : certaines
            // pages embarquent des blobs binaires (en-têtes JFIF vus chez ERA)
            // dans le DOM. On coupe la récolte au plus tôt.
            if (t.length <= 300) frags.push(t);
        }
        return frags;
    }

    /**
     * Meilleure image de la carte. Deux pièges : les placeholders lazy-load
     * (data:image/svg+xml chez Century21, nophoto.svg chez Zimmo) et les
     * srcset, où il faut choisir la plus grande largeur disponible.
     */
    function meilleureImage(carte) {
        const estValide = (u) => u && !u.startsWith('data:') && !/nophoto|no-photo|placeholder|blank\.|dummy/i.test(u);

        const depuisSrcset = (srcset) => {
            const candidats = srcset
                .split(',')
                .map((part) => {
                    const [url, taille] = part.trim().split(/\s+/);
                    return { url, largeur: parseInt(taille ?? '0', 10) || 0 };
                })
                .filter((c) => estValide(c.url));
            if (!candidats.length) return null;
            // On plafonne à 1200 px : inutile de stocker l'original 4000 px.
            candidats.sort((a, b) => b.largeur - a.largeur);
            return (candidats.find((c) => c.largeur <= 1200) ?? candidats[candidats.length - 1]).url;
        };

        for (const src of carte.querySelectorAll('source[srcset]')) {
            const u = depuisSrcset(src.getAttribute('srcset') ?? '');
            if (u) return new URL(u, location.href).href;
        }
        for (const img of carte.querySelectorAll('img')) {
            const direct = [img.getAttribute('src'), img.getAttribute('data-src'), img.getAttribute('data-lazy-src')].find(estValide);
            if (direct) return new URL(direct, location.href).href;
            const u = depuisSrcset(img.getAttribute('srcset') ?? img.getAttribute('data-srcset') ?? '');
            if (u) return new URL(u, location.href).href;
        }
        const bg = carte.querySelector('[style*="background-image"]');
        if (bg) {
            const m = (bg.getAttribute('style') ?? '').match(/url\(['"]?(.*?)['"]?\)/);
            if (m && estValide(m[1])) return new URL(m[1], location.href).href;
        }
        return null;
    }

    const cartes = Array.from(document.querySelectorAll(selector));
    const vus = new Set();
    const resultats = [];

    for (const carte of cartes) {
        // Le lien de l'annonce. `lienPattern` évite de prendre un lien
        // secondaire (agence, favori) présent dans la même carte.
        let lien = null;
        if (carte.tagName === 'A' && (!lienPattern || carte.href.includes(lienPattern))) {
            lien = carte.href;
        } else {
            const liens = Array.from(carte.querySelectorAll('a[href]'));
            const cible = lienPattern ? liens.find((a) => a.href.includes(lienPattern)) : liens[0];
            lien = cible?.href ?? null;
        }
        if (!lien) continue;

        // Dédup intra-page : sur Century21 chaque photo du carrousel est un <a>
        // vers l'annonce, d'où ~30 doublons par bien si on ne filtre pas.
        const cle = lien.split('?')[0];
        if (vus.has(cle)) continue;
        vus.add(cle);

        const fragments = fragmentsDe(carte);
        if (!fragments.length) continue;

        resultats.push({
            fragments,
            imageUrl: meilleureImage(carte),
            lien,
            source,
            dateExtraction: new Date().toISOString(),
        });
    }

    return resultats;
}

/** Diagnostic écrit sur disque quand un sélecteur ne remonte rien. */
async function ecrireDebug(page, config, log) {
    const debugDir = 'debug';
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir);

    const htmlPath = `${debugDir}/${config.source.toLowerCase()}.html`;
    fs.writeFileSync(htmlPath, await page.content());

    const motifs = await page.evaluate(() => {
        const counts = {};
        for (const a of document.querySelectorAll('a[href]')) {
            try {
                const forme = new URL(a.href).pathname
                    .split('/')
                    .map((seg) => (/^\d+$/.test(seg) ? '{id}' : seg))
                    .join('/');
                counts[forme] = (counts[forme] || 0) + 1;
            } catch {
                /* lien non parsable */
            }
        }
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15);
    });

    log.warning(`🐛 ${config.source} : 0 annonce. HTML sauvegardé dans ${htmlPath}`);
    log.warning('🐛 Motifs d\'URL les plus fréquents :');
    motifs.forEach(([forme, n]) => log.warning(`    ${n}x  ${forme}`));
    log.warning('🐛 Attention : un motif très fréquent (>20x) est souvent un carrousel de photos, pas une carte.');
    log.warning('🐛 Le sélecteur doit viser le CONTENEUR de la carte, pas un lien interne.');
}

const crawler = new PlaywrightCrawler({
    headless: true,
    requestHandlerTimeoutSecs: 180,
    maxRequestRetries: 2,

    launchContext: {
        launchOptions: {
            // `channel: 'chromium'` sélectionne le moteur headless récent.
            // Indispensable pour Immovlan : le headless historique est détecté
            // et renvoie une page « You were blocked from <ip> », même avec un
            // User-Agent réaliste. Le moteur récent passe sans encombre, ce qui
            // évite d'ouvrir une fenêtre visible à chaque run.
            channel: 'chromium',
            args: ['--disable-blink-features=AutomationControlled'],
        },
    },

    preNavigationHooks: [
        async ({ page }) => {
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'fr-BE,fr;q=0.9,nl;q=0.8,en;q=0.7' });
        },
    ],

    async requestHandler({ page, request, log }) {
        const config = getSiteConfig(request.url);
        const pageNumber = request.userData?.page ?? config.paginationStart ?? 1;
        log.info(`🌐 ${config.source} (page ${pageNumber}) : ${request.url}`);

        // 1. Bannière de cookies
        try {
            const btn = page.getByRole('button', { name: config.cookieButtonRegex }).first();
            await btn.waitFor({ state: 'visible', timeout: 5000 });
            await btn.click();
            log.info('🍪 Cookies acceptés.');
            await page.waitForTimeout(1000);
        } catch {
            log.info('ℹ️ Pas de bannière de cookies.');
        }

        // 2. Attente des cartes puis scroll adaptatif
        try {
            await page.waitForSelector(config.cardSelector, { timeout: 15000 });
        } catch {
            log.warning(`⚠️ Sélecteur "${config.cardSelector}" introuvable sur ${config.source}.`);
        }

        log.info('📜 Défilement...');
        await autoScroll(page, log);

        // 3. Récolte brute
        const cartes = await page.evaluate(recolterCartes, {
            selector: config.cardSelector,
            source: config.source,
            lienPattern: config.lienPattern ?? null,
        });

        log.info(`🎉 ${cartes.length} cartes récoltées (${config.source}).`);

        if (cartes.length === 0) await ecrireDebug(page, config, log);
        else await Dataset.pushData(cartes);

        // 4. Pagination par URL : uniquement si la page a donné des résultats
        // (sinon on a dépassé la dernière page) et sous la limite de sécurité.
        const maxPages = config.maxPages ?? 20;
        if (config.paginationParam && cartes.length > 0 && pageNumber < (config.paginationStart ?? 1) + maxPages - 1) {
            const suivante = pageNumber + 1;
            const url = new URL(request.url);
            url.searchParams.set(config.paginationParam, String(suivante));
            log.info(`➡️ Page ${suivante} pour ${config.source}...`);
            await crawler.addRequests([{ url: url.toString(), userData: { page: suivante } }]);
        } else if (config.paginationParam) {
            log.info(`🏁 Fin de pagination ${config.source} (dernière page : ${pageNumber}).`);
        }
    },

    failedRequestHandler({ request, log }, error) {
        log.error(`❌ Échec définitif sur ${request.url} : ${error.message}`);
    },
});

await crawler.run(URLS);

/* ------------------------------------------------------------
   Écriture des données brutes, puis parsing
   ------------------------------------------------------------ */

const { items } = await (await Dataset.open()).getData();
fs.writeFileSync(FICHIERS.brutes, JSON.stringify(items, null, 2));
console.log(`\n📦 ${items.length} cartes brutes écrites dans ${FICHIERS.brutes}`);

parserToutesLesAnnonces();
