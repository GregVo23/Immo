/**
 * Transforme annonces-brutes.json (récolte navigateur) en annonces.json (propre).
 *
 * Exécutable seul : `node parse_annonces.mjs` ou `npm run reparse`.
 * Aucun accès réseau, donc réparer un parsing prend deux secondes au lieu
 * d'un nouveau scrape complet des 4 portails.
 */

import './lib/racine.mjs'; // doit rester en premier : fixe le dossier de travail
import fs from 'fs';
import { pathToFileURL } from 'url';
import { FICHIERS, SITES, CRITERES, CONFIG_PAR_DEFAUT, HISTORIQUE } from './config.mjs';
import { construireAnnonce, dedupliquer } from './lib/parse.mjs';
import { chargerHistorique, ecrireHistorique, rafraichirEntrees, enrichirAnnonces, calculerDisparitions } from './lib/historique.mjs';

const euro = (n) => (n == null ? '—' : n.toLocaleString('fr-BE') + ' €');

/** Retrouve les hints d'un site à partir du nom de source enregistré. */
function hintsPour(source) {
    const entree = Object.values(SITES).find((s) => s.source === source);
    return entree?.hints ?? CONFIG_PAR_DEFAUT.hints;
}

/**
 * Même règle d'exclusion de catégorie que scrapper_immo.mjs (voir
 * SITES['www.immoweb.be'].lienExclusion), appliquée ici aux données DÉJÀ
 * récoltées : corrige le fichier existant en un `npm run reparse`, sans
 * attendre un nouveau scrape pour que le filtre prenne effet.
 */
function lienExclusionPour(source) {
    const entree = Object.values(SITES).find((s) => s.source === source);
    return entree?.lienExclusion ?? null;
}

/**
 * Filtre PORTAIL-AGNOSTIQUE, en complément de lienExclusion (propre à
 * Immoweb) : ERA, Immovlan et Trior laissent eux aussi passer des immeubles
 * mixtes ou à appartements dans leur recherche "maison", constaté sur un
 * scrape réel (4 Immovlan + 1 ERA + 3 Trior). On ne blackliste que les deux
 * catégories que lib/parse.mjs sait reconnaître sans ambiguïté par le texte :
 * pas "duplex"/"loft"/"studio", qui désignent parfois une pièce ou un style
 * DANS une vraie maison ("Plain pied typé LOFT !") plutôt que le bien entier.
 */
export const TYPES_EXCLUS = new Set(['Appartement', 'Immeuble mixte']);

export function parserToutesLesAnnonces() {
    if (!fs.existsSync(FICHIERS.brutes)) {
        console.error(`❌ ${FICHIERS.brutes} introuvable. Lance d'abord le scraper : npm start`);
        process.exitCode = 1;
        return null;
    }

    const brutes = JSON.parse(fs.readFileSync(FICHIERS.brutes, 'utf-8'));
    console.log(`\n🔎 Parsing de ${brutes.length} cartes brutes...`);

    const parsees = brutes.map((b) => construireAnnonce(b, hintsPour(b.source)));

    /* --- Filtres de pertinence ------------------------------------------- */

    const prixPlafond = Math.round(CRITERES.prixMax * CRITERES.prixMaxTolerance);
    // Un plancher est nécessaire : les projets neufs affichent un prix « à
    // partir de » qui peut être très bas (un lot Trevi à 158 000 € pour une
    // recherche à 300-500 k€) et se retrouvait en tête du tri par prix/m².
    const prixPlancher = Math.round(CRITERES.prixMin * CRITERES.prixMinTolerance);
    const rejets = { vendus: [], horsCategorie: [], horsPerimetre: [], horsBudget: [], sansPrix: [] };

    const retenues = parsees.filter((a) => {
        // Les portails laissent les biens vendus dans leurs résultats de
        // recherche. Ils ne sont pas achetables : on les écarte avant tout le
        // reste (c'est aussi la vraie cause des prix « manquants », le prix
        // disparaissant de la carte une fois la vente conclue).
        if (a.statut === 'vendu') {
            rejets.vendus.push(a);
            return false;
        }
        // Catégorie hors périmètre (appartement, immeuble mixte...) malgré une
        // recherche filtrée sur "maison" — voir le commentaire de lienExclusion.
        const exclusion = lienExclusionPour(a.source);
        if (exclusion && exclusion.test(a.lien ?? '')) {
            rejets.horsCategorie.push(a);
            return false;
        }
        // Même chose, mais par le type reconnu dans le texte plutôt que
        // l'URL : couvre les portails qui n'ont pas de lienExclusion dédié
        // (ERA, Immovlan, Trior classent aussi des immeubles à appartements
        // sous leur propre recherche "maison").
        if (a.typeBien && TYPES_EXCLUS.has(a.typeBien)) {
            rejets.horsCategorie.push(a);
            return false;
        }
        if (!a.dansPerimetre) {
            rejets.horsPerimetre.push(a);
            return false;
        }
        if (a.prix == null) {
            // On garde : un prix illisible n'est pas un motif d'exclusion, le
            // dashboard le signalera comme donnée manquante.
            rejets.sansPrix.push(a);
            return true;
        }
        if (a.prix > prixPlafond || a.prix < prixPlancher) {
            rejets.horsBudget.push(a);
            return false;
        }
        return true;
    });

    /* --- Déduplication ---------------------------------------------------- */

    const { annonces, stats } = dedupliquer(retenues);

    // Signale les biens au-dessus du budget nominal mais dans la tolérance.
    for (const a of annonces) {
        a.auDessusDuBudget = a.prix != null && a.prix > CRITERES.prixMax;
    }

    /* --- Historique : nouveautés, baisses de prix, disparitions ----------- */

    const maintenant = new Date().toISOString();
    const { donnees: ancienneDonnees, premierRun } = chargerHistorique(FICHIERS.historique);

    // Étape 1 : rafraîchir avec le prix propre à CHAQUE annonce individuelle
    // (avant fusion), la seule source fiable pour détecter une vraie baisse.
    const historiqueRafraichi = rafraichirEntrees(retenues, ancienneDonnees, maintenant);

    // Étape 2 : signaler nouveau/baisseDePrix sur les annonces FUSIONNÉES, en
    // comparant à l'historique D'AVANT ce run (pas celui déjà rafraîchi).
    enrichirAnnonces(annonces, ancienneDonnees, premierRun);

    // Étape 3 : détecter les disparitions et purger les plus anciennes.
    const { disparus, historiqueFinal } = calculerDisparitions(historiqueRafraichi, retenues, maintenant, HISTORIQUE);

    ecrireHistorique(FICHIERS.historique, historiqueFinal);
    fs.writeFileSync(FICHIERS.disparus, JSON.stringify(disparus, null, 2));

    annonces.sort((a, b) => (a.prixM2 ?? Infinity) - (b.prixM2 ?? Infinity));

    fs.writeFileSync(FICHIERS.annonces, JSON.stringify(annonces, null, 2));

    /* --- Rapport ---------------------------------------------------------- */

    const parSource = {};
    for (const a of parsees) parSource[a.source] = (parSource[a.source] ?? 0) + 1;

    const parSourceRetenue = {};
    for (const a of annonces) for (const s of a.sources ?? [a.source]) parSourceRetenue[s] = (parSourceRetenue[s] ?? 0) + 1;

    console.log('\n📊 RAPPORT DE PARSING');
    console.log('─'.repeat(58));
    console.log(`Cartes brutes            : ${brutes.length}`);
    console.log(`  par portail            : ${Object.entries(parSource).map(([s, n]) => `${s} ${n}`).join(', ') || '—'}`);
    console.log('');
    console.log(`Écartées déjà vendues    : ${rejets.vendus.length}`);
    if (rejets.horsCategorie.length) console.log(`Écartées hors catégorie  : ${rejets.horsCategorie.length}  (appartement, immeuble mixte...)`);
    console.log(`Écartées hors périmètre  : ${rejets.horsPerimetre.length}`);
    console.log(`Écartées hors budget     : ${rejets.horsBudget.length}  (hors ${prixPlancher.toLocaleString('fr-BE')} – ${prixPlafond.toLocaleString('fr-BE')} €)`);
    console.log('');
    console.log(`Doublons même lien       : ${stats.doublonsMemeLien}`);
    console.log(`Doublons même adresse    : ${stats.doublonsMemeAdresse}   (rue + numéro identiques)`);
    console.log(`Doublons inter-portails  : ${stats.doublonsMemesCaracteristiques}   (mêmes caractéristiques, portails différents)`);
    console.log('─'.repeat(58));
    console.log(`✅ ${annonces.length} biens uniques → ${FICHIERS.annonces}`);
    console.log(`  par portail            : ${Object.entries(parSourceRetenue).map(([s, n]) => `${s} ${n}`).join(', ') || '—'}`);

    /* --- Qualité des données ---------------------------------------------- */

    const compte = (champ) => annonces.filter((a) => a.champsManquants.includes(champ)).length;
    const manquants = {
        prix: compte('prix'),
        surfaceHabitable: compte('surfaceHabitable'),
        chambres: compte('chambres'),
        surfacesAmbigues: compte('surfacesAmbigues'),
    };

    console.log('\n🔍 QUALITÉ DES DONNÉES (sur les biens retenus)');
    for (const [champ, n] of Object.entries(manquants)) {
        if (n === 0) continue;
        const pct = Math.round((n / Math.max(annonces.length, 1)) * 100);
        console.log(`  ⚠️ ${champ.padEnd(18)} manquant/incertain sur ${n} biens (${pct} %)`);
    }
    if (Object.values(manquants).every((n) => n === 0)) console.log('  ✅ Tous les champs clés sont renseignés.');

    const sousOption = annonces.filter((a) => a.statut === 'option' || a.statut === 'reserve');
    if (sousOption.length) {
        console.log(`\n⏳ ${sousOption.length} bien(s) sous option ou réservés — conservés (une option échoue souvent) et signalés dans le dashboard.`);
    }

    /* --- Historique --------------------------------------------------------- */

    if (premierRun) {
        console.log(`\n📋 Premier historique constitué (${annonces.length} biens). Les prochains runs détecteront nouveautés, baisses de prix et disparitions.`);
    } else {
        const nouveaux = annonces.filter((a) => a.nouveau);
        const baisses = annonces.filter((a) => a.baisseDePrix);
        console.log('\n📈 HISTORIQUE');
        console.log(`  🆕 ${nouveaux.length} nouveau(x) bien(s) depuis le dernier scrape.`);
        for (const a of nouveaux.slice(0, 5)) console.log(`     ${a.commune ?? '?'} — ${euro(a.prix)} — ${a.titre.slice(0, 45)}`);
        if (baisses.length) {
            console.log(`  📉 ${baisses.length} bien(s) ont baissé de prix.`);
            for (const a of baisses.slice(0, 5)) console.log(`     ${a.commune ?? '?'} — ${euro(a.baisseDePrix.ancienPrix)} → ${euro(a.baisseDePrix.nouveauPrix)} — ${a.titre.slice(0, 35)}`);
        }
        if (disparus.length) {
            console.log(`  ❌ ${disparus.length} bien(s) disparu(s) depuis ${HISTORIQUE.joursAvantDisparu}+ jours (vendu ou retiré probable).`);
            for (const d of disparus.slice(0, 5)) console.log(`     ${d.commune ?? '?'} — ${euro(d.prixActuel)} — ${d.titre.slice(0, 40)} (absent depuis ${d.joursAbsence} j)`);
        }
    }

    const avecAnciennete = annonces.filter((a) => a.joursEnLigne != null);
    if (avecAnciennete.length) {
        const vieux = avecAnciennete.filter((a) => a.joursEnLigne >= 120).length;
        console.log(`\n📅 Ancienneté connue pour ${avecAnciennete.length} bien(s)${vieux ? ` — dont ${vieux} en ligne depuis 120 jours ou plus (marge de négociation)` : ''}.`);
    }

    const multi = annonces.filter((a) => a.multiSource);
    if (multi.length) {
        console.log(`\n🔗 ${multi.length} bien(s) publié(s) sur plusieurs portails :`);
        for (const a of multi.slice(0, 5)) console.log(`   ${a.ville ?? '?'} — ${a.sources.join(' + ')} — ${a.titre.slice(0, 45)}`);
    }

    // Aide au diagnostic : les portails muets sont le symptôme n°1 d'un
    // sélecteur cassé par une refonte du site.
    const portailsMuets = Object.values(SITES)
        .map((s) => s.source)
        .filter((s) => !parSource[s]);
    if (portailsMuets.length) {
        console.log(`\n❗ Aucun résultat pour : ${portailsMuets.join(', ')}`);
        console.log('   → sélecteur probablement cassé, voir les fichiers debug/*.html');
    }

    return { annonces, stats, rejets };
}

// Exécution directe (et non simple import depuis le scraper).
// pathToFileURL est indispensable sous Windows : construire l'URL à la main
// donne "file:///C:/..." vs "file:///c:/..." selon les cas, et la comparaison
// échoue silencieusement.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    parserToutesLesAnnonces();
}
