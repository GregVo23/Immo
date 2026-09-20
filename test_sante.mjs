/**
 * Tests du contrôle de santé des portails.
 * Lancer : node test_sante.mjs
 */

import { evaluerSante, enregistrerRun } from './lib/sante.mjs';

let echecs = 0;
let total = 0;

function verifier(libelle, obtenu, attendu) {
    total++;
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}${ok ? '' : `\n       obtenu  : ${JSON.stringify(obtenu)}\n       attendu : ${JSON.stringify(attendu)}`}`);
}

const run = (parPortail, date = '2026-09-20T10:00:00.000Z') => ({ date, parPortail });

console.log('\n== Pas assez d\'historique : on ne juge pas ==');
verifier('aucun run précédent', evaluerSante({ ERA: 100 }, []).assezDHistorique, false);
verifier('un seul run précédent', evaluerSante({ ERA: 100 }, [run({ ERA: 100 })]).assezDHistorique, false);
verifier('  → aucune alerte émise', evaluerSante({ ERA: 10 }, [run({ ERA: 100 })]).alertes, []);

console.log('\n== Le cas réel : ERA 100 → 22, Trior 220 → 0 ==');
const precedents = [run({ Immoweb: 1404, ERA: 100, Trior: 220, Immovlan: 175 }), run({ Immoweb: 1390, ERA: 98, Trior: 215, Immovlan: 170 }), run({ Immoweb: 1410, ERA: 102, Trior: 225, Immovlan: 178 })];
const { alertes } = evaluerSante({ Immoweb: 1400, ERA: 22, Trior: 0, Immovlan: 172 }, precedents);
verifier('2 portails signalés', alertes.length, 2);
verifier('Trior absent → critique', alertes.find((a) => a.portail === 'Trior').gravite, 'critique');
verifier('  → chute de 100 %', alertes.find((a) => a.portail === 'Trior').chutePct, 100);
verifier('ERA effondré → alerte', alertes.find((a) => a.portail === 'ERA').gravite, 'alerte');
verifier('  → chute de 78 %', alertes.find((a) => a.portail === 'ERA').chutePct, 78);
verifier('Immoweb stable → rien', !!alertes.find((a) => a.portail === 'Immoweb'), false);
verifier('Immovlan stable → rien', !!alertes.find((a) => a.portail === 'Immovlan'), false);
verifier('le plus grave en premier', alertes[0].portail, 'Trior');

console.log('\n== Variations normales : pas de fausse alerte ==');
const stables = [run({ ERA: 100 }), run({ ERA: 90 }), run({ ERA: 110 })];
verifier('-10 % toléré', evaluerSante({ ERA: 90 }, stables).alertes, []);
verifier('-30 % toléré', evaluerSante({ ERA: 70 }, stables).alertes, []);
verifier('-45 % signalé', evaluerSante({ ERA: 55 }, stables).alertes.length, 1);
verifier('hausse jamais signalée', evaluerSante({ ERA: 300 }, stables).alertes, []);

console.log('\n== Référence = médiane, pas le dernier run ==');
// Le run précédent était cassé (22). Comparé à LUI, 100 semblerait anormal et
// une future chute serait jugée sur une base fausse. La médiane l'ignore.
const avecRunCasse = [run({ ERA: 100 }), run({ ERA: 98 }), run({ ERA: 22 })];
verifier('retour à la normale non signalé', evaluerSante({ ERA: 100 }, avecRunCasse).alertes, []);
verifier('  → référence = médiane (98), pas 22', evaluerSante({ ERA: 40 }, avecRunCasse).alertes[0].reference, 98);

console.log('\n== Nouveau portail ==');
const sansLeNouveau = [run({ ERA: 100 }), run({ ERA: 100 })];
verifier('portail inédit non signalé', evaluerSante({ ERA: 100, Biddit: 5 }, sansLeNouveau).alertes, []);

console.log('\n== Enregistrement de l\'historique ==');
let runs = [];
for (let i = 0; i < 25; i++) runs = enregistrerRun(runs, { ERA: i }, `2026-09-${String(i + 1).padStart(2, '0')}`, { maxRuns: 20 });
verifier('taille bornée à 20', runs.length, 20);
verifier('le plus ancien évincé', runs[0].parPortail.ERA, 5);
verifier('le plus récent conservé', runs[runs.length - 1].parPortail.ERA, 24);

console.log(`\n${'─'.repeat(50)}`);
console.log(echecs === 0 ? `✅ ${total}/${total} tests passés` : `❌ ${echecs} échec(s) sur ${total} tests`);
process.exit(echecs === 0 ? 0 : 1);
