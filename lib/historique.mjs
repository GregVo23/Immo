/**
 * Suivi d'un bien d'un scrape à l'autre : nouveauté, baisse de prix, disparition.
 *
 * Principe : chaque annonce INDIVIDUELLE (avant fusion inter-portails) est
 * suivie par son lien canonique dans historique.json. Après dédup, une
 * annonce fusionnée regroupe parfois plusieurs liens (un même bien publié sur
 * 2 portails) — les fonctions ci-dessous s'appuient donc sur l'ENSEMBLE des
 * liens d'une annonce, pas seulement son lien principal, pour ne pas la
 * signaler « nouvelle » à tort simplement parce que la fusion a changé de
 * portail principal d'un run à l'autre (celui-ci est choisi par « richesse »
 * des champs, voir fusionner() dans lib/parse.mjs, et peut varier).
 *
 * Deux garde-fous volontaires :
 *  - Un bien n'est marqué « disparu » qu'après `joursAvantDisparu` jours
 *    d'absence, pas dès le premier run où il manque : un scrape peut
 *    échouer partiellement sur un portail (vécu avec ERA, tombé de 91 à
 *    33 cartes entre deux runs sans aucun rapport avec une vraie baisse
 *    d'offre) et il ne faut pas confondre ça avec une vente.
 *  - Le tout premier run (aucun historique.json existant) ne marque RIEN
 *    comme nouveau : sans base de comparaison, "tout est nouveau" n'est pas
 *    une information, juste du bruit.
 */

import fs from 'fs';
import { canoniserLien } from './parse.mjs';

/** Charge l'historique existant. `premierRun` distingue "fichier absent" de "vide". */
export function chargerHistorique(chemin) {
    if (!fs.existsSync(chemin)) return { donnees: {}, premierRun: true };
    try {
        return { donnees: JSON.parse(fs.readFileSync(chemin, 'utf-8')), premierRun: false };
    } catch {
        // Fichier corrompu : on repart de zéro plutôt que de planter le pipeline.
        return { donnees: {}, premierRun: true };
    }
}

export function ecrireHistorique(chemin, donnees) {
    fs.writeFileSync(chemin, JSON.stringify(donnees, null, 2));
}

/** Tous les liens canoniques d'une annonce fusionnée : le principal + les alternatifs. */
function tousLesLiens(annonce) {
    const liens = [annonce.lienCanonique, ...(annonce.autresLiens ?? []).map((l) => canoniserLien(l.lien))];
    return liens.filter(Boolean);
}

/**
 * Étape 1 : rafraîchit l'historique avec les infos de CHAQUE annonce
 * individuelle retenue (avant fusion), qui seule connaît le prix propre à
 * son portail. Ne modifie que les entrées effectivement revues ce run-ci ;
 * les autres restent inchangées (nécessaire pour calculer les disparitions
 * à l'étape 3).
 *
 * `historiquePrix` n'accumule une ligne que lorsque le prix change
 * réellement — sinon le fichier grossirait d'une entrée par bien à chaque
 * run, pour rien.
 */
export function rafraichirEntrees(retenues, ancienneDonnees, maintenant) {
    const nouvelleDonnees = { ...ancienneDonnees };
    for (const a of retenues) {
        const cle = a.lienCanonique;
        if (!cle) continue;
        const ancien = ancienneDonnees[cle];
        const prixAChange = a.prix != null && ancien?.prixActuel != null && a.prix !== ancien.prixActuel;
        const premierPrixConnu = a.prix != null && !ancien;

        nouvelleDonnees[cle] = {
            titre: a.titre,
            commune: a.commune,
            source: a.source,
            lien: a.lien,
            premiereFois: ancien?.premiereFois ?? maintenant,
            derniereFoisVu: maintenant,
            prixActuel: a.prix ?? ancien?.prixActuel ?? null,
            historiquePrix:
                prixAChange || premierPrixConnu
                    ? [...(ancien?.historiquePrix ?? []), { date: maintenant, prix: a.prix }]
                    : (ancien?.historiquePrix ?? []),
        };
    }
    return nouvelleDonnees;
}

/**
 * Étape 2 : enrichit chaque annonce FUSIONNÉE (après dédup) des signaux
 * `nouveau`, `baisseDePrix` et `premiereFoisVu`, en comparant à l'historique
 * D'AVANT ce run (jamais celui déjà rafraîchi à l'étape 1, sinon tout
 * paraîtrait "déjà connu").
 */
export function enrichirAnnonces(annonces, ancienneDonnees, premierRun) {
    for (const a of annonces) {
        const liens = tousLesLiens(a);

        // Nouveau seulement si AUCUN de ses liens (principal ou alternatifs)
        // n'était déjà connu — un bien qui gagne un second portail n'est pas
        // "nouveau", juste republié ailleurs.
        a.nouveau = !premierRun && liens.length > 0 && liens.every((l) => !ancienneDonnees[l]);

        const ancienPrincipal = ancienneDonnees[a.lienCanonique];
        a.premiereFoisVu = ancienPrincipal?.premiereFois ?? null;

        // Comparé au lien PRINCIPAL uniquement : si la fusion a changé de
        // portail principal ce run-ci, on ne sait pas comparer des prix de
        // deux sources différentes de façon fiable, donc on ne signale rien
        // plutôt que d'inventer une fausse baisse.
        a.baisseDePrix =
            !premierRun && ancienPrincipal?.prixActuel != null && a.prix != null && a.prix < ancienPrincipal.prixActuel
                ? { ancienPrix: ancienPrincipal.prixActuel, nouveauPrix: a.prix, depuis: ancienPrincipal.derniereFoisVu }
                : null;
    }
    return annonces;
}

/**
 * Étape 3 : liste les biens absents de ce run. Un bien manquant depuis moins
 * de `joursAvantDisparu` jours n'est pas encore affiché (marge contre un
 * scrape partiellement raté) ; au-delà de `joursPurge` jours d'absence, on
 * cesse purement et simplement d'en garder trace.
 *
 * Retourne aussi l'historique FINAL à écrire sur disque (les entrées trop
 * vieilles sont retirées ici, pas avant).
 */
export function calculerDisparitions(historiqueRafraichi, retenues, maintenant, { joursAvantDisparu, joursPurge }) {
    const liensVusCeRun = new Set(retenues.map((a) => a.lienCanonique).filter(Boolean));
    const disparus = [];
    const historiqueFinal = {};

    for (const [lien, entree] of Object.entries(historiqueRafraichi)) {
        if (liensVusCeRun.has(lien)) {
            historiqueFinal[lien] = entree;
            continue;
        }
        // new Date(maintenant) est indispensable : `maintenant` est une chaîne
        // ISO (pour rester sérialisable telle quelle dans le JSON écrit sur
        // disque), et une soustraction directe chaîne - Date donne NaN en
        // silence (Number("2026-...") ≠ new Date("2026-...").getTime()) — un
        // bug qui faisait échouer TOUTES les comparaisons de seuil sans jamais
        // lever d'erreur.
        const joursAbsence = (new Date(maintenant) - new Date(entree.derniereFoisVu)) / 86400000;
        if (joursAbsence > joursPurge) continue; // oublié définitivement
        historiqueFinal[lien] = entree; // gardé en mémoire tant que non purgé
        if (joursAbsence >= joursAvantDisparu) {
            disparus.push({ lien, ...entree, joursAbsence: Math.floor(joursAbsence) });
        }
    }
    return { disparus, historiqueFinal };
}
