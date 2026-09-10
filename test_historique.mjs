/**
 * Tests du suivi historique (nouveau / baisse de prix / disparition).
 * Lancer : node test_historique.mjs
 */

import { rafraichirEntrees, enrichirAnnonces, calculerDisparitions } from './lib/historique.mjs';

let echecs = 0;
let total = 0;

function verifier(libelle, obtenu, attendu) {
    total++;
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}${ok ? '' : `\n       obtenu  : ${JSON.stringify(obtenu)}\n       attendu : ${JSON.stringify(attendu)}`}`);
}

const J1 = '2026-09-01T10:00:00.000Z';
const J3 = '2026-09-03T10:00:00.000Z';
const J5 = '2026-09-05T10:00:00.000Z';
const J8 = '2026-09-08T10:00:00.000Z';

const retenue = (o) => ({ lienCanonique: o.lien, autresLiens: [], ...o });

/* ------------------------------------------------------------
   Premier run : rien ne doit être marqué "nouveau"
   ------------------------------------------------------------ */
console.log('\n== Premier run (bootstrap) ==');

const r1 = [retenue({ lien: 'https://a.be/1', prix: 350000, titre: 'Maison A', commune: 'Waterloo', source: 'ERA' })];
const hist1 = rafraichirEntrees(r1, {}, J1);
verifier('entrée créée avec premiereFois = maintenant', hist1['https://a.be/1'].premiereFois, J1);
verifier('un seul point de prix initial', hist1['https://a.be/1'].historiquePrix, [{ date: J1, prix: 350000 }]);

const fusionnees1 = [{ lienCanonique: 'https://a.be/1', autresLiens: [], prix: 350000, titre: 'Maison A', commune: 'Waterloo' }];
enrichirAnnonces(fusionnees1, {}, /* premierRun */ true);
verifier('rien de "nouveau" au tout premier run', fusionnees1[0].nouveau, false);
verifier('pas de baisse au premier run', fusionnees1[0].baisseDePrix, null);

/* ------------------------------------------------------------
   Run 2 : un bien réellement nouveau, un bien déjà connu
   ------------------------------------------------------------ */
console.log('\n== Run 2 : détection "nouveau" ==');

const ancienneDonnees2 = hist1; // ce que le run 1 a écrit
const fusionnees2 = [
    { lienCanonique: 'https://a.be/1', autresLiens: [], prix: 350000, titre: 'Maison A', commune: 'Waterloo' }, // déjà connu
    { lienCanonique: 'https://b.be/2', autresLiens: [], prix: 400000, titre: 'Maison B', commune: 'Genappe' }, // inédit
];
enrichirAnnonces(fusionnees2, ancienneDonnees2, false);
verifier('bien déjà connu → pas nouveau', fusionnees2[0].nouveau, false);
verifier('bien inédit → nouveau', fusionnees2[1].nouveau, true);
verifier('premiereFoisVu reporté pour le bien connu', fusionnees2[0].premiereFoisVu, J1);
verifier('premiereFoisVu absent pour le bien inédit', fusionnees2[1].premiereFoisVu, null);

/* ------------------------------------------------------------
   Fusion inter-portails : un lien alternatif déjà connu ne doit
   PAS faire passer l'annonce pour nouvelle, même si le lien
   PRINCIPAL a changé de portail entre deux runs.
   ------------------------------------------------------------ */
console.log('\n== Fusion : portail principal qui change ne doit pas donner "nouveau" ==');

// Run A : le bien est connu sous son lien ERA.
const histA = rafraichirEntrees([retenue({ lien: 'https://era.be/x', prix: 420000, titre: 'Villa', commune: 'Lasne', source: 'ERA' })], {}, J1);

// Run B : Immoweb devient la source "principale" après fusion (plus de
// champs renseignés), mais ERA reste listé en lien alternatif.
const fusionB = [{ lienCanonique: 'https://immoweb.be/y', autresLiens: [{ source: 'ERA', lien: 'https://era.be/x' }], prix: 420000, titre: 'Villa', commune: 'Lasne' }];
enrichirAnnonces(fusionB, histA, false);
verifier('lien principal inconnu MAIS alternatif déjà vu → pas nouveau', fusionB[0].nouveau, false);

/* ------------------------------------------------------------
   Baisse de prix : uniquement comparée sur le lien PRINCIPAL
   ------------------------------------------------------------ */
console.log('\n== Baisse de prix ==');

const ancienneDonnees3 = rafraichirEntrees([retenue({ lien: 'https://a.be/1', prix: 350000, titre: 'Maison A', commune: 'Waterloo', source: 'ERA' })], {}, J1);
const fusionBaisse = [{ lienCanonique: 'https://a.be/1', autresLiens: [], prix: 320000, titre: 'Maison A', commune: 'Waterloo' }];
enrichirAnnonces(fusionBaisse, ancienneDonnees3, false);
verifier('baisse détectée', fusionBaisse[0].baisseDePrix, { ancienPrix: 350000, nouveauPrix: 320000, depuis: J1 });

const fusionHausse = [{ lienCanonique: 'https://a.be/1', autresLiens: [], prix: 360000, titre: 'Maison A', commune: 'Waterloo' }];
enrichirAnnonces(fusionHausse, ancienneDonnees3, false);
verifier('hausse de prix non signalée comme baisse', fusionHausse[0].baisseDePrix, null);

// Le lien principal a changé de portail : on ne compare pas des prix de
// sources différentes, donc pas de fausse baisse inventée.
const fusionPrincipalInconnu = [{ lienCanonique: 'https://autre-portail.be/z', autresLiens: [{ source: 'ERA', lien: 'https://a.be/1' }], prix: 100000, titre: 'Maison A', commune: 'Waterloo' }];
enrichirAnnonces(fusionPrincipalInconnu, ancienneDonnees3, false);
verifier('pas de baisse inventée quand le lien principal a changé', fusionPrincipalInconnu[0].baisseDePrix, null);

/* ------------------------------------------------------------
   historiquePrix : n'accumule qu'aux VRAIS changements
   ------------------------------------------------------------ */
console.log("\n== historiquePrix : pas de doublon quand le prix ne change pas ==");

let hist = rafraichirEntrees([retenue({ lien: 'https://a.be/1', prix: 350000, source: 'ERA', titre: 'Maison A', commune: 'Waterloo' })], {}, J1);
hist = rafraichirEntrees([retenue({ lien: 'https://a.be/1', prix: 350000, source: 'ERA', titre: 'Maison A', commune: 'Waterloo' })], hist, J3);
verifier('même prix deux runs de suite → un seul point', hist['https://a.be/1'].historiquePrix.length, 1);
hist = rafraichirEntrees([retenue({ lien: 'https://a.be/1', prix: 330000, source: 'ERA', titre: 'Maison A', commune: 'Waterloo' })], hist, J5);
verifier('vrai changement → un point de plus', hist['https://a.be/1'].historiquePrix.length, 2);
verifier('derniereFoisVu mis à jour', hist['https://a.be/1'].derniereFoisVu, J5);

/* ------------------------------------------------------------
   Disparition : pas immédiate, avec seuil et purge
   ------------------------------------------------------------ */
console.log('\n== Disparition : seuil et purge ==');

const SEUILS = { joursAvantDisparu: 2, joursPurge: 45 };

// Bien vu le J1, absent du run le lendemain (1 jour d'écart, < seuil de 2) :
// pas encore signalé — la marge doit jouer.
const J2 = '2026-09-02T10:00:00.000Z';
let histDisp = rafraichirEntrees([retenue({ lien: 'https://a.be/1', prix: 350000, source: 'ERA', titre: 'Maison A', commune: 'Waterloo' })], {}, J1);
let { disparus, historiqueFinal } = calculerDisparitions(histDisp, [], J2, SEUILS);
verifier('absent depuis 1 jour (< seuil) : pas encore "disparu"', disparus.length, 0);
verifier('mais toujours en mémoire (pas purgé)', Object.keys(historiqueFinal), ['https://a.be/1']);

// Pile au seuil (2 jours) : affiché — le seuil est inclusif ("MOINS
// longtemps que le seuil" reste caché, "au moins" le seuil s'affiche).
({ disparus } = calculerDisparitions(histDisp, [], J3, SEUILS));
verifier('absent depuis exactement le seuil : disparu', disparus.length, 1);

// Absent depuis 5 jours (> seuil de 2) : signalé disparu.
({ disparus } = calculerDisparitions(histDisp, [], J5, SEUILS));
verifier('absent depuis 5 jours : disparu', disparus.length, 1);
verifier('infos exploitables sur le disparu', [disparus[0].titre, disparus[0].commune, disparus[0].prixActuel], ['Maison A', 'Waterloo', 350000]);

// Bien revu entretemps : n'est plus "disparu", et garde sa date d'origine.
const histRevu = rafraichirEntrees([retenue({ lien: 'https://a.be/1', prix: 350000, source: 'ERA', titre: 'Maison A', commune: 'Waterloo' })], histDisp, J5);
({ disparus } = calculerDisparitions(histRevu, [{ lienCanonique: 'https://a.be/1' }], J5, SEUILS));
verifier('revu ce run-ci → plus disparu', disparus.length, 0);
verifier('premiereFois conservée malgré le passage à vide', histRevu['https://a.be/1'].premiereFois, J1);

// Absence de 50 jours (> joursPurge=45) : oublié définitivement.
const J50 = new Date(new Date(J1).getTime() + 50 * 86400000).toISOString();
({ disparus, historiqueFinal } = calculerDisparitions(histDisp, [], J50, SEUILS));
verifier('purgé après 45 jours : plus dans l\'historique', Object.keys(historiqueFinal).length, 0);
verifier('purgé → plus listé en disparu non plus', disparus.length, 0);

/* ------------------------------------------------------------ */
console.log(`\n${'─'.repeat(50)}`);
console.log(echecs === 0 ? `✅ ${total}/${total} tests passés` : `❌ ${echecs} échec(s) sur ${total} tests`);
process.exit(echecs === 0 ? 0 : 1);
