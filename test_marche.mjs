/**
 * Tests de la référence de marché par commune.
 * Lancer : node test_marche.mjs
 */

import { calculerMarche, ecartAuMarche } from './lib/marche.mjs';

let echecs = 0;
let total = 0;
function verifier(libelle, obtenu, attendu) {
    total++;
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}${ok ? '' : `\n       obtenu  : ${JSON.stringify(obtenu)}\n       attendu : ${JSON.stringify(attendu)}`}`);
}

const bien = (commune, prixM2) => ({ commune, prixM2 });
const n = (commune, combien, prixM2) => Array.from({ length: combien }, () => bien(commune, prixM2));

console.log('\n== Médiane par commune ==');
const m1 = calculerMarche([...n('Wavre', 4, 2000), ...n('Wavre', 5, 3000)], { minEchantillon: 8 });
verifier('médiane sur 9 biens', m1.get('Wavre'), { mediane: 3000, n: 9 });
verifier(
    'médiane sur un nombre pair : moyenne des deux centrales',
    calculerMarche([bien('Wavre', 2000), bien('Wavre', 2400), ...n('Wavre', 6, 3000)], { minEchantillon: 4 }).get('Wavre').mediane,
    3000,
);
// Une maison de 930 m² à 414 €/m² existe vraiment dans les données.
verifier(
    'une valeur aberrante ne déplace pas la médiane',
    calculerMarche([bien('Wavre', 414), ...n('Wavre', 8, 2500)], { minEchantillon: 4 }).get('Wavre').mediane,
    2500,
);

console.log('\n== Échantillon trop mince : on se tait ==');
const m2 = calculerMarche(n('Incourt', 3, 2888), { minEchantillon: 8 });
verifier('commune à 3 biens absente du référentiel', m2.has('Incourt'), false);
verifier('aucun écart publié pour elle', ecartAuMarche(bien('Incourt', 2000), m2), null);

console.log('\n== Écart au marché ==');
const m3 = calculerMarche(n('Rixensart', 10, 3000), { minEchantillon: 8 });
verifier('20 % sous le marché', ecartAuMarche(bien('Rixensart', 2400), m3), { pct: -20, mediane: 3000, n: 10 });
verifier('10 % au-dessus', ecartAuMarche(bien('Rixensart', 3300), m3), { pct: 10, mediane: 3000, n: 10 });
verifier('au prix du marché', ecartAuMarche(bien('Rixensart', 3000), m3).pct, 0);
// Le cœur du problème : c'est la commune du bien qui sert de référence.
const m4 = calculerMarche([...n('Rixensart', 10, 3160), ...n('Liedekerke', 10, 2158)], { minEchantillon: 8 });
verifier('même prix/m², jugements opposés — Rixensart', ecartAuMarche(bien('Rixensart', 2400), m4).pct, -24);
verifier('  … et Liedekerke', ecartAuMarche(bien('Liedekerke', 2400), m4).pct, 11);

console.log('\n== Données manquantes ==');
verifier('bien sans prix au m²', ecartAuMarche({ commune: 'Rixensart' }, m3), null);
verifier('bien sans commune', ecartAuMarche({ prixM2: 2400 }, m3), null);
verifier('commune inconnue du référentiel', ecartAuMarche(bien('Ailleurs', 2400), m3), null);
verifier('liste vide', calculerMarche([]).size, 0);
verifier('entrée nulle', calculerMarche(null).size, 0);
verifier('référentiel absent', ecartAuMarche(bien('Wavre', 2400), null), null);

console.log(`\n${'─'.repeat(50)}`);
console.log(echecs === 0 ? `✅ ${total}/${total} tests passés` : `❌ ${echecs} échec(s) sur ${total} tests`);
process.exit(echecs === 0 ? 0 : 1);
