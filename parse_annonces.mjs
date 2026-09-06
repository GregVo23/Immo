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
import { FICHIERS, SITES, CRITERES, CONFIG_PAR_DEFAUT } from './config.mjs';
import { construireAnnonce, dedupliquer } from './lib/parse.mjs';

/** Retrouve les hints d'un site à partir du nom de source enregistré. */
function hintsPour(source) {
    const entree = Object.values(SITES).find((s) => s.source === source);
    return entree?.hints ?? CONFIG_PAR_DEFAUT.hints;
}

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
    const rejets = { vendus: [], horsPerimetre: [], horsBudget: [], sansPrix: [] };

    const retenues = parsees.filter((a) => {
        // Les portails laissent les biens vendus dans leurs résultats de
        // recherche. Ils ne sont pas achetables : on les écarte avant tout le
        // reste (c'est aussi la vraie cause des prix « manquants », le prix
        // disparaissant de la carte une fois la vente conclue).
        if (a.statut === 'vendu') {
            rejets.vendus.push(a);
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
