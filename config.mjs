/**
 * Source unique de vérité : communes ciblées, budget, et configuration des portails.
 * C'est le seul fichier à éditer pour changer le périmètre de la recherche.
 */

/* ============================================================
   1. PÉRIMÈTRE GÉOGRAPHIQUE
   ============================================================
   Attention : une commune belge couvre souvent PLUSIEURS codes postaux
   (ses anciennes communes fusionnées). Filtrer sur une liste plate de 15 CP
   excluait à tort des localités pourtant très bien desservies — Louvain-la-Neuve
   (1348), Genval (1332), Schepdaal (1703)... D'où cette table CP → commune.
   ============================================================ */
/*
export const COMMUNES_CIBLES = {
    Wavre: [1300, 1301], // Wavre, Limal, Basse-Wavre, Bierges
    'La Hulpe': [1310],
    Rixensart: [1330, 1331, 1332], // Rixensart, Rosières, Genval
    'Ottignies-Louvain-la-Neuve': [1340, 1341, 1342, 1348], // dont LLN (1348)
    Nivelles: [1400, 1401, 1402], // Nivelles, Baulers, Thines
    Waterloo: [1410],
    "Braine-l'Alleud": [1420, 1421, 1428], // + Ophain-BSI, Lillois-Witterzée
    Genappe: [1470, 1471, 1472, 1473, 1474], // Bousval, Loupoigne, Vieux-Genappe, Glabais, Ways
    Dilbeek: [1700, 1701, 1702, 1703], // + Itterbeek, Groot-Bijgaarden, Schepdaal
    Asse: [1730, 1731], // + Zellik, Relegem
    Ternat: [1740, 1741, 1742], // + Wambeek, Sint-Katherina-Lombeek
    Liedekerke: [1770],
    Vilvoorde: [1800], // + Peutie
    Zaventem: [1930, 1932, 1933], // + Sint-Stevens-Woluwe, Sterrebeek
    Denderleeuw: [9470, 9472, 9473], // + Iddergem, Welle
};
*/
export const COMMUNES_CIBLES = {
    Wavre: [1300, 1301], // Wavre, Limal, Basse-Wavre, Bierges
    'La Hulpe': [1310],
    Rixensart: [1330, 1331, 1332], // Rixensart, Rosières, Genval
    'Ottignies-Louvain-la-Neuve': [1340, 1341, 1342, 1348], // dont LLN (1348)
    'Mont-Saint-Guibert': [1435], // gare sur ligne Bruxelles-Namur, à 2 arrêts de LLN
    'Court-Saint-Étienne': [1490], // gare sur ligne Bruxelles-Namur (Ottignies-Charleroi)
    'Grez-Doiceau': [1390], // gare, proche de Wavre, ligne vers Bruxelles via Ottignies
    'Chaumont-Gistoux': [1325], // proche Wavre/LLN, accès rapide E411
    Lasne: [1380], // proche Waterloo, accès rapide E411 vers Bruxelles
    Nivelles: [1400, 1401, 1402], // Nivelles, Baulers, Thines
    Waterloo: [1410],
    "Braine-l'Alleud": [1420, 1421, 1428], // + Ophain-BSI, Lillois-Witterzée
    Genappe: [1470, 1471, 1472, 1473, 1474], // Bousval, Loupoigne, Vieux-Genappe, Glabais, Ways
    Tubize: [1480], // gare directe vers Bruxelles-Midi (ligne 96/50A)
    Dilbeek: [1700, 1701, 1702, 1703], // + Itterbeek, Groot-Bijgaarden, Schepdaal
    Asse: [1730, 1731], // + Zellik, Relegem
    Ternat: [1740, 1741, 1742], // + Wambeek, Sint-Katherina-Lombeek
    Liedekerke: [1770],
    Vilvoorde: [1800], // + Peutie
    Zaventem: [1930, 1932, 1933], // + Sint-Stevens-Woluwe, Sterrebeek
    Denderleeuw: [9470, 9472, 9473], // + Iddergem, Welle
};

/** Index inversé CP (string) → nom de commune, construit une fois. */
export const CP_VERS_COMMUNE = Object.fromEntries(
    Object.entries(COMMUNES_CIBLES).flatMap(([commune, cps]) => cps.map((cp) => [String(cp), commune])),
);

export function estDansPerimetre(cp) {
    return cp != null && Object.hasOwn(CP_VERS_COMMUNE, String(cp));
}

/* ============================================================
   2. CRITÈRES DE RECHERCHE
   ============================================================ */

export const CRITERES = {
    prixMin: 300000,
    prixMax: 500000,
    chambresMin: 2,
    // Marge de tolérance : on garde une annonce légèrement au-dessus du budget
    // (elle peut être négociable) mais on la signale dans le dashboard.
    prixMaxTolerance: 1.1,
    // Plancher, pour écarter les prix « à partir de » des projets neufs
    // (un lot à 158 000 € n'a rien à faire dans une recherche à 300-500 k€).
    prixMinTolerance: 0.9,
};

/* ============================================================
   3. PORTAILS
   ============================================================
   `cardSelector` doit viser le CONTENEUR de la carte, pas un lien interne.
   Piège rencontré sur Century21 : chaque photo du carrousel est un <a> vers
   l'annonce (~30 par bien), donc `a[href*="/fr/properiete/"]` remontait 520
   diapositives sans texte au lieu de 24 cartes.

   `hints` guide le parsing en Node (voir lib/parse.mjs) :
     - lienPattern : filtre les liens internes d'une carte pour garder l'annonce
     - bareStats : certains portails affichent des nombres SANS libellé, à côté
       d'une icône seule. Ils sont repérés par leur position relative au
       fragment de surface (« 210 m² »), et non par leur rang absolu : le
       compteur de photos du carrousel arrive en fragments séparés
       ("1", "/", "30"), donc compter « les 2 premiers entiers » donnait
       1 chambre et 30 salles de bain sur toutes les annonces Century21.
     - pebNu : le certificat énergétique apparaît en lettre seule ("B"),
       sans le libellé "PEB"
   ============================================================ */

export const SITES = {
    'immovlan.be': {
        source: 'Immovlan',
        // La carte est l'<article> : il porte l'image, alors que
        // .v3-search-card-content (son enfant) ne contient que le texte.
        cardSelector: 'article.v3-search-card',
        cookieButtonRegex: /accepter/i,
        // Écarte les cartes /fr/projectdetail/ : ce sont des projets neufs
        // affichant une FOURCHETTE ("361 677 € - 481 136 €") et des
        // caractéristiques en plages ("3 - 4 chambres"), pas un bien précis.
        lienPattern: '/fr/detail/',
        paginationParam: 'page',
        paginationStart: 1,
        maxPages: 20, // 20 résultats par page ; ~115 biens sur le périmètre
        // Valeur et unité sont dans deux éléments distincts ("154" puis "m²",
        // "3" puis "Chambre(s)") : lib/parse.mjs les recolle avant de parser.
        hints: {},
    },
    'www.era.be': {
        source: 'ERA',
        cardSelector: 'article:has(h2), article:has(h3)',
        cookieButtonRegex: /accepter/i,
        lienPattern: '/a-vendre/',
        // La page ERA charge tout en scroll infini depuis une seule URL :
        // enchaîner ?page= en plus créait un recouvrement massif de doublons.
        paginationParam: null,
        // Tout est libellé ("3 chbre(s)", "193 m² de surf. hab."), sauf le PEB
        // qui apparaît en lettre seule en fin de carte (89 cartes sur 91).
        hints: { pebNu: true },
    },
    'www.zimmo.be': {
        source: 'Zimmo',
        cardSelector: '[class*="PropertyItem"], [class*="property-item"], article',
        cookieButtonRegex: /accepter|akkoord/i,
        lienPattern: '/a-vendre/',
        paginationParam: null,
        // Structure : "€ 369.000" | "Sous option" | "Maison à vendre" |
        //             "Rue 23" | "2070 Burcht" | "17j" | "132m²" | "3"
        // Le nombre de chambres suit la surface ; "17j" = jours en ligne.
        hints: { bareStats: { position: 'apres-surface', champs: ['chambres'] } },
    },
    'www.century21.be': {
        source: 'Century21',
        // Classes hachées à chaque build du site → on cible le préfixe stable.
        cardSelector: '[class*="style-module--card--"]',
        cookieButtonRegex: /accepter|accept/i,
        lienPattern: '/properiete/',
        paginationParam: null,
        // Structure : "1" | "/" | "30" | "Maison" | "1800" | "Vilvoorde" |
        //             "€ 385.000" | "3" | "2" | "163 m²"
        // Les deux nombres nus juste AVANT la surface sont les chambres puis
        // les salles de bain (les trois premiers sont le compteur de photos).
        hints: { bareStats: { position: 'avant-surface', champs: ['chambres', 'sallesDeBain'] } },
    },
    'www.trevi.be': {
        source: 'Trevi',
        // Chaque annonce est un unique <a> qui contient tout le texte.
        cardSelector: 'a[href*="/fr/bien/"]',
        cookieButtonRegex: /accepter|accept/i,
        lienPattern: '/fr/bien/',
        paginationParam: 'pagenumber',
        paginationStart: 1,
        maxPages: 25,
        // Structure : "460.000 €" | "À vendre" | "Maison" | "1330 Rixensart" |
        //             "3 chambres" | "148 m²" — tout est libellé.
        hints: {},
    },
};

export const CONFIG_PAR_DEFAUT = {
    source: null,
    cardSelector: 'article:has(h2), article:has(h3)',
    cookieButtonRegex: /accepter|accept/i,
    lienPattern: null,
    paginationParam: null,
    hints: {},
};

export function getSiteConfig(url) {
    const hostname = new URL(url).hostname;
    return SITES[hostname] ?? { ...CONFIG_PAR_DEFAUT, source: hostname };
}

/* ============================================================
   4. URLS DE RECHERCHE
   ============================================================
   ⚠️ Les URLs ci-dessous portent chacune leur PROPRE filtre de localité, côté
   serveur du portail. Ajouter une commune à COMMUNES_CIBLES élargit seulement
   le filtre d'acceptation en aval : ça ne fait pas remonter la commune par le
   portail. Ces liens doivent donc être régénérés depuis les sites.

   Seul Immovlan y échappe : son URL est construite ici à partir de
   COMMUNES_CIBLES, donc elle reste automatiquement synchronisée.
   ============================================================ */

/** Tous les codes postaux du périmètre, triés (45 actuellement). */
export const TOUS_LES_CP = Object.values(COMMUNES_CIBLES)
    .flat()
    .sort((a, b) => a - b);

/**
 * Paramètres confirmés par sondage (voir explorer_site.mjs) :
 *   towns=1300,1310,...   liste séparée par des virgules. Attention : répéter
 *                         `towns=` ne fonctionne PAS (seule la 1re valeur est
 *                         lue), et une valeur unique est interprétée autrement
 *                         (towns=1300 → 1 résultat, towns=wavre → 15).
 *   minprice / maxprice   confirmés (115 résultats contre 87 sans filtre... )
 *   minbedrooms           confirmé
 *   page=N                20 résultats par page
 * `transactiontypes` inclut les ventes publiques, et la recherche exclut déjà
 * par défaut les biens vendus et sous option.
 */
function urlImmovlan() {
    const p = new URLSearchParams({
        transactiontypes: 'a-vendre,en-vente-publique',
        towns: TOUS_LES_CP.join(','),
        minprice: String(CRITERES.prixMin),
        maxprice: String(CRITERES.prixMax),
        minbedrooms: String(CRITERES.chambresMin),
    });
    // URLSearchParams encode les virgules ; Immovlan attend des virgules brutes.
    return `https://immovlan.be/fr/immobilier/maison?${p.toString().replace(/%2C/g, ',')}`;
}

export const URLS = [
    urlImmovlan(),

    'https://www.era.be/fr/a-vendre?filter%5Bproperty_type%5D=46&filter%5Bprice%5D=%28min%3A300000%3Bmax%3A500000%29&filter%5Bamount_bedrooms%5D=%28min%3A2%3Bmax%3A%29&filter%5Blocation%5D%5Bmunicipalities%5D=686+234+340+543+444+591+555+687+708+668+183+642+469+279+287&filter%5Blocation%5D%5Bsub_municipalities%5D=1733+2078+821+974+1318+1531+1768+2602+2723+844+957+1909+2508+1300+2264+1026+1735+1769+2108+896+1734+2018+2420+2469+2153+862+1623+1903+2215+2810+2394+2689+1552+2732+1373+1560+2343+2409+2421',

    // ⚠️ Zimmo : ce lien n'a PAS de filtre de localité (le search= est encodé en
    // base64 et n'a jamais été refait avec les communes). Résultat mesuré :
    // des biens à Berlaar (2590) ou Gemmenich (4851). Le filtre CP de
    // lib/parse.mjs les écarte désormais, mais on scrape pour rien : à
    // remplacer par un lien filtré dès que possible.
    'https://www.zimmo.be/fr/rechercher/?search=eyJmaWx0ZXIiOnsic3RhdHVzIjp7ImluIjpbIkZPUl9TQUxFIiwiVEFLRV9PVkVSIl19LCJjYXRlZ29yeSI6eyJpbiI6WyJIT1VTRSJdfSwicHJpY2UiOnsidW5rbm93biI6dHJ1ZSwicmFuZ2UiOnsibWluIjozMDAwMDAsIm1heCI6NTAwMDAwfX0sImJlZHJvb21zIjp7InVua25vd24iOnRydWUsInJhbmdlIjp7Im1pbiI6Mn19fX0%3D#gallery',

    // Corrigé : priceMax était à 5000000 (5 M€) au lieu de 500000 → des biens
    // à 899.000 € remontaient en tête de classement.
    'https://www.century21.be/fr/a-vendre/maison?listingType=FOR_SALE&type=HOUSE&condition=GOOD&condition=MINT&condition=NEW&condition=TO_RENOVATE&condition=TO_REFRESH&condition=READY_TO_USE&countryCode=be&garden=true&location=1310&location=1410&location=1420&location=1470&location=1400&location=1330&location=1340&location=1300&location=1800&location=1930&location=1730&location=1740&location=1770&location=9470&location=1700&parking=true&bedroomsMin=2&priceMin=300000&priceMax=500000',

    'https://www.trevi.be/fr/acheter-bien-immobilier/maisons?purpose=0&pagenumber=&officeid=0&agencyid=&siteid=&estatecategory=1&zips%5B%5D=1300_WAVRE&zips%5B%5D=1310_LA+HULPE&zips%5B%5D=1330_RIXENSART&zips%5B%5D=1340_Ottignies-Louvain-la-Neuve&zips%5B%5D=1400_NIVELLES&zips%5B%5D=1410_WATERLOO&zips%5B%5D=1420_Braine-l%27Alleud&zips%5B%5D=1470_GENAPPE&zips%5B%5D=1700_DILBEEK&zips%5B%5D=1730_ASSE+&zips%5B%5D=1740_TERNAT&zips%5B%5D=1770_LIEDEKERKE&zips%5B%5D=1800_VILVOORDE&zips%5B%5D=1930_ZAVENTEM&zips%5B%5D=9470_DENDERLEEUW',
];

/* ============================================================
   5. FICHIERS
   ============================================================ */

export const FICHIERS = {
    brutes: 'annonces-brutes.json', // récolte navigateur, jamais parsée
    annonces: 'annonces.json', // sortie propre, consommée par le dashboard
    cacheGeocode: 'geocode-cache.json',
    dashboard: 'dashboard.html',
};
