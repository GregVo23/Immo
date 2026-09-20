/**
 * Visite la page de détail de chaque bien pour en tirer ce que la liste de
 * résultats ne donne pas : l'adresse exacte et, à défaut de mieux, la photo.
 *
 * Exécutable seul : `node enrichir_adresses.mjs` ou `npm run adresses`.
 *
 * Pourquoi l'adresse : 92 % des biens n'étaient positionnés qu'au centre de
 * leur commune, alors que « accès gare » pèse 40 points sur 100 dans le score.
 *
 * Pourquoi la photo : 36 % des cartes de résultats ne portaient pas de photo
 * du bien mais le logo de l'agence, un pictogramme PEB ou un « pas de photo »
 * (voir IMAGES_REJETEES dans lib/parse.mjs). La fiche, elle, a la vraie photo.
 *
 * Le coût est supportable grâce au CACHE : ni l'adresse ni la photo ne
 * changent, donc une fiche déjà visitée ne l'est plus jamais — y compris
 * quand elle n'a rien révélé (le portail ne publie pas l'adresse : inutile de
 * réessayer). Le premier passage est long (~1 fiche/seconde), les suivants ne
 * traitent que les nouvelles annonces, soit quelques unités par jour.
 *
 * Le cache est écrit au fil de l'eau : un run interrompu n'est jamais perdu.
 */

import './lib/racine.mjs'; // doit rester en premier : fixe le dossier de travail
import fs from 'fs';
import { pathToFileURL } from 'url';
import { chromium } from 'playwright';
import { FICHIERS, SITES, CP_VERS_COMMUNE, regionDuCp } from './config.mjs';
import { extraireAdresse } from './lib/adresse_detail.mjs';
import { choisirImage, construireGalerie } from './lib/parse.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Sélecteur d'adresse connu, quand le portail en expose un de stable. */
function selecteurAdressePour(source) {
    const entree = Object.values(SITES).find((s) => s.source === source);
    return entree?.selecteurAdresse ?? null;
}

function chargerCache() {
    if (!fs.existsSync(FICHIERS.cacheAdresses)) return {};
    try {
        return JSON.parse(fs.readFileSync(FICHIERS.cacheAdresses, 'utf-8'));
    } catch {
        return {}; // cache corrompu : on repart de zéro plutôt que de planter
    }
}

/**
 * Récolte navigateur : uniquement du brut, aucun parsing ici — même principe
 * que scrapper_immo.mjs, pour que corriger l'extraction ne demande pas de
 * revisiter les fiches.
 *
 * On en profite pour ramasser les images : sur Immoweb, 368 cartes de
 * résultats ne portaient que le logo de l'agence, jamais la photo du bien,
 * alors que la fiche, elle, l'affiche bien.
 */
function recolterFiche(selecteur) {
    const MOTIF_VOIRIE = /(rue|avenue|chauss|boulevard|chemin|clos|dr[èe]ve|place|route|all[ée]e|square|impasse|quai|straat|steenweg|laan|weg|dreef|plein|baan|kaai|hof)/i;

    let jsonLdAdresse = null;
    const images = [];
    const ajouterImage = (u) => {
        if (!u || typeof u !== 'string' || u.startsWith('data:')) return;
        try {
            const abs = new URL(u, location.href).href;
            if (!images.includes(abs)) images.push(abs);
        } catch {
            /* URL non résolvable */
        }
    };

    // og:image D'ABORD : c'est la photo de couverture que le portail a lui
    // même désignée pour ce bien, donc l'ancre la plus sûre pour distinguer
    // sa galerie de celles des « biens similaires » (voir construireGalerie).
    for (const m of document.querySelectorAll('meta[property="og:image"], meta[name="og:image"]')) {
        ajouterImage(m.getAttribute('content'));
    }

    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
            const data = JSON.parse(s.textContent);
            for (const o of Array.isArray(data) ? data : [data]) {
                if (o?.address?.streetAddress) jsonLdAdresse = o.address;
                for (const img of [].concat(o?.image ?? [])) {
                    ajouterImage(typeof img === 'string' ? img : img?.url);
                }
            }
        } catch {
            /* bloc non parsable */
        }
    }

    // Puis la galerie du DOM. Le plafond est haut parce qu'une fiche mélange
    // plusieurs biens : une fiche Century21 portait 60 images appartenant à
    // quatre biens différents, et c'est construireGalerie qui fait le tri.
    for (const img of document.querySelectorAll('img')) {
        ajouterImage(img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src'));
        if (images.length >= 60) break;
    }

    const el = selecteur ? document.querySelector(selecteur) : null;

    const lignesTexte = (document.body.innerText || '')
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter((l) => l.length > 6 && l.length < 100 && /\b[1-9]\d{3}\b/.test(l) && MOTIF_VOIRIE.test(l))
        .slice(0, 12);

    return {
        jsonLdAdresse,
        texteSelecteur: el ? el.textContent.replace(/\s+/g, ' ').trim() : null,
        lignesTexte,
        images,
    };
}

/**
 * @param {object} options
 * @param {number} options.limite - nombre maximum de fiches à visiter.
 * @param {boolean} options.visiter - à false, aucune visite : on se contente
 *   de reporter le cache existant dans annonces.json. C'est ce qu'il faut
 *   après avoir modifié la règle de sélection des photos dans lib/parse.mjs,
 *   puisque le cache mémorise les candidats et non le choix : la nouvelle
 *   règle se rejoue alors sans une seule requête réseau.
 */
export async function enrichirAdresses({ limite = Infinity, visiter = true } = {}) {
    if (!fs.existsSync(FICHIERS.annonces)) {
        console.error(`❌ ${FICHIERS.annonces} introuvable. Lance d'abord : npm start`);
        process.exitCode = 1;
        return null;
    }

    const annonces = JSON.parse(fs.readFileSync(FICHIERS.annonces, 'utf-8'));
    const cache = chargerCache();

    // Une fiche est visitée si elle peut encore apporter quelque chose :
    // l'adresse exacte, ou la photo du bien quand la carte de résultats n'en
    // portait pas (Immoweb n'y met souvent que le logo de l'agence).
    const aVisiter = (a) => {
        if (!a.lienCanonique) return false;
        const c = cache[a.lienCanonique];
        // `!c` et non `!c.rue` : une entrée sans rue veut dire « déjà
        // cherché, le portail ne la publie pas » — inutile d'y retourner.
        const manqueAdresse = !a.rue && !c;
        // Pour la photo, ce qu'on mémorise ce sont les CANDIDATS (`images`),
        // pas le choix : affiner la règle de lib/parse.mjs (couverture,
        // galerie, intrus à écarter) se rejoue alors hors ligne, au simple
        // report ci-dessous. Une fiche dont les candidats sont déjà en cache
        // n'est donc jamais revisitée, même si la règle change.
        const manqueGalerie = !(c && 'images' in c);
        return manqueAdresse || manqueGalerie;
    };
    const aTraiter = visiter ? annonces.filter(aVisiter).slice(0, limite) : [];

    const sansPhoto = annonces.filter((a) => !a.imageUrl).length;
    console.log(`\n🏠 FICHES DE DÉTAIL (adresse exacte + photo)`);
    console.log(`   ${annonces.filter((a) => a.rue).length} bien(s) ont déjà une adresse depuis la liste de résultats.`);
    console.log(`   ${sansPhoto} bien(s) sans photo exploitable sur leur carte.`);
    console.log(`   ${annonces.filter((a) => a.lienCanonique in cache).length} fiche(s) déjà visitée(s) (cache), ${aTraiter.length} à visiter.`);

    if (aTraiter.length) {
        const nav = await chromium.launch({ headless: true, channel: 'chromium', args: ['--disable-blink-features=AutomationControlled'] });
        const ctx = await nav.newContext({ userAgent: UA, locale: 'fr-BE', viewport: { width: 1400, height: 900 } });
        const page = await ctx.newPage();
        const cookiesAcceptes = new Set();

        let trouvees = 0;
        let photos = 0;
        let echecs = 0;

        for (const [i, a] of aTraiter.entries()) {
            try {
                await page.goto(a.lien, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Bannière de cookies : une seule fois par domaine.
                const domaine = new URL(a.lien).hostname;
                if (!cookiesAcceptes.has(domaine)) {
                    cookiesAcceptes.add(domaine);
                    try {
                        await page.getByRole('button', { name: /accepter|accept|akkoord/i }).first().click({ timeout: 3000 });
                        await page.waitForTimeout(600);
                    } catch {
                        /* pas de bannière */
                    }
                }
                await page.waitForTimeout(900);

                const brut = await page.evaluate(recolterFiche, selecteurAdressePour(a.source));
                const adresse = extraireAdresse(brut);
                const photo = choisirImage(brut);

                // On mémorise AUSSI les échecs : sans ça, les fiches sans
                // adresse ni photo publiées seraient revisitées à chaque run
                // pour rien. D'où `photo: null` plutôt que l'omission.
                const precedent = cache[a.lienCanonique] ?? {};
                cache[a.lienCanonique] = {
                    ...precedent,
                    // Une revisite pour la photo ne doit pas effacer une
                    // adresse déjà trouvée : on n'écrit `rue: null` que si
                    // l'entrée n'en portait aucune.
                    ...(adresse ?? ('rue' in precedent ? {} : { rue: null })),
                    // On mémorise les CANDIDATS plutôt que le vainqueur, et
                    // largement : une fiche mélange la galerie du bien, celles
                    // des biens similaires, logos, icônes et tuiles de carte.
                    // Le tri se fait hors ligne, dans construireGalerie.
                    images: (brut.images ?? []).slice(0, 40),
                    source: a.source,
                    recupereLe: new Date().toISOString(),
                };

                if (adresse) trouvees++;
                if (photo) photos++;
            } catch (e) {
                echecs++;
                // Pas de mise en cache d'une erreur technique : on retentera au
                // prochain run (contrairement à une adresse volontairement masquée).
                if (echecs <= 3) console.warn(`   ⚠️ ${a.lien.slice(0, 70)} : ${e.message.split('\n')[0].slice(0, 50)}`);
            }

            // Écriture au fil de l'eau : un run interrompu garde son travail.
            if ((i + 1) % 20 === 0 || i === aTraiter.length - 1) {
                fs.writeFileSync(FICHIERS.cacheAdresses, JSON.stringify(cache, null, 2));
                process.stdout.write(`\r   ${i + 1}/${aTraiter.length} fiches visitées — ${trouvees} adresse(s), ${photos} photo(s)   `);
            }
        }
        console.log('');
        await nav.close();
        if (echecs) console.log(`   ⚠️ ${echecs} fiche(s) en erreur (retentées au prochain run).`);
    }

    /* --- Report du cache dans annonces.json -------------------------------- */

    let enrichis = 0;
    let rejetes = 0;
    let photosPosees = 0;
    let galeries = 0;
    for (const a of annonces) {
        const c = cache[a.lienCanonique];
        if (!c) continue;

        // La galerie sert au survol dans le dashboard. On passe la photo déjà
        // retenue sur la carte en tête des candidats : elle appartient à ce
        // bien de façon certaine, ce qui ancre le tri de construireGalerie —
        // et évite de la réafficher une seconde fois sous une autre taille.
        const galerie = construireGalerie([a.imageUrl, ...(c.images ?? [])], { max: 10 });
        if (!a.imageUrl && galerie.length) {
            a.imageUrl = galerie[0];
            photosPosees++;
        }
        if (galerie.length > 1) {
            a.photos = galerie;
            galeries++;
        }

        if (a.rue || !c.rue) continue;

        // Garde-fou : un code postal hors périmètre trahit presque toujours une
        // extraction ratée (numéro de rue pris pour un CP, ligne de
        // caractéristiques confondue avec une adresse). Dans le doute on
        // n'applique rien et le bien garde sa position communale, plutôt que
        // de le déplacer à tort sur la carte.
        if (c.cp && !CP_VERS_COMMUNE[c.cp]) {
            rejetes++;
            continue;
        }

        a.rue = c.rue;
        a.adresse = [c.rue, [c.cp, c.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        // cp et commune doivent rester cohérents : la fiche de détail fait foi
        // sur la liste de résultats, mais on ne met à jour QUE si les deux
        // peuvent l'être ensemble.
        if (c.cp && CP_VERS_COMMUNE[c.cp]) {
            a.cp = c.cp;
            a.commune = CP_VERS_COMMUNE[c.cp];
            a.region = regionDuCp(c.cp);
        }
        a.adresseExacte = true;
        enrichis++;
    }
    if (rejetes) console.log(`   ⚠️ ${rejetes} adresse(s) écartée(s) : code postal hors périmètre (extraction douteuse).`);

    fs.writeFileSync(FICHIERS.annonces, JSON.stringify(annonces, null, 2));

    const avecAdresse = annonces.filter((a) => a.rue).length;
    const avecPhoto = annonces.filter((a) => a.imageUrl).length;
    const pct = Math.round((avecAdresse / Math.max(annonces.length, 1)) * 100);
    console.log(`   ✅ ${enrichis} adresse(s), ${photosPosees} photo(s) et ${galeries} galerie(s) ajoutée(s) ce run.`);
    console.log(`   → ${avecAdresse}/${annonces.length} (${pct} %) avec adresse exacte, ${avecPhoto}/${annonces.length} avec photo.`);
    console.log(`   → relance « npm run dashboard » pour recalculer positions et distances.`);

    return { annonces, enrichis, avecAdresse, photosPosees, avecPhoto, galeries };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const limite = process.argv.includes('--limite') ? Number(process.argv[process.argv.indexOf('--limite') + 1]) : Infinity;
    // --sans-visite : rejouer la sélection sur le cache, sans réseau.
    await enrichirAdresses({ limite, visiter: !process.argv.includes('--sans-visite') });
}
