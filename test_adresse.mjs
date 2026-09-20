/**
 * Tests de l'extraction d'adresse exacte, sur des chaînes RÉELLES relevées
 * sur les pages de détail des portails.
 * Lancer : node test_adresse.mjs
 */

import { extraireAdresse, decouperLigneAdresse, estAdresseMasquee } from './lib/adresse_detail.mjs';

let echecs = 0;
let total = 0;

function verifier(libelle, obtenu, attendu) {
    total++;
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}${ok ? '' : `\n       obtenu  : ${JSON.stringify(obtenu)}\n       attendu : ${JSON.stringify(attendu)}`}`);
}

console.log('\n== Immoweb : séparateur tiret cadratin ==');
verifier('adresse FR', decouperLigneAdresse('Rue De Tirlemont 32 1390 — Grez-Doiceau'), { rue: 'Rue De Tirlemont 32', cp: '1390', ville: 'Grez-Doiceau' });
verifier('adresse NL', decouperLigneAdresse('Kleine Geeststraat 133 1933 — Sterrebeek'), { rue: 'Kleine Geeststraat 133', cp: '1933', ville: 'Sterrebeek' });
verifier('numéro 0 accepté', decouperLigneAdresse('Chemin Basse Franchise 0 1430 — Rebecq'), { rue: 'Chemin Basse Franchise 0', cp: '1430', ville: 'Rebecq' });
verifier('ville en capitales', decouperLigneAdresse('Koldamstraat 8 1560 — HOEILAART'), { rue: 'Koldamstraat 8', cp: '1560', ville: 'HOEILAART' });
verifier('steenweg + suffixe "bis"', decouperLigneAdresse('Assesteenweg 339bis 1741 — Ternat'), { rue: 'Assesteenweg 339bis', cp: '1741', ville: 'Ternat' });

console.log('\n== Numéro de rue à 4 chiffres (piège du code postal) ==');
// Vu en production : "1065" est le NUMÉRO, "1703" le code postal. Prendre le
// premier candidat donnait rue="Ninoofsesteenweg", cp="1065", ville="1703 — Dilbeek".
verifier(
    'numéro 1065 non confondu avec un CP',
    decouperLigneAdresse('Ninoofsesteenweg 1065 1703 — Dilbeek'),
    { rue: 'Ninoofsesteenweg 1065', cp: '1703', ville: 'Dilbeek' },
);
verifier(
    'autre numéro à 4 chiffres',
    decouperLigneAdresse('Brusselsesteenweg 2100 1780 — Wemmel'),
    { rue: 'Brusselsesteenweg 2100', cp: '1780', ville: 'Wemmel' },
);

console.log('\n== Immovlan : séparateur virgule ==');
verifier('virgule avant le CP', decouperLigneAdresse('Rue rené sacré 6 , 1367 Ramillies-Offus'), { rue: 'Rue rené sacré 6', cp: '1367', ville: 'Ramillies-Offus' });
verifier('numéro en deux morceaux', decouperLigneAdresse('Rue de la Station 1 02 , 1350 Orp-le-Grand'), { rue: 'Rue de la Station 1 02', cp: '1350', ville: 'Orp-le-Grand' });

console.log('\n== Adresses NON publiées : ne rien inventer ==');
verifier('"Demander l\'adresse exacte"', decouperLigneAdresse("1315 — INCOURT Demander l'adresse exacte"), null);
verifier('idem, autre commune', decouperLigneAdresse("1430 — REBECQ Demander l'adresse exacte"), null);
verifier('"Adresse sur demande"', decouperLigneAdresse('Adresse sur demande, 1650 Beersel'), null);
verifier('détecteur de masquage', estAdresseMasquee("Demander l'adresse exacte"), true);
verifier('adresse normale non masquée', estAdresseMasquee('Rue De Tirlemont 32'), false);

console.log('\n== Lignes qui ne sont PAS des adresses ==');
verifier('commune seule, sans voirie', decouperLigneAdresse('1390 — Grez-Doiceau'), null);
verifier('sans code postal', decouperLigneAdresse('Rue De Tirlemont 32'), null);
// Ces lignes contiennent "rue" mais décrivent une caractéristique du bien :
// sans code postal elles sont écartées, ce qui suffit à les neutraliser.
verifier('"Largeur de la façade à rue 14 m"', decouperLigneAdresse('Largeur de la façade à rue 14 m'), null);
verifier('"Terrain à front de rue Non"', decouperLigneAdresse('Terrain à front de rue Non'), null);
verifier('chaîne vide', decouperLigneAdresse(''), null);
verifier('null', decouperLigneAdresse(null), null);

console.log('\n== Cascade d\'extraction ==');
verifier(
    'JSON-LD prioritaire (Century21)',
    extraireAdresse({ jsonLdAdresse: { streetAddress: 'Marius Duchéstraat 155', postalCode: '1800', addressLocality: 'Vilvoorde' }, texteSelecteur: null, lignesTexte: [] }),
    { rue: 'Marius Duchéstraat 155', cp: '1800', ville: 'Vilvoorde', origine: 'json-ld' },
);
verifier(
    'sélecteur dédié quand pas de JSON-LD (Immoweb)',
    extraireAdresse({ jsonLdAdresse: null, texteSelecteur: 'Fossebaan 101 1740 — Ternat', lignesTexte: ['autre chose'] }),
    { rue: 'Fossebaan 101', cp: '1740', ville: 'Ternat', origine: 'selecteur' },
);
verifier(
    'repli sur le texte (Immovlan)',
    extraireAdresse({ jsonLdAdresse: null, texteSelecteur: null, lignesTexte: ['Maison à vendre', 'Rue Sainte-Catherine 71 , 1370 Piétrain'] }),
    { rue: 'Rue Sainte-Catherine 71', cp: '1370', ville: 'Piétrain', origine: 'texte' },
);
verifier(
    'sélecteur masqué → repli texte, pas d\'invention',
    extraireAdresse({ jsonLdAdresse: null, texteSelecteur: "1315 — INCOURT Demander l'adresse exacte", lignesTexte: ['rien d\'exploitable'] }),
    null,
);
verifier('aucune source exploitable', extraireAdresse({ jsonLdAdresse: null, texteSelecteur: null, lignesTexte: [] }), null);
verifier('entrée vide', extraireAdresse({}), null);
verifier('entrée nulle', extraireAdresse(null), null);

console.log(`\n${'─'.repeat(50)}`);
console.log(echecs === 0 ? `✅ ${total}/${total} tests passés` : `❌ ${echecs} échec(s) sur ${total} tests`);
process.exit(echecs === 0 ? 0 : 1);
