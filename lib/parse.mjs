/**
 * Parsing des annonces à partir des fragments de texte récoltés par le navigateur.
 *
 * Tout est ici en fonctions pures : aucun accès réseau, aucun DOM. C'est ce qui
 * permet de corriger une regex et de relancer `npm run reparse` sur
 * annonces-brutes.json sans re-scraper les 4 portails.
 */

import { CP_VERS_COMMUNE, estDansPerimetre } from '../config.mjs';

/* ============================================================
   1. NETTOYAGE DES FRAGMENTS
   ============================================================ */

/**
 * Bruit d'interface récurrent sur les cartes (carrousels, boutons).
 * Sans "Ajouter aux favoris" dans cette liste, 13 annonces ERA prenaient ce
 * libellé de bouton pour titre : leur carte n'affiche pas de titre éditorial
 * mais un bandeau "*** SOUS-OPTION ***".
 */
const FRAGMENTS_BRUIT = [
    /^(previous|next|vorige|volgende|précédent|suivant)$/i,
    /^\d+\s*\/\s*\d+$/, // "1 / 24" = compteur de photos
    /^\/$/, // séparateur du compteur, arrivé en fragment isolé
    /^(nouveau|nouvelle construction|new|nieuw|exclusivité|exclusief)$/i,
    /^(voir|bekijk|plus d'infos|meer info|en savoir plus|show more|lire la suite)/i,
    /^(favori|favoriet|partager|share)$/i,
    /^ajouter\s+aux?\s+favoris$/i,
    /^(toevoegen\s+aan\s+favorieten|add\s+to\s+favou?rites)$/i,
    /^\**\s*sous[\s-]*option\s*\**$/i, // "*** SOUS-OPTION ***"
    /^\**\s*(vendu|verkocht)\s*\**$/i,
    /^(à vendre|te koop|for sale)$/i,
    // "Maison à vendre" est le libellé de rubrique d'Immovlan, pas un titre :
    // le laisser passer donnait ce texte comme titre à toutes ses annonces,
    // alors que le titre fabriqué ("Maison 3 ch. à Carnières") est plus utile.
    /^(maison|villa|appartement|immeuble|bien|woning|huis|house)\s+(à vendre|te koop|for sale)$/i,
    /^(best of|top|coup de c(?:oe|œ)ur|à la une|uitgelicht|sponsorisé|sponsored)$/i, // encarts promotionnels
    /^(contacter|détails|e-mail|appeler|contact|bellen|details)$/i, // boutons d'action Immovlan
    // Immoweb duplique chaque unité en toutes lettres pour l'accessibilité,
    // dans un fragment séparé de la valeur ("265" / "m²" / "mètres carrés") :
    // sans ce filtre, "mètres carrés" (13 caractères, sans chiffre ni €)
    // passait pour un candidat-titre valable.
    /^(mètres? carrés?|vierkante meters?|square met(?:er|re)s?)$/i,
];

/**
 * Rejette ce qui n'est pas du texte d'annonce. Constaté en production :
 *  - des blobs binaires (en-tête JFIF d'images embarquées dans le DOM d'ERA)
 *  - du CSS interne d'icônes SVG (".st0{fill:#FFB000;}" chez Zimmo)
 * Les deux polluaient le parsing et gonflaient le fichier de données brutes.
 */
// Caracteres de controle C0/C1 (hors espaces, deja normalises) et U+FFFD,
// signature de donnees binaires arrivees dans le DOM.
const CARACTERES_BINAIRES = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\ufffd]');

function estTechnique(f) {
    if (f.length > 300) return true;
    // caractères de contrôle ou de remplacement = données binaires
    if (CARACTERES_BINAIRES.test(f)) return true;
    // fragment de feuille de style
    if (/\{[^}]*(?:fill|display|color|font|margin|padding)\s*:/.test(f)) return true;
    // moins de 30 % de caractères alphanumériques sur un fragment long
    if (f.length > 25 && (f.match(/[a-zA-Z0-9À-ÿ]/g) ?? []).length / f.length < 0.3) return true;
    return false;
}

/**
 * Libellé d'unité seul, sans sa valeur. Immovlan met la valeur et son unité
 * dans deux éléments distincts : "154" puis "m²", "3" puis "Chambre(s)".
 * Recollés, ils redeviennent lisibles par les parseurs habituels.
 */
const LIBELLE_SEUL = /^(?:m(?:²|2)|ares?|chambres?\(?s?\)?|slaapkamers?\(?s?\)?|bedrooms?|salles?\(?s?\)?\s*de\s*bains?|badkamers?\(?s?\)?|bathrooms?)$/i;

/** Une valeur nue, éventuellement une fourchette ("3", "195", "3 - 4"). */
const VALEUR_NUE = /^\d{1,5}(?:[.,]\d+)?(?:\s*-\s*\d{1,5}(?:[.,]\d+)?)?$/;

/**
 * Qualificatif de surface placé APRÈS sa valeur, chez Immovlan :
 *   ["171 m²", "188 m²", "Surface constructible"]
 * Sans recollage, les deux valeurs paraissent non libellées et la seconde
 * pouvait être prise pour la surface habitable.
 */
const QUALIFICATIF_SURFACE = /^surface\s+(?:constructible|habitable|du\s+terrain|de\s+terrain|au\s+sol)$/i;
const CONTIENT_SURFACE = /\d\s*m(?:²|\^2|2(?!\d))/i;

function recollerValeursEtLibelles(fragments) {
    const out = [];
    for (let i = 0; i < fragments.length; i++) {
        const f = fragments[i];
        const suivant = fragments[i + 1];

        // "154" + "m²"  →  "154 m²"
        if (VALEUR_NUE.test(f) && suivant && LIBELLE_SEUL.test(suivant)) {
            out.push(`${f} ${suivant}`);
            i++;
            continue;
        }
        // "188 m²" + "Surface constructible"  →  "188 m² Surface constructible"
        if (CONTIENT_SURFACE.test(f) && suivant && QUALIFICATIF_SURFACE.test(suivant)) {
            out.push(`${f} ${suivant}`);
            i++;
            continue;
        }
        out.push(f);
    }
    return out;
}

// Immoweb sépare parfois ses faits par un point médian décoratif, tantôt en
// fragment isolé ("·"), tantôt collé à la valeur suivante ("· 241"). Ni l'un
// ni l'autre ne porte de sens : sans ce nettoyage, "· 241" ne matchait pas
// VALEUR_NUE et ne pouvait donc pas se recoller avec le "m²" qui suit.
const PUCE_DECORATIVE = /^[·•‣▪]\s*/;

export function nettoyerFragments(fragments) {
    const out = [];
    for (const brut of fragments ?? []) {
        const f = String(brut).replace(/\s+/g, ' ').trim().replace(PUCE_DECORATIVE, '');
        if (!f) continue;
        if (estTechnique(f)) continue;
        if (FRAGMENTS_BRUIT.some((r) => r.test(f))) continue;
        // évite les répétitions consécutives (fréquent avec les libellés dupliqués mobile/desktop)
        if (out.length && out[out.length - 1].toLowerCase() === f.toLowerCase()) continue;
        out.push(f);
    }
    return recollerValeursEtLibelles(out);
}

/* ============================================================
   2. PRIX
   ============================================================ */

const PRIX_MIN_PLAUSIBLE = 25000;
const PRIX_MAX_PLAUSIBLE = 20000000;

/**
 * Gère "€ 413.500", "395.000 €", "€ 375 000", "449.900".
 * Le séparateur peut être un point, une espace ou une espace insécable :
 * on retire tout, car en Belgique aucun prix immobilier n'a de décimales.
 */
export function parsePrix(texte) {
    if (!texte) return null;
    if (/prix\s*sur\s*demande|op\s*aanvraag|on\s*request/i.test(texte)) return null;

    // \u00a0 = espace insecable, \u202f = espace fine insecable : les deux servent
    // de separateur de milliers dans les prix belges ("375 000 €").
    const CHIFFRES = "[\\d][\\d.,'\\s\\u00a0\\u202f]*";
    const motifs = [
        new RegExp(`(?:€|EUR)\\s*(${CHIFFRES})`, 'i'), // € 413.500
        new RegExp(`(${CHIFFRES})\\s*(?:€|EUR)`, 'i'), // 395.000 €
    ];

    for (const motif of motifs) {
        const m = texte.match(motif);
        if (!m) continue;
        const valeur = normaliserNombre(m[1]);
        if (valeur >= PRIX_MIN_PLAUSIBLE && valeur <= PRIX_MAX_PLAUSIBLE) return valeur;
    }
    return null;
}

/** "413.500" / "375 000" / "1.250,00" → entier. */
function normaliserNombre(brut) {
    const nettoye = String(brut)
        .replace(/[\s  ']/g, '')
        .replace(/,\d{1,2}$/, '') // décimales éventuelles → ignorées
        .replace(/[.,]/g, '');
    const n = parseInt(nettoye, 10);
    return Number.isFinite(n) ? n : NaN;
}

export function trouverPrix(fragments) {
    for (const f of fragments) {
        const p = parsePrix(f);
        if (p != null) return p;
    }
    return null;
}

/* ============================================================
   3. LOCALISATION
   ============================================================ */

const SUFFIXES_RUE = /(?:straat|laan|weg|steenweg|dreef|baan|plein|square|rue|avenue|chauss[ée]e|boulevard|chemin|clos|drève|place|route|all[ée]e)/i;

/**
 * Un fragment isolé est-il une rue ? Nécessaire parce que Zimmo place la rue et
 * le code postal dans DEUX fragments séparés ("Zwijndrechtsestraat 23" puis
 * "2070 Burcht"), là où ERA les réunit.
 */
function estProbablementUneRue(f) {
    if (!f) return false;
    if (/\b[1-9]\d{3}\b/.test(f)) return false; // contient un CP : c'est la ligne localité
    if (/(?:€|EUR)|m(?:²|\^2)|\bkwh\b/i.test(f)) return false; // prix ou surface
    if (/adresse\s*sur\s*demande|address\s*on\s*request|op\s*aanvraag/i.test(f)) return false;
    if (/\b(?:chambres?|slaapkamers?|bedrooms?|chbres?|sdb|salles?\s*de\s*bains?)\b/i.test(f)) return false;
    if (/^\d+\s*(?:j|jours?|d|dagen)$/i.test(f)) return false; // ancienneté
    if (/\b(?:vendu|verkocht|option|optie|r[ée]serv)/i.test(f)) return false; // statut
    if (/\b(?:maison|villa|appartement|woning|huis)\b.*\b(?:vendre|koop|louer)\b/i.test(f)) return false; // "Maison à vendre"

    const lettres = f.match(/[A-Za-zÀ-ÖØ-öø-ÿ]{3,}/g) ?? [];
    if (!lettres.length) return false;
    // Une rue porte un numéro, ou au moins un suffixe de voirie reconnaissable.
    return /\d/.test(f) || SUFFIXES_RUE.test(f);
}

/**
 * Extrait code postal + localité + rue. Trois formes rencontrées :
 *   - "1420 Braine-l'Alleud"                  (Trevi, Century21 : CP+ville groupés)
 *   - "1800" puis "Vilvoorde"                 (Century21 : CP seul dans son fragment)
 *   - "Koningin Astridstraat 39, 1730 Asse"   (ERA : rue + CP dans le même fragment)
 *   - "Zwijndrechtsestraat 23" puis "2070 Burcht"  (Zimmo : rue à part)
 */
export function parseLocalisation(fragments) {
    for (const [i, f] of fragments.entries()) {
        const m = f.match(/\b([1-9]\d{3})\b[\s,]*([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’\-\s.]*)?/);
        if (!m) continue;

        const cp = m[1];
        let ville = (m[2] ?? '').trim().split(/[,(]/)[0].trim();

        // Century21 : le CP est seul dans son fragment, la ville est le suivant.
        if (!ville && fragments[i + 1] && /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’\-\s.]{1,40}$/.test(fragments[i + 1])) {
            ville = fragments[i + 1].trim();
        }

        // La rue précède le CP, dans le même fragment (ERA) ou dans le précédent (Zimmo).
        const avantCp = f.slice(0, m.index).replace(/[\s,]+$/, '').trim();
        let rue = avantCp.length > 3 ? avantCp : null;
        if (!rue && estProbablementUneRue(fragments[i - 1])) rue = fragments[i - 1].trim();

        return {
            cp,
            ville: ville || CP_VERS_COMMUNE[cp] || null,
            rue: rue || null,
            adresse: rue && !avantCp ? `${rue}, ${f}` : f,
        };
    }
    return { cp: null, ville: null, rue: null, adresse: null };
}

/**
 * Repli quand le CP n'apparaît nulle part dans le texte de la carte (Trior :
 * les cartes n'affichent que "Waterloo", jamais "1410 Waterloo"), mais
 * figure dans l'URL de l'annonce : ".../maison/1410-waterloo/7854102".
 */
const MOTIF_CP_LIEN = /\/(\d{4})-([a-z0-9'-]+)(?:\/|$)/i;

export function parseCpEtVilleDepuisLien(lien) {
    if (!lien) return null;
    let pathname;
    try {
        pathname = new URL(lien).pathname;
    } catch {
        pathname = String(lien);
    }
    const m = pathname.match(MOTIF_CP_LIEN);
    if (!m) return null;
    const cp = m[1];
    const villeSlug = m[2].replace(/-/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    return { cp, ville: CP_VERS_COMMUNE[cp] ?? villeSlug };
}

/* ============================================================
   4. SURFACES
   ============================================================
   Le piège : une carte affiche souvent deux valeurs en m² (habitable et
   terrain). L'ancienne logique prenait le premier `m²` rencontré, d'où des
   "295 m² habitables" chez Trevi qui étaient en réalité la surface du terrain.
   On classe donc chaque valeur d'après les mots qui l'entourent.
   ============================================================ */

// Testé en premier : "surface constructible" contient aussi "surface", donc
// MOTS_HABITABLE l'attraperait à tort.
const MOTS_CONSTRUCTIBLE = /constructible|bebouwbare|buildable/i;
const MOTS_TERRAIN = /terrain|grond|perceel|jardin|tuin|plot|land|oppervlakte\s*grond/i;
const MOTS_HABITABLE = /habitable|hab\.|surf(?:ace)?|woonopp|bewoonbaar|woonoppervlakte|living|bâti|bebouwd/i;

/**
 * ERA écrit les grandes surfaces à l'anglaise : "1,829 m² de surface de
 * terrain" vaut 1829 m², pas 1,829. Lu comme un décimal, un terrain de
 * 1829 m² devenait 2 m².
 *
 * Règle : un séparateur suivi d'exactement trois chiffres est un séparateur de
 * milliers ; suivi d'un ou deux chiffres, c'est une décimale.
 */
function normaliserSurface(brut) {
    const s = String(brut).trim();
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return parseInt(s.replace(/[.,]/g, ''), 10);
    return Math.round(parseFloat(s.replace(',', '.')));
}

export function parseSurfaces(fragments, hints = {}) {
    const valeurs = [];

    for (const f of fragments) {
        // Pas de \b après "²" : ² n'est pas un caractère de mot, donc \b ne
        // matcherait jamais en fin de chaîne ("286 m²"). Pour la forme "m2" en
        // revanche il faut refuser un chiffre qui suit, sinon "m25" matcherait.
        const regex = /(\d+(?:[.,]\d+)*)\s*m(?:²|\^2|2(?!\d))/gi;
        let m;
        while ((m = regex.exec(f)) !== null) {
            const valeur = normaliserSurface(m[1]);
            if (!Number.isFinite(valeur) || valeur <= 0 || valeur > 100000) continue;
            // contexte = le fragment entier (les libellés sont courts sur les cartes)
            const type = MOTS_CONSTRUCTIBLE.test(f)
                ? 'constructible'
                : MOTS_TERRAIN.test(f)
                  ? 'terrain'
                  : MOTS_HABITABLE.test(f)
                    ? 'habitable'
                    : 'inconnu';
            valeurs.push({ valeur, type, contexte: f });
        }
    }

    const habitables = valeurs.filter((v) => v.type === 'habitable').map((v) => v.valeur);
    const terrains = valeurs.filter((v) => v.type === 'terrain').map((v) => v.valeur);
    const constructibles = valeurs.filter((v) => v.type === 'constructible').map((v) => v.valeur);
    const inconnues = valeurs.filter((v) => v.type === 'inconnu').map((v) => v.valeur);

    let habitable = habitables.length ? Math.min(...habitables) : null;
    let terrain = terrains.length ? Math.max(...terrains) : null;
    let ambigu = false;

    if (habitable == null && inconnues.length) {
        // La PREMIÈRE valeur non libellée est l'habitable : c'est l'ordre
        // d'affichage sur les quatre portails observés. Prendre la plus petite
        // (ancienne règle) inversait les colonnes d'Immovlan, qui donnait
        // 65 m² habitables pour une maison de 172 m² à Iddergem.
        habitable = inconnues[0];
        // Au-delà de deux valeurs non libellées, on ne sait plus laquelle est
        // laquelle : on le signale au lieu de deviner en silence.
        ambigu = inconnues.length > 2;
        if (terrain == null && inconnues.length === 2) terrain = inconnues[1];
    }

    // Garde-fou : un terrain plus petit que l'habitable est possible (maison
    // mitoyenne sur plusieurs niveaux), mais pas un habitable de 3000 m².
    if (habitable != null && habitable > 1500) {
        ambigu = true;
        habitable = null;
    }

    // Trior : un entier nu directement après la surface habitable est le
    // terrain en ares (1 are = 100 m²), une convention belge qui n'apparaît
    // dans aucun de nos autres portails — jamais de \b[terrain]/[jardin] ici.
    if (terrain == null && hints.terrainAresApresSurface) {
        for (let i = 0; i < fragments.length; i++) {
            if (/\d\s*m(?:²|\^2|2(?!\d))/i.test(fragments[i]) && /^\d{1,3}$/.test(fragments[i + 1] ?? '')) {
                terrain = parseInt(fragments[i + 1], 10) * 100;
                break;
            }
        }
    }

    return {
        surfaceHabitable: habitable,
        surfaceTerrain: terrain,
        // « Surface constructible » n'est ni l'habitable ni le terrain : c'est
        // l'emprise bâtissable. On la garde à part plutôt que de la faire
        // passer pour un jardin.
        surfaceConstructible: constructibles.length ? Math.max(...constructibles) : null,
        surfacesAmbigues: ambigu,
    };
}

/* ============================================================
   5. CHAMBRES ET SALLES DE BAIN
   ============================================================ */

// Libellés du plus explicite au plus court. L'abréviation "ch" est la plus
// risquée : elle est acceptée uniquement suivie d'un point ou d'une fin de mot,
// et jamais d'une lettre — sinon "2 chauffages" donnerait 2 chambres.
const MOTIFS_CHAMBRES = [
    /(\d+)\s*(?:chambres?|slaapkamers?|bedrooms?)/i,
    /(?:chambres?|slaapkamers?|bedrooms?)\s*:?\s*(\d+)/i,
    /(\d+)\s*(?:chbres?|chbre|slpk|bdr)\b/i,
    /(\d+)\s*ch(?:\.|\b)(?![a-zà-ÿ])/i,
];

// `\(?s?\)?` tolère la forme "Salle(s) de bain" d'Immovlan : sans ça,
// `salles?\s*de\s*bains?` butait sur le "(s)" intercalé.
const MOTIFS_SDB = [
    /(\d+)\s*(?:salles?\(?s?\)?\s*de\s*bains?|badkamers?\(?s?\)?|bathrooms?)/i,
    /(?:salles?\(?s?\)?\s*de\s*bains?|badkamers?\(?s?\)?|bathrooms?)\s*:?\s*(\d+)/i,
    /(\d+)\s*(?:sdb|sbd)\b/i,
];

function chercherNombreLabellise(fragments, motifs, max) {
    // Les fragments courts sont les champs structurés ("4 chambres") ; les longs
    // sont de la prose. On lit donc les courts d'abord, sinon le titre ERA
    // "Magnifique maison bel-étage 3 chambres..." écrasait la vraie valeur (4).
    const ordonnes = [...fragments].sort((a, b) => a.length - b.length);

    for (const f of ordonnes) {
        for (const motif of motifs) {
            const m = f.match(motif);
            if (!m) continue;
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > 0 && n <= max) return n;
        }
    }
    return null;
}

const EST_ENTIER_NU = (f) => /^\d{1,2}$/.test(f);
const EST_SURFACE = (f) => /\d+(?:[.,]\d+)?\s*m(?:²|\^2|2(?!\d))/i.test(f);

/**
 * Les nombres "nus" : certains portails affichent les pièces à côté d'une
 * icône, sans aucun libellé textuel.
 *
 * On les repère par leur position RELATIVE au fragment de surface, jamais par
 * leur rang absolu. Raison : le compteur de photos du carrousel Century21
 * arrive en fragments séparés ("1", "/", "30"), et prendre « les deux premiers
 * entiers » donnait 1 chambre et 30 salles de bain sur toutes ses annonces.
 */
function parseNombresNus(fragments, bareStats) {
    if (!bareStats?.champs?.length) return {};

    const iSurface = fragments.findIndex(EST_SURFACE);
    if (iSurface === -1) return {};

    // Entiers nus contigus, du côté indiqué, dans l'ordre de lecture.
    const nus = [];
    if (bareStats.position === 'avant-surface') {
        for (let i = iSurface - 1; i >= 0 && EST_ENTIER_NU(fragments[i]); i--) nus.unshift(parseInt(fragments[i], 10));
    } else {
        for (let i = iSurface + 1; i < fragments.length && EST_ENTIER_NU(fragments[i]); i++) nus.push(parseInt(fragments[i], 10));
    }

    const out = {};
    bareStats.champs.forEach((champ, i) => {
        if (nus[i] != null) out[champ] = nus[i];
    });
    return out;
}

export function parsePieces(fragments, { bareStats } = {}) {
    const nus = parseNombresNus(fragments, bareStats);
    return {
        chambres: chercherNombreLabellise(fragments, MOTIFS_CHAMBRES, 20) ?? nus.chambres ?? null,
        sallesDeBain: chercherNombreLabellise(fragments, MOTIFS_SDB, 10) ?? nus.sallesDeBain ?? null,
    };
}

/* ============================================================
   5 bis. STATUT DE VENTE ET ANCIENNETÉ
   ============================================================
   Constaté en production : 34 % des cartes récoltées concernent des biens
   déjà vendus ou sous option. Les portails les laissent dans les résultats de
   recherche. Un bien vendu n'est pas achetable : il n'a rien à faire dans le
   classement, et c'était la vraie cause des « prix manquants » (le prix
   disparaît de la carte une fois le bien vendu).
   ============================================================ */

// Pas de \b final derrière une lettre accentuée : \b se base sur [A-Za-z0-9_],
// donc « réservé » suivi de la fin de chaîne n'offre aucune frontière et le
// motif ne matchait jamais. On utilise un lookahead à la place.
const MOTIFS_STATUT = [
    ['vendu', /\bvendus?\b|\bvendues?\b|\bverkocht\b|\bsold\b/i],
    // "SOUS-OPTION" avec un tiret est la forme la plus fréquente chez ERA :
    // exiger une espace ne matchait pas.
    ['option', /\b(?:sous|en|onder|in)[\s-]+opti(?:on|e)\b|^\**\s*opti(?:on|e)\s*\**$/i],
    ['reserve', /\br[ée]serv[ée]e?(?![a-zà-ÿ])|\bgereserveerd\b/i],
];

export function parseStatut(fragments) {
    for (const f of fragments) {
        for (const [statut, motif] of MOTIFS_STATUT) {
            if (motif.test(f)) return statut;
        }
    }
    return 'disponible';
}

/**
 * Zimmo affiche l'ancienneté de l'annonce ("17j"). C'est un signal de
 * négociation : un bien en ligne depuis 200 jours ne part pas à son prix.
 */
export function parseJoursEnLigne(fragments) {
    for (const f of fragments) {
        const m = f.match(/^(\d{1,4})\s*(?:j|jours?|d|dagen|days?)$/i);
        if (m) return parseInt(m[1], 10);
    }
    return null;
}

/* ============================================================
   6. TYPE DE BIEN ET TITRE
   ============================================================ */

const TYPES_BIEN = [
    ['Maison', /\bmaisons?\b|\bwoning\b|\bhuis\b|\bhouse\b/i],
    ['Villa', /\bvillas?\b/i],
    ['Maison de maître', /maison\s*de\s*ma[îi]tre|herenhuis/i],
    ['Fermette', /fermette|hoeve|ferme\b/i],
    ['Bungalow', /bungalow/i],
    // Placé avant "Appartement" pour porter son propre libellé plutôt que
    // d'être noyé dans la catégorie générique — les deux sont de toute façon
    // exclus ensemble en aval (voir EXCLUS_HORS_MAISON dans parse_annonces.mjs).
    // Vu classé "Maison" à tort chez ERA : son URL place TOUT sous /maison/,
    // y compris ses immeubles mixtes — un repli qui ne dit donc rien de fiable
    // pour ce portail. Le texte, lui, est explicite et passe en premier.
    ['Immeuble mixte', /immeubles?\s+mixtes?/i],
    ['Appartement', /appartements?\b|\bflat\b/i],
    ['Terrain', /terrain\s*à\s*b[âa]tir|bouwgrond/i],
];

/**
 * Le type est parfois absent du texte de la carte (annonces ERA sous option,
 * qui remplacent le titre par un bandeau de statut). Les quatre portails le
 * placent dans l'URL de l'annonce, ce qui fait un repli fiable :
 *   era.be/fr/a-vendre/nivelles/maison/...   century21.be/fr/properiete/a-vendre/maison/...
 *   trevi.be/fr/bien/7222927/41/maison/...   zimmo.be/fr/asse-1730/a-vendre/maison/...
 */
export function parseTypeBien(fragments, lien = null) {
    const texte = fragments.join(' ');
    for (const [nom, motif] of TYPES_BIEN) {
        if (motif.test(texte)) return nom;
    }
    if (lien) {
        // On ne teste que les segments de chemin, pour éviter qu'un nom de
        // commune ou un paramètre ne déclenche une correspondance fortuite.
        let segments = [];
        try {
            segments = new URL(lien).pathname.split('/').filter(Boolean);
        } catch {
            segments = String(lien).split('/').filter(Boolean);
        }
        for (const [nom, motif] of TYPES_BIEN) {
            if (segments.some((s) => motif.test(decodeURIComponent(s).replace(/-/g, ' ')))) return nom;
        }
    }
    return null;
}

/**
 * Titre : on privilégie le fragment descriptif le plus long, à condition qu'il
 * ne soit pas qu'un prix, une surface ou une adresse. Century21 et Trevi n'ont
 * aucun titre éditorial sur leurs cartes — on en fabrique un lisible plutôt que
 * d'afficher "Titre non spécifié".
 */
export function parseTitre(fragments, { typeBien, ville, chambres }) {
    const nomsLieu = new Set([ville, typeBien].filter(Boolean).map((s) => s.toLowerCase()));
    const candidats = fragments.filter(
        (f) =>
            // Un fragment qui n'est que le nom de la localité n'est pas un
            // titre : une carte Immovlan sans titre donnait "Liedekerke".
            !nomsLieu.has(f.toLowerCase()) &&
            f.length >= 10 &&
            f.length <= 160 &&
            /[a-zà-ÿ]{4}/i.test(f) &&
            !/(?:€|EUR)\s*[\d]/.test(f) &&
            !/^\d/.test(f) &&
            !/\bm(?:²|2)\b/.test(f) &&
            // Un fragment contenant un code postal est l'adresse, pas un titre :
            // sans ce filtre "Rue Haute 12, 1410 Waterloo" gagnait par sa longueur.
            !/\b[1-9]\d{3}\b/.test(f),
    );
    if (candidats.length) return candidats.sort((a, b) => b.length - a.length)[0];

    const morceaux = [typeBien ?? 'Bien'];
    if (chambres) morceaux.push(`${chambres} ch.`);
    if (ville) morceaux.push(`à ${ville}`);
    return morceaux.join(' ');
}

/* ============================================================
   7. PEB / EPC
   ============================================================
   Très structurant en Belgique (obligation de rénovation en Flandre).
   ============================================================ */

export function parsePeb(fragments, { pebNu = false } = {}) {
    // 1. Forme libellée : "PEB : B", "EPC C"
    for (const f of fragments) {
        const m = f.match(/\b(?:peb|epc|epb)\b\s*:?\s*([A-G](?:\+{1,3})?)\b/i);
        if (m) return m[1].toUpperCase();
    }
    // 2. Consommation chiffrée
    for (const f of fragments) {
        const m = f.match(/(\d{2,4})\s*kwh\s*\/\s*m(?:²|2)/i);
        if (m) return `${m[1]} kWh/m²`;
    }
    // 3. Lettre seule, sans libellé (ERA). Réservé aux portails où c'est la
    // convention observée : ailleurs, une lettre isolée serait ambiguë.
    // On part de la fin, le PEB clôturant la carte.
    if (pebNu) {
        for (let i = fragments.length - 1; i >= 0; i--) {
            const m = fragments[i].match(/^([A-G])(\+{1,3})?$/);
            if (m) return (m[1] + (m[2] ?? '')).toUpperCase();
        }
    }
    return null;
}

/* ============================================================
   8. ASSEMBLAGE
   ============================================================ */

/** Un lien d'annonce sans ses paramètres de tracking/recherche. */
export function canoniserLien(lien) {
    if (!lien) return null;
    try {
        const u = new URL(lien);
        u.search = '';
        u.hash = '';
        return u.toString().replace(/\/$/, '');
    } catch {
        return lien;
    }
}

/**
 * Transforme une carte brute (fragments + lien + image) en annonce structurée.
 * `champsManquants` est exploité par le dashboard pour signaler honnêtement
 * ce qui n'a pas pu être extrait, au lieu d'afficher un score trompeur.
 */
export function construireAnnonce(brute, hints = {}) {
    const fragments = nettoyerFragments(brute.fragments);

    // Le statut se lit sur les fragments BRUTS : nettoyerFragments retire
    // justement les bandeaux "*** SOUS-OPTION ***" et "Vendu" (qui étaient pris
    // pour des titres), donc les chercher après nettoyage ne trouverait rien.
    const statut = parseStatut(brute.fragments ?? []);

    const prix = trouverPrix(fragments);
    let { cp, ville, rue, adresse } = parseLocalisation(fragments);
    // Trior n'affiche le CP dans aucun fragment texte ("Waterloo" seul) : il
    // faut le lire dans l'URL de l'annonce.
    if (cp == null && hints.cpDansLien) {
        const depuisLien = parseCpEtVilleDepuisLien(brute.lien);
        if (depuisLien) {
            cp = depuisLien.cp;
            ville = ville ?? depuisLien.ville;
            adresse = adresse ?? depuisLien.ville;
        }
    }
    const { surfaceHabitable, surfaceTerrain, surfaceConstructible, surfacesAmbigues } = parseSurfaces(fragments, hints);
    const { chambres, sallesDeBain } = parsePieces(fragments, hints);
    const typeBien = parseTypeBien(fragments, brute.lien);
    const peb = parsePeb(fragments, hints);
    const joursEnLigne = parseJoursEnLigne(fragments);
    // "À partir de € 450 000" : prix de départ (projet neuf, lot). Le montant
    // est exploitable mais ce n'est pas un prix ferme — on le signale.
    // "àpd" est l'abréviation utilisée par Immovlan pour « à partir de ».
    const prixAPartirDe = (brute.fragments ?? []).some((f) => /[àa]\s*partir\s*de|^àpd$|\bvanaf\b|\bfrom\s*€/i.test(String(f).trim()));
    // Immovlan signale explicitement les annonces dont le prix a bougé : c'est
    // le seul indice de baisse disponible sans historique de notre côté.
    const prixModifie = (brute.fragments ?? []).some((f) => /^prix\s*modifi[ée]|prijs\s*gewijzigd|price\s*changed/i.test(String(f).trim()));
    // Trior l'affiche sur ses appartements neufs : le montant exclut des frais
    // (agence ou notaire), donc pas directement comparable au prix affiché
    // ailleurs. Comme prixModifie/prixAPartirDe, un simple signal, pas un filtre.
    const prixHorsFrais = (brute.fragments ?? []).some((f) => /^hors\s*frais$|^excl(?:usief|\.)?\s*frais/i.test(String(f).trim()));
    // Vu sur Immoweb ("150 000 € + 3 125 €/mois") : vente en rente viagère,
    // un bouquet initial plus une mensualité jusqu'au décès du vendeur. Le
    // prix qu'on lit n'est que le bouquet — pas comparable à un achat classique.
    const venteViagere = (brute.fragments ?? []).some((f) => /rente\s+viag[eè]re|\bviager\b/i.test(String(f)));
    const titre = parseTitre(fragments, { typeBien, ville, chambres });

    const champsManquants = [];
    // Un bien vendu n'affiche plus son prix : ce n'est pas un défaut de
    // parsing, inutile de le signaler comme tel.
    if (prix == null && statut !== 'vendu') champsManquants.push('prix');
    if (cp == null) champsManquants.push('localisation');
    if (surfaceHabitable == null) champsManquants.push('surfaceHabitable');
    if (chambres == null) champsManquants.push('chambres');
    if (surfacesAmbigues) champsManquants.push('surfacesAmbigues');

    return {
        titre,
        typeBien,
        statut,
        joursEnLigne,
        prix,
        prixAPartirDe,
        prixModifie,
        prixHorsFrais,
        venteViagere,
        prixM2: prix && surfaceHabitable ? Math.round(prix / surfaceHabitable) : null,
        cp,
        ville,
        rue,
        adresse,
        commune: cp ? (CP_VERS_COMMUNE[cp] ?? ville ?? null) : null,
        dansPerimetre: estDansPerimetre(cp),
        chambres,
        sallesDeBain,
        surfaceHabitable,
        surfaceTerrain,
        surfaceConstructible,
        peb,
        imageUrl: brute.imageUrl ?? null,
        lien: brute.lien,
        lienCanonique: canoniserLien(brute.lien),
        source: brute.source,
        dateExtraction: brute.dateExtraction,
        champsManquants,
        fragments, // conservés : utiles pour diagnostiquer un parsing raté
    };
}

/* ============================================================
   9. DÉDUPLICATION INTER-SITES
   ============================================================
   Un même bien est souvent publié sur plusieurs portails. Dédupliquer par lien
   ne le voit pas. On applique donc trois passes, de la plus sûre à la plus large.
   ============================================================ */

function slug(s) {
    return (s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

/** Clé forte : même rue + même numéro + même CP = même bien, quasi certain. */
function cleForte(a) {
    if (!a.cp || !a.rue) return null;
    const numero = a.rue.match(/\d+[a-z]?/i)?.[0];
    if (!numero) return null;
    const nomRue = slug(a.rue.replace(/\d+[a-z]?/gi, ''));
    if (nomRue.length < 4) return null;
    return `rue:${a.cp}|${nomRue}|${numero.toLowerCase()}`;
}

/**
 * Clé faible : mêmes caractéristiques chiffrées dans la même commune.
 *
 * ⚠️ Ne sert QU'au rapprochement entre portails différents (voir
 * `grouperParCaracteristiques`). Au sein d'un même portail, deux annonces aux
 * mêmes chiffres sont presque toujours deux lots distincts d'un projet neuf,
 * pas un doublon : appliquer cette clé sans distinction fusionnait 3 annonces
 * Century21 à Genappe en une seule, faisant disparaître 2 biens réels.
 */
function cleFaible(a) {
    if (!a.cp || !a.prix || !a.surfaceHabitable) return null;
    // Prix arrondi à 5 000 € près : les portails affichent parfois des montants
    // légèrement différents pour un même bien (frais d'agence inclus ou non).
    return `car:${a.cp}|${a.surfaceHabitable}|${Math.round(a.prix / 5000)}|${a.chambres ?? '?'}`;
}

/** Nombre de champs utiles renseignés : sert à choisir le meilleur exemplaire. */
function richesse(a) {
    return ['prix', 'surfaceHabitable', 'surfaceTerrain', 'chambres', 'sallesDeBain', 'rue', 'peb', 'imageUrl', 'typeBien'].filter(
        (k) => a[k] != null,
    ).length;
}

function fusionner(groupe) {
    const trie = [...groupe].sort((a, b) => richesse(b) - richesse(a));
    const principal = { ...trie[0] };

    // On complète les trous du meilleur exemplaire avec les autres.
    for (const autre of trie.slice(1)) {
        for (const [k, v] of Object.entries(autre)) {
            if (principal[k] == null && v != null) principal[k] = v;
        }
    }

    // La déduplication se fait en trois passes successives, donc un exemplaire
    // du groupe peut DÉJÀ être le résultat d'une fusion. On lit `sources` et
    // `autresLiens` quand ils existent, sinon on perdrait les portails
    // rassemblés à la passe précédente.
    const sources = [...new Set(groupe.flatMap((a) => a.sources ?? [a.source]))].filter(Boolean);
    principal.sources = sources;
    principal.multiSource = sources.length > 1;

    const liensConnus = new Map();
    for (const a of groupe) {
        for (const l of a.autresLiens ?? []) liensConnus.set(l.lien, l);
        if (a.lienCanonique !== principal.lienCanonique) liensConnus.set(a.lien, { source: a.source, lien: a.lien });
    }
    liensConnus.delete(principal.lien);
    principal.autresLiens = [...liensConnus.values()];
    principal.champsManquants = principal.champsManquants.filter((c) => {
        if (c === 'prix') return principal.prix == null;
        if (c === 'localisation') return principal.cp == null;
        if (c === 'surfaceHabitable') return principal.surfaceHabitable == null;
        if (c === 'chambres') return principal.chambres == null;
        return true;
    });
    if (principal.prix && principal.surfaceHabitable) {
        principal.prixM2 = Math.round(principal.prix / principal.surfaceHabitable);
    }
    return principal;
}

function grouperPar(annonces, cleFn, { seulementInterPortails = false } = {}) {
    const groupes = new Map();
    const sansCle = [];
    for (const a of annonces) {
        const cle = cleFn(a);
        if (!cle) {
            sansCle.push(a);
            continue;
        }
        if (!groupes.has(cle)) groupes.set(cle, []);
        groupes.get(cle).push(a);
    }

    const sortie = [...sansCle];
    for (const groupe of groupes.values()) {
        if (groupe.length === 1) {
            sortie.push(groupe[0]);
            continue;
        }
        const portails = new Set(groupe.flatMap((a) => a.sources ?? [a.source]));
        if (seulementInterPortails && portails.size < 2) {
            // Un seul portail : probablement des lots distincts d'un même
            // projet, on ne fusionne pas — mais on les signale l'un à l'autre
            // pour que le dashboard puisse prévenir, sans rien masquer.
            for (const a of groupe) {
                a.doublonPotentiel = groupe.filter((b) => b.lien !== a.lien).map((b) => b.lien);
            }
            sortie.push(...groupe);
            continue;
        }
        sortie.push(fusionner(groupe));
    }
    return sortie;
}

export function dedupliquer(annonces) {
    const avant = annonces.length;

    // Passe 1 : lien canonique (le même bien vu deux fois sur le même portail).
    const parLien = new Map();
    for (const a of annonces) {
        const cle = a.lienCanonique ?? `${a.source}|${a.titre}|${a.adresse}`;
        if (!parLien.has(cle)) parLien.set(cle, []);
        parLien.get(cle).push(a);
    }
    let resultat = [...parLien.values()].map((g) => (g.length > 1 ? fusionner(g) : g[0]));
    const apresLien = resultat.length;

    // Passe 2 : même rue + même numéro + même CP. Une adresse complète
    // identifie un bien de façon assez fiable pour fusionner même au sein d'un
    // seul portail (annonce republiée).
    resultat = grouperPar(resultat, cleForte);
    const apresRue = resultat.length;

    // Passe 3 : mêmes caractéristiques chiffrées, mais UNIQUEMENT entre
    // portails différents — voir le commentaire de cleFaible.
    resultat = grouperPar(resultat, cleFaible, { seulementInterPortails: true });

    return {
        annonces: resultat,
        stats: {
            avant,
            doublonsMemeLien: avant - apresLien,
            doublonsMemeAdresse: apresLien - apresRue,
            doublonsMemesCaracteristiques: apresRue - resultat.length,
            apres: resultat.length,
        },
    };
}
