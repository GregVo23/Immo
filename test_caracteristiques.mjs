/**
 * Tests des caractéristiques lues sur les fiches de détail.
 * Tous les cas viennent de pages réellement sondées (une par portail).
 * Lancer : node test_caracteristiques.mjs
 */

import { lireCaracteristiques, CHAMPS_CARACTERISTIQUES } from './lib/caracteristiques.mjs';

let echecs = 0;
let total = 0;

function verifier(libelle, obtenu, attendu) {
    total++;
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}${ok ? '' : `\n       obtenu  : ${JSON.stringify(obtenu)}\n       attendu : ${JSON.stringify(attendu)}`}`);
}

/* ------------------------------------------------------------
   Forme 1 : paires structurées (Immoweb, Trior, Trevi)
   ------------------------------------------------------------ */
console.log('\n== Paires structurées ==');
const immoweb = {
    faits: [
        ['État du bâtiment', 'À rénover'],
        ['Nombre de façades', '4'],
        ['Largeur de la façade à rue', '21 m'],
        ['Travaux de renovation obligatoire', 'Non communiqué'],
        ['Numéro unique du certificat PEB', 'Non communiqué'],
    ],
    lignes: [],
};
verifier('Immoweb : état + façades', lireCaracteristiques(immoweb), { facades: 4, etatBien: 'À rénover' });
verifier(
    '« Non communiqué » n\'invente rien',
    lireCaracteristiques({ faits: [['Année de construction', 'Non communiqué']], lignes: [] }),
    {},
);
verifier(
    '« Largeur de la façade » n\'est pas un nombre de façades',
    lireCaracteristiques({ faits: [['Largeur de la façade à rue', '21 m']], lignes: [] }),
    {},
);

/* ------------------------------------------------------------
   Forme 2 : libellé et valeur sur la MÊME ligne
   ------------------------------------------------------------ */
console.log('\n== Libellé et valeur sur la même ligne ==');
// Trior colle deux paires bout à bout, sans séparateur.
verifier(
    'Trior : « 1850Parking extérieur Oui » → 1850',
    lireCaracteristiques({ faits: [], lignes: ['Année de construction 1850Parking extérieur Oui'] }),
    { anneeConstruction: 1850 },
);
verifier(
    'Trior : PEB chiffré collé au code unique',
    lireCaracteristiques({ faits: [], lignes: ['PEB E-SPEC (kwh/m²/an) 548PEB code unique 20251120-0003521092-RES-2'] }),
    { pebKwh: 548 },
);
verifier(
    'Zimmo : « Année de construction 1975 »',
    lireCaracteristiques({ faits: [], lignes: ['Année de construction 1975'] }),
    { anneeConstruction: 1975 },
);

/* ------------------------------------------------------------
   Forme 3 : valeur sur la ligne SUIVANTE
   ------------------------------------------------------------ */
console.log('\n== Valeur sur la ligne suivante ==');
const immovlan = {
    faits: [],
    lignes: ['Etat du bien', 'À rénover', 'Année de construction', '1970', 'Revenu cadastral', '1 016 €', 'Nombre de façades', '3'],
};
verifier('Immovlan : les quatre champs', lireCaracteristiques(immovlan), {
    anneeConstruction: 1970,
    facades: 3,
    revenuCadastral: 1016,
    etatBien: 'À rénover',
});
verifier(
    'ERA : « €1730,00 » → 1730',
    lireCaracteristiques({ faits: [], lignes: ['Revenu cadastral net', '€1730,00'] }),
    { revenuCadastral: 1730 },
);
verifier(
    'Zimmo : « 247kWh/m² »',
    lireCaracteristiques({ faits: [], lignes: ['Valeur EPC', '247kWh/m²'] }),
    { pebKwh: 247 },
);

/* ------------------------------------------------------------
   Plages de validité — les deux pièges relevés chez Century21
   ------------------------------------------------------------ */
console.log('\n== Valeurs aberrantes écartées ==');
// Cas réel : le libellé « Façades » est suivi de la surface du terrain.
verifier(
    'Century21 : « Façades → 420 m² » n\'est pas un nombre de façades',
    lireCaracteristiques({ faits: [], lignes: ['Façades', '420 m²', 'Nombre de façades', '2'] }),
    { facades: 2 },
);
// Cas réel : Century21 affiche « 1111 » comme année de construction.
verifier(
    'Century21 : une construction en 1111 est écartée',
    lireCaracteristiques({ faits: [], lignes: ['Année de construction', '1111'] }),
    {},
);
verifier(
    'année dans le futur lointain écartée',
    lireCaracteristiques({ faits: [], lignes: ['Année de construction', '2099'] }),
    {},
);
verifier(
    'revenu cadastral absurde écarté',
    lireCaracteristiques({ faits: [], lignes: ['Revenu cadastral', '999 999 999 €']}),
    {},
);
verifier('entrée vide', lireCaracteristiques({}), {});
verifier('entrée nulle', lireCaracteristiques(null), {});

/* ------------------------------------------------------------
   PEB chiffré : reconnu par son unité, pas par son libellé
   ------------------------------------------------------------ */
console.log('\n== PEB en kWh/m²/an ==');
verifier(
    'Immoweb : « Consommation d\'énergie primaire 342 kWh/m² »',
    lireCaracteristiques({ faits: [], lignes: ["Consommation d'énergie primaire 342 kWh/m² kilowattheure par mètre carré"] }),
    { pebKwh: 342 },
);
// Le piège : la même fiche publie aussi la consommation TOTALE du logement.
verifier(
    'la consommation totale en kWh/an est ignorée',
    lireCaracteristiques({ faits: [], lignes: ["Consommation théorique totale d'énergie primaire 54000 kWh/an"] }),
    {},
);
verifier(
    'et quand les deux cohabitent, c\'est bien celle au m² qui sort',
    lireCaracteristiques({
        faits: [],
        lignes: ["Consommation théorique totale d'énergie primaire 54000 kWh/an", "Consommation d'énergie primaire 342 kWh/m²"],
    }),
    { pebKwh: 342 },
);
verifier(
    'ERA : valeur entre parenthèses dans une ligne composite',
    lireCaracteristiques({ faits: [], lignes: ['PEB C (215 kWh/m².an) – Électricité non conforme – RC : 1.730 €'] }),
    { pebKwh: 215, revenuCadastral: 1730 },
);
verifier(
    'Immovlan : ligne sans libellé',
    lireCaracteristiques({ faits: [], lignes: ['150 kWh/m²/an'] }),
    { pebKwh: 150 },
);
verifier(
    'Immoweb : séparateur de milliers dans le revenu cadastral',
    lireCaracteristiques({ faits: [['Revenu cadastral', '1.234 €']], lignes: [] }),
    { revenuCadastral: 1234 },
);

verifier(
    'un PEB à 1 kWh/m² est écarté (habitation impossible)',
    lireCaracteristiques({ faits: [], lignes: ['Valeur EPC', '1'] }),
    {},
);
verifier(
    'un revenu cadastral à 1 € est écarté',
    lireCaracteristiques({ faits: [['Revenu cadastral', '1 €']], lignes: [] }),
    {},
);
// Le report doit pouvoir RETIRER une valeur, pas seulement en ajouter :
// sans cette liste, une règle corrigée laissait l'ancienne valeur en place.
verifier(
    'les champs gérés sont tous déclarés',
    [...CHAMPS_CARACTERISTIQUES].sort(),
    ['anneeConstruction', 'etatBien', 'facades', 'pebKwh', 'revenuCadastral', 'surfaceHabitableFiche', 'surfaceTerrainFiche'],
);

/* ------------------------------------------------------------
   Surfaces : la fiche corrige la carte
   ------------------------------------------------------------ */
console.log('\n== Surfaces libellées sur la fiche ==');
verifier(
    'surface habitable et terrain distinctes',
    lireCaracteristiques({ faits: [['Surface habitable', '146 m² mètres carrés'], ['Surface du terrain', '780 m²']], lignes: [] }),
    { surfaceHabitableFiche: 146, surfaceTerrainFiche: 780 },
);
// Cas réel : « Maison 3 ch. à Ternat, 727 m² » — la carte n'affichait qu'une
// surface, sans libellé, et c'était le terrain. La fiche ne donne aucune
// surface habitable, seulement le détail pièce par pièce.
verifier(
    'Ternat : la fiche ne donne QUE le terrain',
    lireCaracteristiques({
        faits: [],
        lignes: ['Surface du salon 25 m²', 'Surface de la chambre 1 15 m²', 'Surface du terrain 727 m²'],
    }),
    { surfaceTerrainFiche: 727 },
);
verifier(
    '« Surface du salon » n\'est pas la surface habitable',
    lireCaracteristiques({ faits: [], lignes: ['Surface du salon 25 m²'] }),
    {},
);
verifier(
    '« Surface du jardin » n\'est pas le terrain',
    lireCaracteristiques({ faits: [['Surface du jardin', '780 m²']], lignes: [] }),
    {},
);
verifier(
    'habitable aberrante écartée (plancher 20 m²)',
    lireCaracteristiques({ faits: [['Surface habitable', '7 m²']], lignes: [] }),
    {},
);

/* ------------------------------------------------------------ */
console.log(`\n${'─'.repeat(50)}`);
console.log(echecs === 0 ? `✅ ${total}/${total} tests passés` : `❌ ${echecs} échec(s) sur ${total} tests`);
process.exit(echecs === 0 ? 0 : 1);
