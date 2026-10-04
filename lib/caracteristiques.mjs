/**
 * Caractéristiques lues sur la page de détail d'une annonce.
 *
 * Ce que les pages de résultats ne donnent jamais : année de construction,
 * état du bien, nombre de façades, PEB en kWh/m²/an, revenu cadastral. Le
 * revenu cadastral détermine le précompte immobilier, un coût annuel
 * récurrent ; le PEB chiffré est comparable entre régions là où la lettre
 * seule ne l'est pas (les barèmes diffèrent).
 *
 * Fonctions pures : elles ne reçoivent que du texte déjà récolté, ce qui
 * permet de corriger l'extraction sans revisiter la moindre fiche
 * (`node enrichir_adresses.mjs --sans-visite`).
 *
 * Les portails exposent ces faits sous TROIS formes, d'où les trois passes :
 *  1. paires structurées `<tr>`/`<dl>` — Immoweb, Trior, Trevi ;
 *  2. libellé et valeur sur la MÊME ligne de texte — Immoweb, Zimmo, et
 *     Trior qui colle deux paires bout à bout (« 1850Parking extérieur Oui ») ;
 *  3. libellé seul, valeur sur la ligne SUIVANTE — Immovlan, ERA, Century21.
 */

const ANNEE_MAX = new Date().getFullYear() + 3;

/** Sans accents ni casse : les libellés varient d'un portail à l'autre. */
function normaliser(s) {
    return String(s ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Le portail affiche explicitement qu'il ne sait pas : ne rien inventer. */
const VIDE = /^(non communique|non specifie|non renseigne|niet meegedeeld|onbekend|n\/?a|-{1,3}|\.{1,3})$/;

function estVide(v) {
    const n = normaliser(v);
    return !n || VIDE.test(n);
}

/**
 * Un entier borné. Les bornes ne sont pas décoratives : Century21 annonce
 * une année de construction « 1111 », et son libellé « Façades » est suivi
 * de « 420 m² » (c'est la surface du terrain, mal appariée) — sans plage de
 * validité, on enregistrerait une maison à 420 façades bâtie au XIIe siècle.
 */
function entierBorne(texte, min, max) {
    for (const m of String(texte).matchAll(/\d[\d\s.,]*/g)) {
        const n = Number(m[0].replace(/[\s.,]/g, ''));
        if (Number.isInteger(n) && n >= min && n <= max) return n;
    }
    return null;
}

/** Montant en euros. Formes vues : « 1 016 € » (Immovlan), « €1730,00 » (ERA). */
function euros(texte) {
    const m = String(texte).match(/(\d[\d\s.]*)(?:[,.](\d{1,2}))?/);
    if (!m) return null;
    const n = Number(m[1].replace(/[\s.]/g, ''));
    // Plancher à 50 € : en dessous, ce n'est pas un revenu cadastral
    // d'habitation mais un fragment de numéro ramassé par erreur.
    return Number.isFinite(n) && n >= 50 && n <= 50000 ? n : null;
}

/**
 * Les champs recherchés. `libelles` sont des préfixes normalisés ; l'ordre
 * compte, le plus spécifique d'abord (« nombre de façades » avant « façades »).
 */
const CHAMPS = [
    {
        cle: 'anneeConstruction',
        libelles: ['annee de construction', 'annee de la construction', 'bouwjaar', 'construction'],
        lire: (v) => entierBorne(v, 1700, ANNEE_MAX),
    },
    {
        cle: 'facades',
        libelles: ['nombre de facades', 'aantal gevels', 'facades', 'gevels'],
        lire: (v) => entierBorne(v, 1, 6),
    },
    {
        cle: 'pebKwh',
        /*
         * ⚠️ Reconnu par son UNITÉ, pas par son libellé. Immoweb publie DEUX
         * consommations sur la même fiche :
         *   « Consommation d'énergie primaire 342 kWh/m² »          ← celle-ci
         *   « Consommation théorique totale d'énergie primaire 54000 kWh/an »
         * La seconde porte sur tout le logement : la prendre donnerait des
         * valeurs dix à cent fois trop grandes. Exiger « /m² » tranche sans
         * dépendre du libellé, qui varie d'un portail à l'autre
         * (« PEB E-SPEC » chez Trior, « Valeur EPC » chez Zimmo, rien du tout
         * chez Immovlan qui écrit la ligne « 150 kWh/m²/an » toute seule).
         */
        motif: /(\d[\d\s.,]*)\s*kwh\s*\/\s*m[²2]/i,
        libelles: ['peb e-spec', 'e-spec', 'valeur epc', 'epc waarde'],
        // Plancher à 10 : une habitation ne consomme pas 1 kWh/m²/an.
        lire: (v) => entierBorne(v, 10, 1500),
    },
    {
        cle: 'revenuCadastral',
        // ERA l'abrège au milieu d'une ligne composite :
        // « PEB C (215 kWh/m².an) – Électricité non conforme – RC : 1.730 € ».
        // Motif volontairement étroit (RC, deux-points, montant, €) : chercher
        // « rc » n'importe où dans une ligne ramasserait n'importe quoi.
        motif: /\brc\s*:\s*(\d[\d\s.]*)\s*€/i,
        libelles: ['revenu cadastral net', 'revenu cadastral', 'kadastraal inkomen'],
        lire: euros,
    },
    {
        cle: 'surfaceHabitableFiche',
        /*
         * La carte de résultats n'affiche souvent QU'UNE surface, sans
         * libellé — et chez Immoweb c'est parfois le terrain. Constaté :
         * « Maison 3 ch. à Ternat, 727 m² » dont la fiche ne mentionne
         * aucune surface habitable mais « Surface du terrain 727 m² » et le
         * détail pièce par pièce (salon 25, chambres 15+13+6). Lue comme
         * habitable, elle donnait 439 €/m², soit 81 % sous le marché local.
         */
        libelles: ['surface habitable', 'superficie habitable', 'bewoonbare oppervlakte', 'woonoppervlakte'],
        lire: (v) => entierBorne(v, 20, 2000),
    },
    {
        cle: 'surfaceTerrainFiche',
        libelles: ['surface du terrain', 'superficie du terrain', 'surface totale du terrain', 'grondoppervlakte', 'oppervlakte grond'],
        lire: (v) => entierBorne(v, 10, 100000),
    },
    {
        cle: 'etatBien',
        libelles: ['etat du bien', 'etat du batiment', 'etat general', 'staat van het pand', 'toestand'],
        lire: (v) => {
            const t = String(v).replace(/\s+/g, ' ').trim();
            // Trior et Immoweb collent la paire suivante : on coupe à la
            // première majuscule qui suit une minuscule (« À rénoverParking »).
            const coupe = t.replace(/([a-zà-ÿ])([A-ZÀ-Ý])/, '$1\u0000').split('\u0000')[0].trim();
            return coupe.length >= 3 && coupe.length <= 40 ? coupe : null;
        },
    },
];

/**
 * Les champs gérés par ce module.
 *
 * Exporté pour que le report puisse les EFFACER avant de réappliquer :
 * `Object.assign` ajoute mais n'enlève jamais, donc corriger un parseur
 * laissait sinon la vieille valeur erronée en place — exactement ce que
 * `--sans-visite` est censé rendre impossible. Constaté sur données réelles :
 * 19 biens gardaient un « PEB 1 kWh/m² » issu d'une règle déjà corrigée.
 */
export const CHAMPS_CARACTERISTIQUES = CHAMPS.map((c) => c.cle);

/** La valeur qui suit un libellé sur la même ligne, ou null. */
function valeurApresLibelle(ligne, libelle) {
    const n = normaliser(ligne);
    if (!n.startsWith(libelle)) return null;
    const reste = ligne.slice(ligne.length - (n.length - libelle.length)).trim();
    return reste.replace(/^[\s:：•·—–-]+/, '').trim();
}

/**
 * @param {object} brut - `faits` (paires libellé/valeur) et `lignes` (texte),
 *   tels que récoltés par enrichir_adresses.mjs.
 * @returns {object} uniquement les champs trouvés ; jamais de valeur inventée.
 */
export function lireCaracteristiques(brut) {
    const faits = Array.isArray(brut?.faits) ? brut.faits : [];
    const lignes = Array.isArray(brut?.lignes) ? brut.lignes : [];
    const sortie = {};

    const tout = [...lignes, ...faits.map(([l, v]) => l + ' ' + v)];

    for (const champ of CHAMPS) {
        // 0. motif direct : quand l'unité suffit à identifier la valeur,
        // c'est plus sûr que n'importe quel libellé.
        if (champ.motif) {
            for (const ligne of tout) {
                const m = ligne.match(champ.motif);
                if (!m) continue;
                const lu = champ.lire(m[1]);
                if (lu != null) { sortie[champ.cle] = lu; break; }
            }
        }

        for (const libelle of champ.libelles) {
            if (sortie[champ.cle] != null) break;

            // 1. paires structurées — la source la plus sûre.
            for (const [l, v] of faits) {
                if (normaliser(l).startsWith(libelle) && !estVide(v)) {
                    const lu = champ.lire(v);
                    if (lu != null) { sortie[champ.cle] = lu; break; }
                }
            }
            if (sortie[champ.cle] != null) break;

            // 2. même ligne, puis 3. ligne suivante.
            for (let i = 0; i < lignes.length; i++) {
                const memeLigne = valeurApresLibelle(lignes[i], libelle);
                if (memeLigne == null) continue;
                const candidats = memeLigne ? [memeLigne, lignes[i + 1]] : [lignes[i + 1]];
                for (const c of candidats) {
                    if (c == null || estVide(c)) continue;
                    const lu = champ.lire(c);
                    if (lu != null) { sortie[champ.cle] = lu; break; }
                }
                if (sortie[champ.cle] != null) break;
            }
        }
    }
    return sortie;
}
