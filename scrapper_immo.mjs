/**
 * Récolte des annonces sur les 6 portails.
 *
 * Principe : le navigateur ne fait QUE ramasser du texte brut (fragments,
 * lien, image). Aucun parsing ici. Tout est écrit dans annonces-brutes.json,
 * puis parsé en Node par lib/parse.mjs.
 *
 * Pourquoi : corriger une regex ne demande plus de re-scraper les 6 sites
 * (~10 min et du trafic inutile). Il suffit de relancer `npm run reparse`.
 */

import './lib/racine.mjs'; // doit rester en premier : fixe le dossier de travail
import fs from 'fs';
import { PlaywrightCrawler, Dataset } from '@crawlee/playwright';
import { URLS, FICHIERS, getSiteConfig, TOUS_LES_CP } from './config.mjs';
import { parserToutesLesAnnonces } from './parse_annonces.mjs';

/**
 * Scroll adaptatif : continue tant que de NOUVELLES CARTES se chargent.
 *
 * On compte les cartes plutôt que la hauteur du document : c'est la mesure
 * de ce qui nous intéresse vraiment. La hauteur, elle, peut rester figée
 * quelques secondes pendant qu'une requête part chercher le lot suivant —
 * ERA s'arrêtait ainsi à 22 cartes alors que la page en charge 100.
 *
 * `stableThreshold` dépend du type de site : un portail paginé n'a qu'un lot
 * fixe par page (le défilement ne sert qu'à déclencher les images), inutile
 * d'attendre longtemps ; un scroll infini mérite plus de patience.
 */
async function autoScroll(page, log, { selector = null, maxScrolls = 60, stableThreshold = 4, waitMs = 1200 } = {}) {
    let derniereMesure = -1;
    let stable = 0;
    for (let i = 0; i < maxScrolls; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(waitMs);

        const mesure = selector
            ? await page.evaluate((s) => document.querySelectorAll(s).length, selector)
            : await page.evaluate(() => document.body.scrollHeight);

        if (mesure === derniereMesure) {
            stable++;
            if (stable >= stableThreshold) {
                log.info(`📜 Fin du scroll (${selector ? mesure + ' cartes' : 'hauteur'} stable après ${i + 1} scrolls).`);
                break;
            }
        } else {
            stable = 0;
        }
        derniereMesure = mesure;
    }
}

/**
 * Retire les fenêtres promotionnelles qui recouvrent la page et interceptent
 * les clics. Constaté sur Trior : une modale HubSpot
 * (#hs-interactives-modal-overlay) rendait le bouton « Trouver » incliquable,
 * le clic échouait après 56 tentatives et le portail remontait 0 bien.
 */
async function masquerSuperpositions(page) {
    await page
        .evaluate(() => {
            const selecteurs = [
                '[id^="hs-interactives"]',
                '[id^="hs-web-interactives"]',
                '#hs-modal-overlay',
                '.modal-backdrop',
                // Realo : son bandeau de consentement couvre toute la page et
                // intercepte les clics (même symptôme que la fenêtre HubSpot
                // de Trior, qui faisait échouer 56 tentatives de clic).
                '[id*="usercentrics"]',
            ];
            let retires = 0;
            for (const s of selecteurs) {
                for (const el of document.querySelectorAll(s)) {
                    el.remove();
                    retires++;
                }
            }
            return retires;
        })
        .catch(() => 0);
}

/**
 * Récolte navigateur. Exécutée dans la page, donc sans accès aux imports :
 * tout ce dont elle a besoin est passé en argument sérialisable.
 */
function recolterCartes({ selector, source, lienPattern, lienExclusion }) {
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
     * TOUS les candidats image de la carte, dans l'ordre du DOM.
     *
     * On ne choisit PAS ici : le navigateur récolte, `lib/parse.mjs`
     * (choisirImage) tranche. C'est ce qui permet de corriger la règle
     * — logos d'agence, pictogrammes PEB, « pas de photo » — d'un simple
     * `npm run reparse`. Deux pièges restent côté récolte : les
     * placeholders de lazy-load (`data:image/svg+xml` chez Century21) et
     * les srcset, où il faut choisir la plus grande largeur disponible.
     */
    function imagesCandidates(carte) {
        const urls = [];
        const ajouter = (u) => {
            if (!u || u.startsWith('data:')) return;
            try {
                const abs = new URL(u, location.href).href;
                if (!urls.includes(abs)) urls.push(abs);
            } catch {
                /* URL non résolvable */
            }
        };

        const depuisSrcset = (srcset) => {
            const candidats = (srcset || '')
                .split(',')
                .map((part) => {
                    const [url, taille] = part.trim().split(/\s+/);
                    return { url, largeur: parseInt(taille ?? '0', 10) || 0 };
                })
                .filter((c) => c.url && !c.url.startsWith('data:'));
            if (!candidats.length) return null;
            // On plafonne à 1200 px : inutile de stocker l'original 4000 px.
            candidats.sort((a, b) => b.largeur - a.largeur);
            return (candidats.find((c) => c.largeur <= 1200) ?? candidats[candidats.length - 1]).url;
        };

        // querySelectorAll rend l'ordre du document : la première photo
        // réelle de la carte reste donc la première candidate.
        for (const el of carte.querySelectorAll('img, source[srcset], [style*="background-image"]')) {
            const tag = el.tagName.toUpperCase();
            if (tag === 'IMG') {
                ajouter(el.getAttribute('src'));
                ajouter(el.getAttribute('data-src'));
                ajouter(el.getAttribute('data-lazy-src'));
                ajouter(depuisSrcset(el.getAttribute('srcset') ?? el.getAttribute('data-srcset')));
            } else if (tag === 'SOURCE') {
                ajouter(depuisSrcset(el.getAttribute('srcset')));
            } else {
                const m = (el.getAttribute('style') ?? '').match(/url\(['"]?(.*?)['"]?\)/);
                if (m) ajouter(m[1]);
            }
            if (urls.length >= 12) break; // au-delà, c'est du carrousel
        }
        return urls;
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
        // Catégorie hors périmètre (appartement, immeuble mixte...) : on ne
        // récolte même pas la carte, ça évite du travail pour rien en plus
        // d'écarter le bien.
        if (lienExclusion && lienExclusion.test(lien)) continue;

        // Dédup intra-page : sur Century21 chaque photo du carrousel est un <a>
        // vers l'annonce, d'où ~30 doublons par bien si on ne filtre pas.
        const cle = lien.split('?')[0];
        if (vus.has(cle)) continue;
        vus.add(cle);

        const fragments = fragmentsDe(carte);
        if (!fragments.length) continue;

        // Immoweb encode le PEB dans une icône ("peb_e.png") plutôt qu'en
        // texte : aucun fragment ne le porte. On le lit dans les URLs
        // d'image et on l'injecte comme un fragment "PEB E" ordinaire, que
        // lib/parse.mjs sait déjà reconnaître (parsePeb).
        for (const img of carte.querySelectorAll('img')) {
            const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
            const m = src.match(/peb[_-]?([a-g])\b/i);
            if (m) {
                fragments.push(`PEB ${m[1].toUpperCase()}`);
                break;
            }
        }

        resultats.push({
            fragments,
            images: imagesCandidates(carte),
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

/**
 * Trior ne propose pas de filtre par URL : sa recherche est un <form
 * method="post"> (catégorie + <select multiple> de villes, valeur = code
 * postal). On pilote donc le formulaire au lieu de construire un lien.
 *
 * Sans ce filtre, la page ne montre que les toutes dernières annonces tous
 * types confondus (maisons, appartements, terrains...) au lieu du périmètre
 * voulu — `lienPattern: '/maison/'` ferait bien retomber sur des cartes
 * hors zone, mais en bien plus petit nombre.
 */
async function filtrerTrior(page, log) {
    const categorie = await page.$('select[name="SelectedCategory"]');
    const villes = await page.$('select[name="SelectedCities"]');
    if (!categorie || !villes) {
        log.warning('⚠️ Formulaire de recherche Trior introuvable : récolte non filtrée (site probablement modifié).');
        return;
    }

    // Seuls les CP effectivement proposés par le site peuvent être sélectionnés
    // dans le <select> ; le mapper évite une erreur si un CP du périmètre y est absent.
    const disponibles = await page.evaluate((cps) => {
        const options = [...document.querySelector('select[name="SelectedCities"]').options].map((o) => o.value);
        return cps.filter((cp) => options.includes(cp));
    }, TOUS_LES_CP.map(String));

    if (!disponibles.length) {
        log.warning('⚠️ Aucun code postal du périmètre reconnu par le formulaire Trior.');
        return;
    }

    await page.selectOption('select[name="SelectedCategory"]', '1'); // 1 = Maison
    await page.selectOption('select[name="SelectedCities"]', disponibles);

    // La modale HubSpot peut apparaître APRÈS le chargement initial : on la
    // retire juste avant de cliquer, sinon elle intercepte le clic et le
    // formulaire n'est jamais soumis (Trior remontait alors 0 bien).
    await masquerSuperpositions(page);

    await Promise.all([
        page.waitForResponse((r) => r.url().includes('chercher-bien'), { timeout: 15000 }).catch(() => null),
        // `force` en dernier recours : si une superposition inconnue reparaît,
        // le clic est tout de même délivré au bouton plutôt que d'expirer.
        page.click('button[type="submit"]', { timeout: 10000 }).catch(async () => {
            log.warning('⚠️ Clic bloqué par une superposition — nouvelle tentative en force.');
            await masquerSuperpositions(page);
            await page.click('button[type="submit"]', { force: true, timeout: 10000 });
        }),
    ]);
    await page.waitForTimeout(1500);

    log.info(`🔎 Trior filtré : Maison, ${disponibles.length}/${TOUS_LES_CP.length} codes postaux du périmètre.`);
}

const crawler = new PlaywrightCrawler({
    headless: true,
    requestHandlerTimeoutSecs: 180,
    maxRequestRetries: 2,

    /*
     * Concurrence bridée, et c'est le résultat d'une panne réelle.
     *
     * Crawlee monte seul à 5 onglets parallèles. Tant qu'il y avait 7 URLs,
     * tout allait bien. En ajoutant les 45 URLs de Realo — un portail lent —
     * le run s'est effondré : 340 expirations de navigation à 60 s, dont
     * 315 sur Realo, et les créneaux monopolisés par ses tentatives ont
     * affamé les autres portails. Immoweb est tombé à 32 cartes au lieu de
     * 1404, Trior et Trevi à zéro. La file est partagée : un portail lent
     * pénalise tous les autres.
     *
     * 3 onglets suffisent largement (le goulot est le réseau, pas le CPU) et
     * la marge de 120 s absorbe les pages lentes sans déclencher de reprise.
     */
    maxConcurrency: 3,
    navigationTimeoutSecs: 120,

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

        // 1 bis. Fenêtres promotionnelles qui bloquent les clics (voir Trior).
        await masquerSuperpositions(page);

        // 1 ter. Trior : pas d'URL filtrée, on pilote son formulaire de recherche.
        if (config.source === 'Trior') {
            await filtrerTrior(page, log);
        }

        // 2. Attente des cartes puis scroll adaptatif
        try {
            await page.waitForSelector(config.cardSelector, { timeout: 15000 });
        } catch {
            log.warning(`⚠️ Sélecteur "${config.cardSelector}" introuvable sur ${config.source}.`);
        }

        log.info('📜 Défilement...');
        // Un portail paginé n'a qu'un lot fixe par page : on n'insiste pas.
        // Un scroll infini, lui, mérite d'attendre plusieurs tours à vide.
        await autoScroll(page, log, {
            selector: config.cardSelector,
            stableThreshold: config.paginationParam ? 2 : 6,
        });

        // 3. Récolte brute
        const cartes = await page.evaluate(recolterCartes, {
            selector: config.cardSelector,
            source: config.source,
            lienPattern: config.lienPattern ?? null,
            // RegExp traverse la frontière page.evaluate() nativement (types
            // sérialisables de Playwright), pas besoin de la recomposer ici.
            lienExclusion: config.lienExclusion ?? null,
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
            // Deux conventions. La plupart des portails numérotent les pages
            // (page=2, 3...). ERA compte en DÉCALAGE de résultats
            // (pager[offset]=36, 72...) : sans `paginationPas`, on lui
            // demandait « page 2 » qu'il ignorait, et on s'arrêtait à 36
            // cartes sur 97 annoncées.
            const valeur = config.paginationPas ? (suivante - (config.paginationStart ?? 1)) * config.paginationPas : suivante;
            url.searchParams.set(config.paginationParam, String(valeur));
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
