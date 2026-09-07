/**
 * Tests du parsing sur des cas réels observés dans les données.
 * Lancer : node test_parse.mjs
 */

import { construireAnnonce, dedupliquer, parseSurfaces, parsePieces, parseStatut, parseJoursEnLigne, parsePeb, parseCpEtVilleDepuisLien, parseTypeBien } from './lib/parse.mjs';
import { SITES } from './config.mjs';
import { TYPES_EXCLUS as TYPES_EXCLUS_TEST } from './parse_annonces.mjs';

/** Les vrais hints du portail, pour tester ce qui tournera en production. */
const hintsDe = (source) => Object.values(SITES).find((s) => s.source === source)?.hints ?? {};

let echecs = 0;
let total = 0;

function verifier(libelle, obtenu, attendu) {
    total++;
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`  ${ok ? '✅' : '❌'} ${libelle}${ok ? '' : `\n       obtenu  : ${JSON.stringify(obtenu)}\n       attendu : ${JSON.stringify(attendu)}`}`);
}

/* ------------------------------------------------------------
   CENTURY21 — fragments relevés dans debug/century21.html
   ------------------------------------------------------------ */
console.log('\n== Century21 (nombres nus : chambres, sdb, surface) ==');

const c21 = construireAnnonce(
    {
        fragments: ['Previous', 'Next', '1 / 24', 'Maison', "1420 Braine-l'Alleud", '€ 899.000', '5', '2', '286 m²'],
        lien: "https://www.century21.be/fr/properiete/a-vendre/maison/braine-l'alleud/ltaOb58Bn7MGa5hc3gO-",
        imageUrl: 'https://images.century21.be/abc.jpg',
        source: 'Century21',
        dateExtraction: '2026-09-06T10:00:00.000Z',
    },
    hintsDe('Century21'),
);

verifier('prix', c21.prix, 899000);
verifier('cp', c21.cp, '1420');
verifier('commune', c21.commune, "Braine-l'Alleud");
verifier('chambres', c21.chambres, 5);
verifier('salles de bain', c21.sallesDeBain, 2);
verifier('surface habitable', c21.surfaceHabitable, 286);
verifier('prix/m²', c21.prixM2, 3143);
verifier('type', c21.typeBien, 'Maison');
verifier('dans le périmètre', c21.dansPerimetre, true);
verifier('titre fabriqué', c21.titre, "Maison 5 ch. à Braine-l'Alleud");

const c21b = construireAnnonce(
    {
        fragments: ['1 / 33', 'Nouvelle construction', 'Maison', '1930 Zaventem', '€ 499.000', '3', '1', '198 m²'],
        lien: 'https://www.century21.be/fr/properiete/a-vendre/maison/zaventem/9YRPIZ8BALnUk-JFb8uE',
        source: 'Century21',
        dateExtraction: '2026-09-06T10:00:00.000Z',
    },
    hintsDe('Century21'),
);
verifier('2e bien : 3 ch / 1 sdb / 198 m²', [c21b.chambres, c21b.sallesDeBain, c21b.surfaceHabitable], [3, 1, 198]);

/* ------------------------------------------------------------
   ERA — texte réel des annonces déjà collectées
   ------------------------------------------------------------ */
console.log('\n== ERA (rue + numéro, surfaces libellées) ==');

const era = construireAnnonce(
    {
        fragments: [
            'Magnifique maison bel-étage 3 chambres avec garage et jardin',
            'Koningin Astridstraat 39, 1730 Asse',
            '€ 375 000',
            '4 chambres',
            '193 m² de surface habitable',
            '115 m² de surface de terrain',
        ],
        lien: 'https://www.era.be/fr/a-vendre/asse/maison/magnifique-maison-bel-etage',
        source: 'ERA',
        dateExtraction: '2026-09-06T10:00:00.000Z',
    },
    {},
);

verifier('prix (espace insécable)', era.prix, 375000);
verifier('cp', era.cp, '1730');
verifier('rue extraite', era.rue, 'Koningin Astridstraat 39');
verifier('habitable ≠ terrain', [era.surfaceHabitable, era.surfaceTerrain], [193, 115]);
verifier('chambres', era.chambres, 4);
verifier('titre éditorial conservé', era.titre, 'Magnifique maison bel-étage 3 chambres avec garage et jardin');

/* ------------------------------------------------------------
   TREVI — le bug des 295 m² "habitables"
   ------------------------------------------------------------ */
console.log('\n== Trevi (surface ambiguë) ==');

const trevi = construireAnnonce(
    {
        fragments: ['Maison', '1310 la Hulpe', '395.000 €', '4 chbres', '165 m² habitable', '295 m² de terrain'],
        lien: 'https://www.trevi.be/fr/bien/7222927/41/maison/La%20Hulpe',
        source: 'Trevi',
        dateExtraction: '2026-09-06T10:00:00.000Z',
    },
    {},
);
verifier('prix suffixé', trevi.prix, 395000);
verifier('terrain non confondu avec habitable', [trevi.surfaceHabitable, trevi.surfaceTerrain], [165, 295]);
verifier('chbres', trevi.chambres, 4);

// Deux valeurs nues : la première est l'habitable (ordre d'affichage constaté
// sur les 5 portails), la seconde le terrain.
const deuxNues = parseSurfaces(['200 m²', '450 m²'], {});
verifier('deux m² nus → 1re = habitable', deuxNues.surfaceHabitable, 200);
verifier('  → 2e = terrain', deuxNues.surfaceTerrain, 450);
verifier('  → non ambigu (ordre connu)', deuxNues.surfacesAmbigues, false);
// Trois valeurs ou plus : on ne sait plus, on le signale.
verifier('trois m² nus → ambigu', parseSurfaces(['200 m²', '450 m²', '80 m²'], {}).surfacesAmbigues, true);

// Garde-fou : pas de maison de 3000 m² habitables
const aberrant = parseSurfaces(['3000 m²'], {});
verifier('habitable aberrant rejeté', [aberrant.surfaceHabitable, aberrant.surfacesAmbigues], [null, true]);

// ERA écrit les milliers à l'anglaise : "1,829 m²" = 1829 m², pas 1,829 m².
const milliers = parseSurfaces(['187 m² de surf. hab.', '1,829 m² de surface de terrain'], {});
verifier('"1,829 m²" = 1829 m² de terrain', milliers.surfaceTerrain, 1829);
verifier('  → habitable inchangé', milliers.surfaceHabitable, 187);
verifier('"1.262 m²" (point) = 1262 m²', parseSurfaces(['1.262 m² de surface de terrain'], {}).surfaceTerrain, 1262);
verifier('"12,5 m²" reste un décimal', parseSurfaces(['12,5 m² habitable'], {}).surfaceHabitable, 13);
verifier('"148 m²" sans séparateur', parseSurfaces(['148 m²'], {}).surfaceHabitable, 148);

/* ------------------------------------------------------------
   Pièges sur les libellés courts
   ------------------------------------------------------------ */
console.log('\n== Faux positifs ==');
verifier('"2 chauffages" ne donne pas de chambres', parsePieces(['2 chauffages'], {}).chambres, null);
verifier('"chauffage central" seul', parsePieces(['chauffage central au gaz'], {}).chambres, null);
verifier('"1 cheminée" non confondu', parsePieces(['1 cheminée'], {}).chambres, null);
verifier('"2 chalets" non confondu', parsePieces(['2 chalets de jardin'], {}).chambres, null);
verifier('"3 ch." reconnu', parsePieces(['3 ch.'], {}).chambres, 3);
verifier('"4 slaapkamers" reconnu', parsePieces(['4 slaapkamers'], {}).chambres, 4);

/* ------------------------------------------------------------
   Hors périmètre
   ------------------------------------------------------------ */
console.log('\n== Filtre géographique ==');
const berlaar = construireAnnonce(
    { fragments: ['Maison à vendre', '2590 Berlaar', '€ 413.500', '130 m²'], lien: 'https://www.zimmo.be/fr/berlaar-2590/a-vendre/maison/LNP8A/', source: 'Zimmo', dateExtraction: '' },
    {},
);
verifier('Berlaar (2590) hors périmètre', berlaar.dansPerimetre, false);

const lln = construireAnnonce(
    { fragments: ['Maison', '1348 Louvain-la-Neuve', '€ 450.000', '3 chambres', '160 m² habitable'], lien: 'https://x.be/a', source: 'Test', dateExtraction: '' },
    {},
);
verifier('LLN (1348) DANS le périmètre', lln.dansPerimetre, true);
verifier('  → commune rattachée', lln.commune, 'Ottignies-Louvain-la-Neuve');

const genval = construireAnnonce(
    { fragments: ['Villa', '1332 Genval', '€ 480.000', '4 chambres', '210 m² habitable'], lien: 'https://x.be/b', source: 'Test', dateExtraction: '' },
    {},
);
verifier('Genval (1332) → Rixensart', genval.commune, 'Rixensart');

/* ------------------------------------------------------------
   Déduplication inter-sites
   ------------------------------------------------------------ */
console.log('\n== Déduplication ==');

const base = (o) => construireAnnonce({ dateExtraction: '', ...o }, o.hints ?? {});

const lot = [
    // même bien, deux portails, même rue + numéro
    base({ fragments: ['Belle maison', 'Rue Haute 12, 1410 Waterloo', '€ 420.000', '3 chambres', '150 m² habitable'], lien: 'https://www.era.be/fr/a-vendre/waterloo/x', source: 'ERA' }),
    base({ fragments: ['Maison', 'Rue Haute 12, 1410 Waterloo', '€ 425.000', '3 chambres', '150 m² habitable'], lien: 'https://www.zimmo.be/fr/waterloo/y', source: 'Zimmo' }),
    // même bien sans rue, mais mêmes caractéristiques
    base({ fragments: ['Maison', '1700 Dilbeek', '€ 390.000', '4 chambres', '180 m² habitable'], lien: 'https://www.century21.be/fr/properiete/a', source: 'Century21' }),
    base({ fragments: ['Maison', '1700 Dilbeek', '€ 392.000', '4 chambres', '180 m² habitable'], lien: 'https://www.trevi.be/fr/bien/1/a', source: 'Trevi' }),
    // même lien vu deux fois (paramètres de recherche différents)
    base({ fragments: ['Maison', '1800 Vilvoorde', '€ 350.000', '3 chambres', '140 m² habitable'], lien: 'https://www.zimmo.be/fr/vilvoorde/z?search=abc' }),
    base({ fragments: ['Maison', '1800 Vilvoorde', '€ 350.000', '3 chambres', '140 m² habitable'], lien: 'https://www.zimmo.be/fr/vilvoorde/z?search=def' }),
    // bien distinct
    base({ fragments: ['Maison', '1400 Nivelles', '€ 310.000', '2 chambres', '110 m² habitable'], lien: 'https://www.era.be/fr/a-vendre/nivelles/q', source: 'ERA' }),
];

const { annonces: dedup, stats } = dedupliquer(lot);
verifier('7 annonces → 4 biens uniques', dedup.length, 4);
verifier('doublons même lien', stats.doublonsMemeLien, 1);
verifier('doublons même adresse', stats.doublonsMemeAdresse, 1);
verifier('doublons mêmes caractéristiques', stats.doublonsMemesCaracteristiques, 1);

const waterloo = dedup.find((a) => a.cp === '1410');
verifier('bien multi-portail marqué', waterloo.multiSource, true);
verifier('  → sources fusionnées', waterloo.sources.sort(), ['ERA', 'Zimmo']);
verifier('  → lien alternatif conservé', waterloo.autresLiens.length, 1);
verifier('  → titre le plus riche retenu', waterloo.titre, 'Belle maison');

// Fusion en cascade : le même bien sur 3 portails, rassemblé par deux clés
// différentes (adresse pour deux d'entre eux, caractéristiques pour le 3e).
// Sans accumulation, la passe 3 écrasait les sources trouvées à la passe 2.
console.log('\n== Fusion en cascade (3 portails) ==');
const cascade = [
    base({ fragments: ['Maison à rénover', 'Avenue du Parc 8, 1400 Nivelles', '€ 400.000', '3 chambres', '145 m² habitable'], lien: 'https://www.era.be/fr/a-vendre/nivelles/aa', source: 'ERA' }),
    base({ fragments: ['Maison', 'Avenue du Parc 8, 1400 Nivelles', '€ 401.000', '3 chambres', '145 m² habitable'], lien: 'https://www.zimmo.be/fr/nivelles/bb', source: 'Zimmo' }),
    // pas de rue : ne peut être rattaché que par les caractéristiques
    base({ fragments: ['Maison', '1400 Nivelles', '€ 402.000', '3 chambres', '145 m² habitable'], lien: 'https://www.trevi.be/fr/bien/9/cc', source: 'Trevi' }),
];
const { annonces: fusion } = dedupliquer(cascade);
verifier('3 annonces → 1 bien', fusion.length, 1);
verifier('les 3 portails conservés', fusion[0].sources.sort(), ['ERA', 'Trevi', 'Zimmo']);
verifier('les 2 liens alternatifs conservés', fusion[0].autresLiens.length, 2);
verifier('le lien principal exclu des alternatifs', fusion[0].autresLiens.some((l) => l.lien === fusion[0].lien), false);

/* ------------------------------------------------------------
   FRAGMENTS RÉELS relevés dans annonces-brutes.json après un run complet.
   Ce sont ces cas qui ont révélé les bugs les plus coûteux.
   ------------------------------------------------------------ */
console.log('\n== Fragments réels : Century21 ==');

// Le compteur de photos arrive en 3 fragments séparés ("1", "/", "30").
// Compter « les 2 premiers entiers nus » donnait 1 chambre et 30 sdb.
const c21reel = construireAnnonce(
    { fragments: ['1', '/', '30', 'Maison', '1800', 'Vilvoorde', '€ 385.000', '3', '2', '163 m²'], lien: 'https://www.century21.be/fr/properiete/x', source: 'Century21', dateExtraction: '' },
    hintsDe('Century21'),
);
verifier('chambres = 3 (pas 1)', c21reel.chambres, 3);
verifier('sdb = 2 (pas 30)', c21reel.sallesDeBain, 2);
verifier('surface = 163', c21reel.surfaceHabitable, 163);
verifier('prix', c21reel.prix, 385000);
verifier('CP en fragment isolé → commune', c21reel.commune, 'Vilvoorde');

const c21vendu = construireAnnonce(
    { fragments: ['1', '/', '27', 'Maison', '1470', 'Genappe', 'Vendu', '4', '2', '240 m²'], lien: 'https://www.century21.be/fr/properiete/y', source: 'Century21', dateExtraction: '' },
    hintsDe('Century21'),
);
verifier('statut vendu détecté', c21vendu.statut, 'vendu');
verifier('  → chambres lues malgré le statut', c21vendu.chambres, 4);
verifier('  → prix absent non signalé comme manquant', c21vendu.champsManquants.includes('prix'), false);

console.log('\n== Fragments réels : Zimmo ==');

// Ici le nombre de chambres suit la surface, et "17j" = jours en ligne.
const zimmoReel = construireAnnonce(
    { fragments: ['€ 369.000', 'Sous option', 'Maison à vendre', 'Zwijndrechtsestraat 23', '2070 Burcht', '17j', '132m²', '3'], lien: 'https://www.zimmo.be/fr/burcht-2070/a-vendre/maison/X/', source: 'Zimmo', dateExtraction: '' },
    hintsDe('Zimmo'),
);
verifier('chambres après la surface = 3', zimmoReel.chambres, 3);
verifier('surface collée "132m²"', zimmoReel.surfaceHabitable, 132);
verifier('statut option', zimmoReel.statut, 'option');
verifier('jours en ligne', zimmoReel.joursEnLigne, 17);
verifier('rue extraite', zimmoReel.rue, 'Zwijndrechtsestraat 23');
verifier('hors périmètre (Burcht)', zimmoReel.dansPerimetre, false);
verifier('"17j" non pris pour des chambres', zimmoReel.sallesDeBain, null);

console.log('\n== Fragments réels : ERA ==');

const eraReel = construireAnnonce(
    {
        fragments: ['Show more', '1', '2', '3', '4', 'Ajouter aux favoris', 'Maison semi-mitoyenne avec vue dégagée', 'Moorselsteenweg 82, 1933 Sterrebeek', '€ 425 000', '3 chbre(s)', '178 m² de surf. hab.', '471 m² de surface de terrain', 'C'],
        lien: 'https://www.era.be/fr/a-vendre/sterrebeek/maison/x',
        source: 'ERA',
        dateExtraction: '',
    },
    hintsDe('ERA'),
);
verifier('PEB en lettre nue', eraReel.peb, 'C');
verifier('habitable vs terrain', [eraReel.surfaceHabitable, eraReel.surfaceTerrain], [178, 471]);
verifier('chbre(s)', eraReel.chambres, 3);
verifier('Sterrebeek (1933) → Zaventem', eraReel.commune, 'Zaventem');
verifier('vignettes 1-4 ignorées (pas de sdb)', eraReel.sallesDeBain, null);
verifier('statut disponible', eraReel.statut, 'disponible');

const eraOption = construireAnnonce(
    { fragments: ['Show more', '1', '2', '3', '4', 'En option', 'Ajouter aux favoris', 'Magnifique maison bel-étage', 'Prix sur demande', 'Asse', '4 chbre(s)', '193 m² de surf. hab.', 'B'], lien: 'https://www.era.be/fr/a-vendre/asse/maison/z', source: 'ERA', dateExtraction: '' },
    hintsDe('ERA'),
);
verifier('option détectée', eraOption.statut, 'option');
verifier('"Prix sur demande" → prix null', eraOption.prix, null);
verifier('  → signalé comme manquant (bien disponible)', eraOption.champsManquants.includes('prix'), true);
verifier('sans CP → hors périmètre', eraOption.dansPerimetre, false);

console.log('\n== Fragments réels : Trevi ==');

const treviReel = construireAnnonce(
    { fragments: ['460.000 €', 'À vendre', 'Maison', '1330 Rixensart', '3 chambres', '148 m²'], lien: 'https://www.trevi.be/fr/bien/1/2/maison/Rixensart', source: 'Trevi', dateExtraction: '' },
    hintsDe('Trevi'),
);
verifier('prix suffixé', treviReel.prix, 460000);
verifier('chambres', treviReel.chambres, 3);
verifier('surface unique = habitable', treviReel.surfaceHabitable, 148);
verifier('"À vendre" reste disponible', treviReel.statut, 'disponible');
verifier('pas de PEB inventé', treviReel.peb, null);

console.log('\n== Bruit d\'interface pris pour un titre ==');

// 13 annonces ERA affichaient "Ajouter aux favoris" comme titre : leur carte
// n'a pas de titre éditorial, seulement un bandeau "*** SOUS-OPTION ***".
const eraSansTitre = construireAnnonce(
    { fragments: ['Show more', '1', '2', '3', '4', 'En option', 'Ajouter aux favoris', '*** SOUS-OPTION ***', 'Rue de Namur 4, 1400 Nivelles', '€ 450 000', '4 chbre(s)', '137 m² de surf. hab.', 'D'], lien: 'https://www.era.be/fr/a-vendre/nivelles/maison/sous-option-4', source: 'ERA', dateExtraction: '' },
    hintsDe('ERA'),
);
verifier('"Ajouter aux favoris" pas retenu comme titre', eraSansTitre.titre.includes('favoris'), false);
// Aucun mot de type dans le texte : le type est déduit du segment /maison/ de l'URL.
verifier('titre fabriqué lisible (type via URL)', eraSansTitre.titre, 'Maison 4 ch. à Nivelles');
verifier('statut option lu malgré le nettoyage', eraSansTitre.statut, 'option');
verifier('  → "SOUS-OPTION" avec tiret détecté', parseStatut(['*** SOUS-OPTION ***']), 'option');
verifier('prix et PEB intacts', [eraSansTitre.prix, eraSansTitre.peb], [450000, 'D']);

console.log('\n== Prix "à partir de" ==');
const aPartirDe = construireAnnonce(
    { fragments: ['Ajouter aux favoris', 'MAISON 4 CH ATYPIQUE', 'Rue Test 1, 1420 Braine-l\'Alleud', 'À partir de € 450 000', '4 chbre(s)', '150 m² de surf. hab.'], lien: 'https://www.era.be/fr/a-vendre/braine/v', source: 'ERA', dateExtraction: '' },
    hintsDe('ERA'),
);
verifier('montant lu', aPartirDe.prix, 450000);
verifier('signalé comme prix de départ', aPartirDe.prixAPartirDe, true);
const prixFerme = construireAnnonce(
    { fragments: ['Maison', '1330 Rixensart', '460.000 €', '3 chambres', '148 m²'], lien: 'https://www.trevi.be/fr/bien/2/a', source: 'Trevi', dateExtraction: '' },
    hintsDe('Trevi'),
);
verifier('prix ferme non signalé', prixFerme.prixAPartirDe, false);

console.log('\n== Fusion faible : réservée aux portails différents ==');
// 3 lots d'un même projet neuf sur UN seul portail ne doivent pas fusionner.
const memeProjet = [
    base({ fragments: ['Maison', '1470', 'Genappe', '€ 480.000', '3', '1', '179 m²'], lien: 'https://www.century21.be/fr/properiete/l1', source: 'Century21', hints: hintsDe('Century21') }),
    base({ fragments: ['Maison', '1470', 'Genappe', '€ 480.000', '3', '1', '179 m²'], lien: 'https://www.century21.be/fr/properiete/l2', source: 'Century21', hints: hintsDe('Century21') }),
    base({ fragments: ['Maison', '1470', 'Genappe', '€ 481.000', '3', '1', '179 m²'], lien: 'https://www.century21.be/fr/properiete/l3', source: 'Century21', hints: hintsDe('Century21') }),
];
verifier('3 lots du même portail restent 3 biens', dedupliquer(memeProjet).annonces.length, 3);

// En revanche, deux portails différents = vrai doublon à rassembler.
const deuxPortails = [
    base({ fragments: ['Maison', '1470', 'Genappe', '€ 480.000', '3', '1', '179 m²'], lien: 'https://www.century21.be/fr/properiete/m1', source: 'Century21', hints: hintsDe('Century21') }),
    base({ fragments: ['Maison', '1470 Genappe', '481.000 €', '3 chambres', '179 m²'], lien: 'https://www.trevi.be/fr/bien/3/a', source: 'Trevi', hints: hintsDe('Trevi') }),
];
const rassembles = dedupliquer(deuxPortails).annonces;
verifier('2 portails → 1 bien', rassembles.length, 1);
verifier('  → marqué multi-portails', rassembles[0].multiSource, true);

console.log('\n== Fragments réels : Immovlan ==');

// Immovlan place la valeur et son unité dans DEUX éléments distincts :
// "3" puis "Chambre(s)", "154" puis "m²". Sans recollage, rien n'était lu.
const immovlan = construireAnnonce(
    {
        fragments: ['135 000 €', 'Maison à vendre', '7141', 'Carnières', '3', 'Chambre(s)', '154', 'm²', '1', 'Salle(s) de bain', 'Contacter', 'Détails', 'E-mail', 'Appeler'],
        lien: 'https://immovlan.be/fr/detail/maison/a-vendre/7141/carnieres/vbe61510',
        source: 'Immovlan',
        dateExtraction: '',
    },
    hintsDe('Immovlan'),
);
verifier('prix (espace comme séparateur)', immovlan.prix, 135000);
verifier('chambres recollées "3"+"Chambre(s)"', immovlan.chambres, 3);
verifier('surface recollée "154"+"m²"', immovlan.surfaceHabitable, 154);
verifier('sdb "1"+"Salle(s) de bain"', immovlan.sallesDeBain, 1);
verifier('CP puis ville en fragments séparés', [immovlan.cp, immovlan.ville], ['7141', 'Carnières']);
verifier('"Maison à vendre" pas retenu comme titre', immovlan.titre.includes('à vendre'), false);
verifier('titre fabriqué', immovlan.titre, 'Maison 3 ch. à Carnières');
verifier('Carnières hors périmètre', immovlan.dansPerimetre, false);

const immovlanBW = construireAnnonce(
    {
        fragments: ['425 000 €', 'Maison à vendre', '1410', 'Waterloo', '4', 'Chambre(s)', '198', 'm²', '2', 'Salle(s) de bain'],
        lien: 'https://immovlan.be/fr/detail/maison/a-vendre/1410/waterloo/rbw12345',
        source: 'Immovlan',
        dateExtraction: '',
    },
    hintsDe('Immovlan'),
);
verifier('bien du périmètre retenu', immovlanBW.dansPerimetre, true);
verifier('prix/m² calculé', immovlanBW.prixM2, 2146);
verifier('4 ch / 2 sdb / 198 m²', [immovlanBW.chambres, immovlanBW.sallesDeBain, immovlanBW.surfaceHabitable], [4, 2, 198]);

// Le recollage ne doit pas perturber Century21, dont les nombres nus sont
// suivis d'un fragment qui contient déjà sa propre unité ("163 m²").
verifier('Century21 non perturbé par le recollage', [c21reel.chambres, c21reel.sallesDeBain, c21reel.surfaceHabitable], [3, 2, 163]);

// "Surface constructible" : le libellé SUIT sa valeur. L'ancienne règle du
// « plus petit = habitable » donnait 65 m² habitables pour une maison de 172 m².
const constructible = construireAnnonce(
    {
        fragments: ['Prix modifié', '429 000 €', '9472', 'Iddergem', '3 Chambre(s)', '172 m²', '65 m²', 'Surface constructible'],
        lien: 'https://immovlan.be/fr/detail/maison/a-vendre/9472/iddergem/rbw1',
        source: 'Immovlan',
        dateExtraction: '',
    },
    hintsDe('Immovlan'),
);
verifier('habitable = 172 (pas 65)', constructible.surfaceHabitable, 172);
verifier('constructible à part, pas en terrain', [constructible.surfaceConstructible, constructible.surfaceTerrain], [65, null]);
verifier('non signalé ambigu', constructible.champsManquants.includes('surfacesAmbigues'), false);
verifier('"Prix modifié" capté', constructible.prixModifie, true);
verifier('prix/m² sur la bonne surface', constructible.prixM2, 2494);

// "àpd" = abréviation Immovlan de « à partir de »
const apd = construireAnnonce(
    {
        fragments: ['àpd', '340 000 €', '1420', "Braine-l'Alleud", '3 Chambre(s)', '1 Salle(s) de bain'],
        lien: 'https://immovlan.be/fr/detail/maison/a-vendre/1420/braine/rbw2',
        source: 'Immovlan',
        dateExtraction: '',
    },
    hintsDe('Immovlan'),
);
verifier('"àpd" → prix de départ', apd.prixAPartirDe, true);
verifier('prix ferme non marqué modifié', apd.prixModifie, false);

// Encarts promotionnels et boutons d'action ne doivent pas devenir des titres
const promo = construireAnnonce(
    {
        fragments: ['Best of', '348 000 €', '1770', 'Liedekerke', '3 Chambre(s)', '200 m²', 'Contacter', 'Détails', 'E-mail', 'Appeler'],
        lien: 'https://immovlan.be/fr/detail/maison/a-vendre/1770/liedekerke/rbw3',
        source: 'Immovlan',
        dateExtraction: '',
    },
    hintsDe('Immovlan'),
);
verifier('"Best of" écarté du titre', promo.titre, 'Maison 3 ch. à Liedekerke');
verifier('nom de ville seul pas retenu comme titre', promo.titre === 'Liedekerke', false);

console.log('\n== Fragments réels : Trior ==');

// Le CP n'apparaît nulle part dans le texte de la carte ("Waterloo" seul,
// jamais "1410 Waterloo") : il ne peut venir que de l'URL de l'annonce.
const triorReel = construireAnnonce(
    {
        fragments: ['4', '2', '230 m²', '1', 'Nouveau', 'Waterloo', 'Villa à vendre', '650 000 €'],
        lien: 'https://immo.trior.be/fr/bien/a-vendre/maison/1410-waterloo/7854102',
        imageUrl: 'https://r2.storagewhise.eu/triorwaterloo/Pictures/x.jpg',
        source: 'Trior',
        dateExtraction: '',
    },
    hintsDe('Trior'),
);
verifier('chambres/sdb avant la surface', [triorReel.chambres, triorReel.sallesDeBain], [4, 2]);
verifier('surface habitable', triorReel.surfaceHabitable, 230);
verifier('terrain en ares → m² (1 are)', triorReel.surfaceTerrain, 100);
verifier('CP retrouvé via le lien', triorReel.cp, '1410');
verifier('commune résolue', triorReel.commune, 'Waterloo');
verifier('dans le périmètre', triorReel.dansPerimetre, true);
// "Villa à vendre" est aussi générique que "Maison à vendre" : écarté au
// profit d'un titre fabriqué, comme pour Immovlan.
verifier('"Villa à vendre" générique écarté', triorReel.titre, 'Maison 4 ch. à Waterloo');
verifier('"Nouveau" écarté du parsing', triorReel.champsManquants.includes('surfacesAmbigues'), false);

const triorException = construireAnnonce(
    {
        fragments: ['5', '3', '340 m²', '8', 'Court-Saint-Etienne', 'Bien exceptionnel à vendre', '1 850 000 €'],
        lien: 'https://immo.trior.be/fr/bien/a-vendre/maison/1490-court-saint-etienne/7849727',
        source: 'Trior',
        dateExtraction: '',
    },
    hintsDe('Trior'),
);
verifier('prix avec espaces multiples', triorException.prix, 1850000);
verifier('8 ares → 800 m² de terrain', triorException.surfaceTerrain, 800);
verifier('commune Court-Saint-Étienne (accent) via CP', triorException.commune, 'Court-Saint-Étienne');

// Titre générique ("Maison à vendre") : doit être écarté comme chez Immovlan,
// au profit d'un titre fabriqué.
const triorGenerique = construireAnnonce(
    { fragments: ['3', '1', '145 m²', 'Nouveau', 'Lasne', 'Maison à vendre', '545 000 €'], lien: 'https://immo.trior.be/fr/bien/a-vendre/maison/1380-lasne/7852240', source: 'Trior', dateExtraction: '' },
    hintsDe('Trior'),
);
verifier('titre générique écarté', triorGenerique.titre, 'Maison 3 ch. à Lasne');
verifier('pas de terrain si aucun entier après la surface', triorGenerique.surfaceTerrain, null);

// Prix de départ, sur un immeuble à appartements
const triorAPartirDe = construireAnnonce(
    { fragments: ['5', '5', '350 m²', 'Nouveau', 'Bruxelles', 'Immeuble à appartements à vendre', 'À partir de', '895 000 €'], lien: 'https://immo.trior.be/fr/bien/a-vendre/maison/1020-bruxelles/7850710', source: 'Trior', dateExtraction: '' },
    hintsDe('Trior'),
);
verifier('prix de départ détecté', triorAPartirDe.prixAPartirDe, true);
verifier('titre distinctif conservé (pas générique)', triorAPartirDe.titre, 'Immeuble à appartements à vendre');
verifier('Bruxelles (1020) hors périmètre', triorAPartirDe.dansPerimetre, false);

// "Hors frais" (vu sur les appartements Trior, hors périmètre ici mais le
// parsing du signal doit fonctionner indépendamment du type de bien)
const triorHorsFrais = construireAnnonce(
    { fragments: ['2', '2', '113 m²', 'Nouveau', 'Evere', 'Penthouse à vendre', '485 000 €', 'Hors frais'], lien: 'https://immo.trior.be/fr/bien/a-vendre/appartement/1140-evere/7858777', source: 'Trior', dateExtraction: '' },
    hintsDe('Trior'),
);
verifier('"Hors frais" détecté', triorHorsFrais.prixHorsFrais, true);
verifier('prix quand même lu', triorHorsFrais.prix, 485000);

verifier('parseCpEtVilleDepuisLien : cas nominal', parseCpEtVilleDepuisLien('https://immo.trior.be/fr/bien/a-vendre/maison/1470-genappe-bousval/7849701'), { cp: '1470', ville: 'Genappe' });
verifier('parseCpEtVilleDepuisLien : lien sans CP', parseCpEtVilleDepuisLien('https://immo.trior.be/fr/qui-sommes-nous'), null);
verifier('parseCpEtVilleDepuisLien : lien absent', parseCpEtVilleDepuisLien(null), null);

console.log('\n== Fragments réels : Immoweb ==');

// Prix et chambres dupliqués (texte lisible + version compacte pour le
// tri/schema), unité "m²" séparée de sa valeur, PEB injecté depuis une image
// par scrapper_immo.mjs (jamais dans le texte de la carte elle-même).
const immoweb = construireAnnonce(
    {
        fragments: ['nouveau', '495 000 €', '495000€', 'Maison', '3 ch.', '3 chambres', '·', '265', 'm²', 'mètres carrés', '1410 Waterloo', 'Élégante maison familiale au cœur du Chenois', 'PEB E'],
        lien: 'https://www.immoweb.be/fr/annonce/maison/a-vendre/waterloo/1410/21816034',
        source: 'Immoweb',
        dateExtraction: '',
    },
    hintsDe('Immoweb'),
);
verifier('prix (le premier des deux doublons)', immoweb.prix, 495000);
verifier('chambres (malgré le doublon "3 ch."/"3 chambres")', immoweb.chambres, 3);
verifier('"·" isolé neutralisé, "265"+"m²" recollés', immoweb.surfaceHabitable, 265);
verifier('CP + ville en un seul fragment', [immoweb.cp, immoweb.ville], ['1410', 'Waterloo']);
verifier('titre éditorial conservé (pas "mètres carrés")', immoweb.titre, 'Élégante maison familiale au cœur du Chenois');
verifier('PEB depuis l\'image', immoweb.peb, 'E');
verifier('dans le périmètre', immoweb.dansPerimetre, true);

// Point médian COLLÉ à la valeur ("· 241"), deux surfaces sans libellé :
// vérifié sur la vraie fiche, la première est bien l'habitable.
const immowebClassified = construireAnnonce(
    {
        fragments: ['Maison', '350 000 €', '350000€', '3 ch.', '3 chambres', '· 241', 'm²', 'mètres carrés', '· 180', 'm²', 'mètres carrés', '1560 Hoeilaart', 'nouveau'],
        lien: 'https://www.immoweb.be/fr/annonce/maison/a-vendre/hoeilaart/1560/21814051',
        source: 'Immoweb',
        dateExtraction: '',
    },
    hintsDe('Immoweb'),
);
verifier('"· 241" → 241 m² habitable', immowebClassified.surfaceHabitable, 241);
verifier('"· 180" → 180 m² terrain', immowebClassified.surfaceTerrain, 180);
verifier('pas de titre éditorial → titre fabriqué', immowebClassified.titre, 'Maison 3 ch. à Hoeilaart');
verifier('Hoeilaart (1560) hors périmètre', immowebClassified.dansPerimetre, false);

console.log('\n== Immoweb : exclusion des catégories hors maison ==');

const exclusionImmoweb = SITES['www.immoweb.be'].lienExclusion;
const casExclusion = [
    ['appartement', 'https://www.immoweb.be/fr/annonce/appartement/a-vendre/la-hulpe/1310/21800000', true],
    ['immeuble à appartements', 'https://www.immoweb.be/fr/annonce/immeuble-a-appartements/a-vendre/la-hulpe/1310/21800001', true],
    ['immeuble mixte', 'https://www.immoweb.be/fr/annonce/immeuble-mixte/a-vendre/waterloo/1410/21800002', true],
    ['penthouse', 'https://www.immoweb.be/fr/annonce/penthouse/a-vendre/waterloo/1410/21800003', true],
    ['duplex', 'https://www.immoweb.be/fr/annonce/duplex/a-vendre/waterloo/1410/21800004', true],
    ['triplex', 'https://www.immoweb.be/fr/annonce/triplex/a-vendre/waterloo/1410/21800005', true],
    ['rez-de-chaussée', 'https://www.immoweb.be/fr/annonce/rez-de-chaussee/a-vendre/waterloo/1410/21800006', true],
    ['studio', 'https://www.immoweb.be/fr/annonce/studio/a-vendre/waterloo/1410/21800007', true],
    ['loft', 'https://www.immoweb.be/fr/annonce/loft/a-vendre/waterloo/1410/21800008', true],
    ['maison (conservée)', 'https://www.immoweb.be/fr/annonce/maison/a-vendre/waterloo/1410/21800009', false],
    ['villa (conservée)', 'https://www.immoweb.be/fr/annonce/villa/a-vendre/waterloo/1410/21800010', false],
    ['maison-bel-étage (conservée)', 'https://www.immoweb.be/fr/annonce/maison-bel-etage/a-vendre/waterloo/1410/21800011', false],
    ['bien exceptionnel (conservée)', 'https://www.immoweb.be/fr/annonce/bien-exceptionnel/a-vendre/waterloo/1410/21800012', false],
];
for (const [libelle, lien, doitExclure] of casExclusion) {
    verifier(`exclusion "${libelle}"`, exclusionImmoweb.test(lien), doitExclure);
}

// Rejouer l'exemple réel signalé : un appartement titré par le texte de la
// carte, dans une commune du périmètre (Woluwe-Saint-Lambert).
const appartementSignale = construireAnnonce(
    {
        fragments: ['Appartement', '349 000 €', '349000€', '3 ch.', '3 chambres', '100', 'm²', 'mètres carrés', '1200 Woluwe-Saint-Lambert'],
        lien: 'https://www.immoweb.be/fr/annonce/appartement/a-vendre/woluwe-saint-lambert/1200/21800099',
        source: 'Immoweb',
        dateExtraction: '',
    },
    hintsDe('Immoweb'),
);
verifier('classé Appartement par le texte', appartementSignale.typeBien, 'Appartement');
verifier('lien exclu par lienExclusion', exclusionImmoweb.test(appartementSignale.lien), true);

console.log('\n== Rente viagère ==');
const viager = construireAnnonce(
    {
        fragments: ['Rente viagère', '150 000 € + 3 125 €/mois', '150000€ + 3125€ par mois', 'Bien exceptionnel', '6 ch.', '6 chambres', '1470 Genappe'],
        lien: 'https://www.immoweb.be/fr/annonce/bien-exceptionnel/a-vendre/genappe/1470/21800020',
        source: 'Immoweb',
        dateExtraction: '',
    },
    hintsDe('Immoweb'),
);
verifier('rente viagère détectée', viager.venteViagere, true);
verifier('prix lu = le bouquet, pas la mensualité', viager.prix, 150000);
const nonViager = construireAnnonce(
    { fragments: ['Maison', '350 000 €', '350000€', '3 ch.', '1410 Waterloo'], lien: 'https://www.immoweb.be/fr/annonce/maison/a-vendre/waterloo/1410/21800021', source: 'Immoweb', dateExtraction: '' },
    hintsDe('Immoweb'),
);
verifier('vente classique non marquée', nonViager.venteViagere, false);

console.log('\n== Immeuble mixte : classification (fuite constatée hors Immoweb) ==');

// ERA place TOUT sous /maison/ dans ses URLs, y compris ses immeubles mixtes :
// le repli sur l'URL classait ce bien à tort comme "Maison". Le texte, lui,
// est explicite et est vérifié en premier.
const eraImmeubleMixte = construireAnnonce(
    {
        fragments: ['1', '2', '3', '4', 'IMMEUBLE MIXTE A FORT POTENTIEL DE 250 M2', '€ 349 000', "Place de la Gare 2, 1420 Braine-l'Alleud", '3 chbre(s)', '215 m² de surf. hab.', '91 m² de surface de terrain', 'B'],
        lien: "https://www.era.be/fr/a-vendre/braine-lalleud/maison/immeuble-mixte-a-fort-potentiel-de-250-m2",
        source: 'ERA',
        dateExtraction: '',
    },
    hintsDe('ERA'),
);
verifier('classé "Immeuble mixte", pas "Maison" via l\'URL', eraImmeubleMixte.typeBien, 'Immeuble mixte');

// Immovlan : aucun mot de type reconnu jusqu'ici → typeBien restait null.
const immovlanImmeubleMixte = construireAnnonce(
    { fragments: ['475 000 €', 'Immeuble mixte à vendre', '1702', 'Grand-Bigard', '3 Chambre(s)', '364 m²', '1 Salle(s) de bain'], lien: 'https://immovlan.be/fr/detail/immeuble-mixte/a-vendre/1702/grand-bigard/x', source: 'Immovlan', dateExtraction: '' },
    hintsDe('Immovlan'),
);
verifier('Immovlan : "Immeuble mixte" reconnu (plus null)', immovlanImmeubleMixte.typeBien, 'Immeuble mixte');

// Une vraie maison ne doit jamais basculer vers "Immeuble mixte" au seul
// prétexte qu'elle en mentionne un dans sa description.
const maisonAvecMentionImmeuble = construireAnnonce(
    { fragments: ['Maison', '1410 Waterloo', '350 000 €', '3 chambres', '150 m² habitable', 'à deux pas de l\'immeuble mixte du quartier'], lien: 'https://x.be/a', source: 'Test', dateExtraction: '' },
    {},
);
verifier('"Maison" prioritaire malgré une mention incidente', maisonAvecMentionImmeuble.typeBien, 'Maison');

// Style/pièce "loft" DANS une vraie maison : ne doit jamais être exclu.
verifier('"Plain pied typé LOFT !" reste une Maison (pas testé comme Appartement)', parseTypeBien(['Plain pied typé LOFT', 'Maison']), 'Maison');

console.log('\n== Filtre global hors-catégorie (parse_annonces.mjs) ==');
verifier('"Appartement" dans la liste d\'exclusion', TYPES_EXCLUS_TEST.has('Appartement'), true);
verifier('"Immeuble mixte" dans la liste d\'exclusion', TYPES_EXCLUS_TEST.has('Immeuble mixte'), true);
verifier('"Maison" jamais exclue', TYPES_EXCLUS_TEST.has('Maison'), false);

console.log('\n== Statuts et libellés ==');
verifier('"Vendu"', parseStatut(['Vendu']), 'vendu');
verifier('"VENDU AVANT JOURNÉE MAISONS OUVERTES"', parseStatut(['VENDU AVANT JOURNÉE MAISONS OUVERTES']), 'vendu');
verifier('"Option" seul', parseStatut(['Option']), 'option');
verifier('"Réservé"', parseStatut(['Réservé']), 'reserve');
verifier('"Nombreuses options" n\'est pas un statut', parseStatut(['Nombreuses options de rangement']), 'disponible');
verifier('"219j"', parseJoursEnLigne(['219j']), 219);
verifier('"3 chambres" n\'est pas une ancienneté', parseJoursEnLigne(['3 chambres']), null);
verifier('lettre nue ignorée sans le hint', parsePeb(['B'], {}), null);
verifier('"PEB : F" toujours lu', parsePeb(['PEB : F'], {}), 'F');

/* ------------------------------------------------------------ */
console.log(`\n${'─'.repeat(50)}`);
console.log(echecs === 0 ? `✅ ${total}/${total} tests passés` : `❌ ${echecs} échec(s) sur ${total} tests`);
process.exit(echecs === 0 ? 0 : 1);
