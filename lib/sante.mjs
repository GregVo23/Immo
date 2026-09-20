/**
 * Contrôle de santé des portails : détecter qu'un scraper s'est cassé.
 *
 * Motivation concrète : lors d'un run, ERA est passé de 100 à 22 cartes
 * (défilement qui abandonnait trop tôt) et Trior de 220 à 0 (une fenêtre
 * promotionnelle interceptait le clic de son formulaire). Les deux pannes
 * étaient TOTALEMENT SILENCIEUSES : le pipeline ne prévenait que si un
 * portail renvoyait zéro, pas s'il s'effondrait de 78 %. Sans surveillance,
 * on croit simplement que le marché s'est calmé.
 *
 * La référence est la MÉDIANE des runs précédents, pas le dernier run : si le
 * run précédent était lui-même cassé, le comparer à lui ferait passer la
 * panne pour la normale (et la réparation pour une anomalie).
 */

import fs from 'fs';

export function chargerSante(chemin) {
    if (!fs.existsSync(chemin)) return [];
    try {
        const d = JSON.parse(fs.readFileSync(chemin, 'utf-8'));
        return Array.isArray(d) ? d : [];
    } catch {
        return []; // fichier corrompu : on repart de zéro plutôt que de planter
    }
}

export function ecrireSante(chemin, runs) {
    fs.writeFileSync(chemin, JSON.stringify(runs, null, 2));
}

function mediane(valeurs) {
    if (!valeurs.length) return null;
    const tri = [...valeurs].sort((a, b) => a - b);
    const milieu = Math.floor(tri.length / 2);
    return tri.length % 2 ? tri[milieu] : Math.round((tri[milieu - 1] + tri[milieu]) / 2);
}

/**
 * Compare la récolte de ce run à la médiane des précédents.
 *
 * @param {object} parPortailActuel - { ERA: 100, Immoweb: 1404, ... }
 * @param {Array}  runsPrecedents   - historique, le plus ancien d'abord
 * @param {object} options
 *   seuilChute : proportion de baisse à partir de laquelle on alerte (0.4 = -40 %)
 *   minRuns    : nombre de runs précédents requis pour juger
 */
export function evaluerSante(parPortailActuel, runsPrecedents, { seuilChute = 0.4, minRuns = 2 } = {}) {
    if (runsPrecedents.length < minRuns) {
        return { alertes: [], assezDHistorique: false, runsComparés: runsPrecedents.length };
    }

    const alertes = [];
    // On juge tout portail déjà vu, même absent du run actuel : sa disparition
    // complète est précisément le cas le plus grave.
    const portails = new Set(runsPrecedents.flatMap((r) => Object.keys(r.parPortail ?? {})));

    for (const portail of portails) {
        const valeurs = runsPrecedents.map((r) => r.parPortail?.[portail]).filter((n) => typeof n === 'number');
        if (valeurs.length < minRuns) continue;

        const reference = mediane(valeurs);
        if (!reference) continue;

        const actuel = parPortailActuel[portail] ?? 0;
        const chute = (reference - actuel) / reference;
        if (chute < seuilChute) continue;

        alertes.push({
            portail,
            actuel,
            reference,
            chutePct: Math.round(chute * 100),
            gravite: actuel === 0 ? 'critique' : 'alerte',
        });
    }

    alertes.sort((a, b) => b.chutePct - a.chutePct);
    return { alertes, assezDHistorique: true, runsComparés: runsPrecedents.length };
}

/** Ajoute ce run à l'historique, en bornant la taille du fichier. */
export function enregistrerRun(runs, parPortail, date, { maxRuns = 20 } = {}) {
    return [...runs, { date, parPortail }].slice(-maxRuns);
}
