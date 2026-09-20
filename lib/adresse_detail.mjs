/**
 * Extraction de l'adresse exacte depuis la page de détail d'une annonce.
 *
 * Pourquoi ce module : 92 % des biens n'ont qu'une position au centre de leur
 * commune, alors que « accès gare » pèse 40 points sur 100 dans le score. Sur
 * un barème où 0,8 km vaut 100 points et 6 km en vaut 45, une erreur de ±2 km
 * (largeur courante d'une commune) déplace un bien de 30 à 40 points : le
 * classement était donc en grande partie du bruit.
 *
 * ⚠️ On n'utilise PAS les coordonnées GPS trouvées dans le HTML des portails.
 * Vérifié sur données réelles : deux annonces Immoweb situées à 20 km l'une de
 * l'autre (Ternat 1741 et Rebecq 1430) portaient des `latitude`/`longitude`
 * IDENTIQUES, et une annonce Immovlan à Piétrain (1370, Brabant wallon)
 * affichait des coordonnées en province de Liège, ~30 km à côté. Ces valeurs
 * appartiennent à d'autres composants de la page (carte par défaut, biens
 * similaires, agence). On extrait le TEXTE de l'adresse et on le confie au
 * géocodage Nominatim déjà en place : uniforme entre portails et vérifiable.
 */

/** Le portail affiche explicitement que l'adresse n'est pas publiée. */
const ADRESSE_MASQUEE = /demander\s+l['’]adresse|adresse\s+sur\s+demande|adres\s+op\s+aanvraag|address\s+on\s+request|op\s+aanvraag/i;

/**
 * Mots de voirie — sert à reconnaître une ligne d'adresse.
 *
 * Deux conventions à traiter séparément :
 *  - en français, le type de voie est un mot isolé ("Rue De Tirlemont") →
 *    frontière de mot des deux côtés ;
 *  - en néerlandais, il est SOUDÉ au nom ("Assesteenweg", "Koldamstraat",
 *    "Fossebaan") → pas de frontière à gauche, sinon aucune adresse
 *    flamande n'est reconnue (constaté : 4 adresses sur 5 ratées).
 */
const MOTS_VOIRIE =
    /\b(rue|avenue|chauss[ée]e|boulevard|chemin|clos|dr[èe]ve|place|route|all[ée]e|square|impasse|venelle|sentier|quai)\b|(straat|steenweg|laan|weg|dreef|plein|baan|kaai|hof|lei)\b/i;

export function estAdresseMasquee(texte) {
    return !!texte && ADRESSE_MASQUEE.test(texte);
}

/**
 * Découpe une ligne d'adresse en rue / code postal / ville.
 * Formes réelles rencontrées :
 *   "Rue De Tirlemont 32 1390 — Grez-Doiceau"     (Immoweb, tiret cadratin)
 *   "Kleine Geeststraat 133 1933 — Sterrebeek"    (Immoweb, NL)
 *   "Chemin Basse Franchise 0 1430 — Rebecq"      (Immoweb, numéro 0)
 *   "Rue rené sacré 6 , 1367 Ramillies-Offus"     (Immovlan, virgule)
 *   "Rue de la Station 1 02 , 1350 Orp-le-Grand"  (Immovlan, numéro en 2 morceaux)
 */
export function decouperLigneAdresse(ligne) {
    if (!ligne) return null;
    const texte = String(ligne).replace(/\s+/g, ' ').trim();
    if (estAdresseMasquee(texte)) return null;

    // Le code postal belge est le pivot : 4 chiffres, premier non nul. On
    // prend le DERNIER candidat, pas le premier : un numéro de rue peut
    // lui aussi avoir 4 chiffres, et il précède le code postal
    // ("Ninoofsesteenweg 1065 1703 — Dilbeek" → 1703, pas 1065).
    const candidats = [...texte.matchAll(/\b([1-9]\d{3})\b/g)];
    if (!candidats.length) return null;
    const m = candidats[candidats.length - 1];

    const avant = texte.slice(0, m.index).replace(/[\s,;—–-]+$/, '').trim();
    const apres = texte
        .slice(m.index + m[0].length)
        .replace(/^[\s,;—–-]+/, '')
        .trim();

    // Sans mot de voirie avant le CP, ce n'est qu'une localité ("1315 — INCOURT").
    if (!avant || !MOTS_VOIRIE.test(avant)) return null;

    return {
        rue: avant,
        cp: m[1],
        ville: apres.split(/[,(]/)[0].trim() || null,
    };
}

/**
 * Extraction en cascade, de la source la plus structurée à la plus fragile.
 * Volontairement indépendante de sélecteurs CSS propres à chaque portail :
 * les classes hachées de Century21 et les gabarits multiples d'Immoweb ont
 * déjà cassé ce genre d'approche plusieurs fois.
 *
 * @param {object} brut - récolté par le navigateur (voir enrichir_adresses.mjs)
 */
export function extraireAdresse(brut) {
    // 1. JSON-LD schema.org : le plus fiable quand il existe (Century21).
    const ld = brut?.jsonLdAdresse;
    if (ld?.streetAddress && !estAdresseMasquee(ld.streetAddress)) {
        return {
            rue: String(ld.streetAddress).replace(/\s+/g, ' ').trim(),
            cp: ld.postalCode ? String(ld.postalCode).trim() : null,
            ville: ld.addressLocality ? String(ld.addressLocality).trim() : null,
            origine: 'json-ld',
        };
    }

    // 2. Élément dédié quand le portail en expose un (Immoweb).
    if (brut?.texteSelecteur) {
        const decoupe = decouperLigneAdresse(brut.texteSelecteur);
        if (decoupe) return { ...decoupe, origine: 'selecteur' };
    }

    // 3. Repli : première ligne de texte visible qui ressemble à une adresse.
    for (const ligne of brut?.lignesTexte ?? []) {
        const decoupe = decouperLigneAdresse(ligne);
        if (decoupe) return { ...decoupe, origine: 'texte' };
    }

    return null;
}
