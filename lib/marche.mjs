/**
 * Référence de marché par commune : combien vaut le mètre carré ici ?
 *
 * Pourquoi : « 1 411 €/m² » ne dit rien tout seul. C'est excellent à
 * Rixensart (médiane 3 160 €/m²) et banal à Liedekerke (2 158 €/m²). Sans
 * référence locale, on ne distingue pas un bien bon marché d'un bien situé
 * dans une commune bon marché — et c'est précisément ce que l'œil ne peut
 * pas faire sur un millier de lignes.
 *
 * Fonctions pures, calculées en Node : la référence doit porter sur TOUT le
 * marché connu, pas sur la sélection filtrée affichée à l'écran. Masquer un
 * bien ou filtrer par région ne doit pas déplacer la médiane.
 */

/** Médiane (et non moyenne) : une maison de 930 m² à 414 €/m² ne doit pas tout tirer. */
function mediane(valeurs) {
    const t = [...valeurs].sort((a, b) => a - b);
    const m = Math.floor(t.length / 2);
    return t.length % 2 ? t[m] : Math.round((t[m - 1] + t[m]) / 2);
}

/**
 * @param {Array} annonces
 * @param {number} minEchantillon - en dessous, on ne publie pas de médiane.
 *   Une commune à 3 biens donnerait un chiffre que le bruit domine, et une
 *   fausse précision est pire qu'une case vide.
 * @returns {Map<string, {mediane:number, n:number}>}
 */
export function calculerMarche(annonces, { minEchantillon = 8 } = {}) {
    const parCommune = new Map();
    for (const a of annonces ?? []) {
        if (!a?.commune || !a.prixM2 || !Number.isFinite(a.prixM2)) continue;
        if (!parCommune.has(a.commune)) parCommune.set(a.commune, []);
        parCommune.get(a.commune).push(a.prixM2);
    }

    const marche = new Map();
    for (const [commune, valeurs] of parCommune) {
        if (valeurs.length < minEchantillon) continue;
        marche.set(commune, { mediane: mediane(valeurs), n: valeurs.length });
    }
    return marche;
}

/**
 * Écart d'un bien à la médiane de SA commune, en pourcentage.
 * Négatif = moins cher que le marché local.
 *
 * Renvoie null plutôt qu'un chiffre quand on ne sait pas : bien sans prix au
 * m², ou commune dont l'échantillon est trop mince.
 */
export function ecartAuMarche(annonce, marche) {
    if (!annonce?.prixM2 || !annonce.commune) return null;
    const ref = marche?.get?.(annonce.commune);
    if (!ref) return null;
    return {
        pct: Math.round(((annonce.prixM2 - ref.mediane) / ref.mediane) * 100),
        mediane: ref.mediane,
        n: ref.n,
    };
}
