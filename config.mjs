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
    // ── Brabant wallon : axe Bruxelles–Namur (ligne 161) ──────────────
    Wavre: [1300, 1301], // Wavre, Limal, Bierges
    'La Hulpe': [1310],
    Rixensart: [1330, 1331, 1332], // Rixensart, Rosières, Genval
    'Ottignies-Louvain-la-Neuve': [1340, 1341, 1342, 1348],
    'Mont-Saint-Guibert': [1435],
    Chastre: [1450], // Blanmont, Cortil-Noirmont, Gentinnes, Saint-Géry (gare Chastre)
    Walhain: [1457], // Nil-Saint-Vincent, Tourinnes-Saint-Lambert
    Gembloux: [5030, 5031, 5032], // Beuzet, Ernage, Grand-Manil, Lonzée, Sauvenière, Grand-Leez, Bothey, Isnes, Corroy-le-Château

    // ── Autour de Gembloux ─────────────────────────────────────────────
    Sombreffe: [5140], // Ligny, Boignée, Tongrinne
    'La Bruyère': [5080], // Rhisnes, Emines, Villers-lez-Heest, Warisoulx
    Éghezée: [5310], // proche E411, à 10 min de Gembloux
    Perwez: [1360], // Malèves, Thorembais

    // ── Brabant wallon : est / nord-est ────────────────────────────────
    'Grez-Doiceau': [1390], // Archennes, Biez, Bossut-Gottechain, Nethen
    'Chaumont-Gistoux': [1325], // Bonlez, Corroy-le-Grand, Dion-Valmont, Longueville
    Beauvechain: [1320], // Hamme-Mille, L'Écluse, Nodebais, Tourinnes-la-Grosse
    Incourt: [1315],
    Jodoigne: [1370],
    Hélécine: [1357],
    'Orp-Jauche': [1350],
    Ramillies: [1367],

    // ── Brabant wallon : sud / sud-ouest ───────────────────────────────
    Lasne: [1380], // Ohain, Plancenoit, Couture-St-Germain, Maransart
    Waterloo: [1410],
    "Braine-l'Alleud": [1420, 1421, 1428], // + Ophain-BSI, Lillois-Witterzée
    Nivelles: [1400, 1401, 1402],
    Genappe: [1470, 1471, 1472, 1473, 1474],
    'Villers-la-Ville': [1495], // Marbais, Mellery, Sart-Dames-Avelines, Tilly
    'Court-Saint-Étienne': [1490],

    // ── Brabant wallon : ouest (ligne 96/123) ──────────────────────────
    Tubize: [1480], // Clabecq, Oisquercq, Saintes
    Rebecq: [1430], // Bierghes, Quenast
    Ittre: [1460], // Virginal-Samme, Haut-Ittre
    'Braine-le-Château': [1440], // Wauthier-Braine
    'Braine-le-Comte': [7090], // Hainaut, gare importante vers Bruxelles
    Soignies: [7060, 7063], // Hainaut, ligne 96 directe vers Bruxelles-Midi

    // ── Bruxelles limitrophe / ligne 161 ───────────────────────────────
    'Woluwe-Saint-Lambert': [1200],
    'Woluwe-Saint-Pierre': [1150],
    Auderghem: [1160],
    'Watermael-Boitsfort': [1170],
    Hoeilaart: [1560], // gare sur la ligne 161, Brabant flamand

    // ── Périmètre existant (Brabant flamand / Flandre) ─────────────────
    Dilbeek: [1700, 1701, 1702, 1703],
    Asse: [1730, 1731],
    Ternat: [1740, 1741, 1742],
    Liedekerke: [1770],
    Vilvoorde: [1800],
    Zaventem: [1930, 1932, 1933],
    Denderleeuw: [9470, 9472, 9473],
};

/** Index inversé CP (string) → nom de commune, construit une fois. */
export const CP_VERS_COMMUNE = Object.fromEntries(
    Object.entries(COMMUNES_CIBLES).flatMap(([commune, cps]) => cps.map((cp) => [String(cp), commune])),
);

export function estDansPerimetre(cp) {
    return cp != null && Object.hasOwn(CP_VERS_COMMUNE, String(cp));
}

/**
 * Région belge déduite du code postal.
 *
 * Les tranches sont fixes et exhaustives (arrêté royal sur les codes
 * postaux), donc aucun scraping n'est nécessaire — et aucune commune ne peut
 * passer entre les mailles, contrairement à une liste nominative.
 *
 * Attention au découpage : Bruxelles s'arrête à 1299 et le Brabant WALLON
 * commence à 1300 (Wavre). Le Brabant FLAMAND, lui, est coupé en deux
 * tranches non contiguës — 1500-1999 (Hal-Vilvorde) et 3000-3499 (Louvain) —
 * séparées par la province d'Anvers.
 *
 * La région n'est pas qu'une étiquette géographique : elle fixe les droits
 * d'enregistrement, très différents d'une région à l'autre.
 */
const TRANCHES_REGION = [
    [1000, 1299, 'Bruxelles'], // les 19 communes
    [1300, 1499, 'Wallonie'], // Brabant wallon
    [1500, 1999, 'Flandre'], // Brabant flamand (Hal-Vilvorde)
    [2000, 2999, 'Flandre'], // Anvers
    [3000, 3999, 'Flandre'], // Brabant flamand (Louvain) + Limbourg
    [4000, 7999, 'Wallonie'], // Liège, Namur, Luxembourg, Hainaut
    [8000, 9999, 'Flandre'], // Flandre occidentale et orientale
];

export function regionDuCp(cp) {
    const n = Number(cp);
    if (!Number.isInteger(n)) return null;
    return TRANCHES_REGION.find(([min, max]) => n >= min && n <= max)?.[2] ?? null;
}

/** Les trois régions, dans l'ordre d'affichage du dashboard. */
export const REGIONS = ['Bruxelles', 'Wallonie', 'Flandre'];

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
   RÉFÉRENCE DE MARCHÉ
   ============================================================ */

export const MARCHE = {
    /**
     * Nombre minimum de biens dans une commune pour publier sa médiane €/m².
     *
     * 8 couvre 39 communes sur 44 et 98 % des biens ayant un prix au m².
     * En dessous, la médiane est dominée par le bruit — une commune à trois
     * biens donnerait un chiffre faussement précis, pire qu'une case vide.
     */
    minEchantillon: 8,
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
     - cpDansLien : le code postal n'apparaît nulle part dans le texte de la
       carte (juste "Waterloo", jamais "1410 Waterloo") — seulement dans
       l'URL de l'annonce (".../1410-waterloo/..."). lib/parse.mjs bascule
       sur ce repli quand le texte n'en fournit pas.
     - terrainAresApresSurface : un entier nu qui suit directement la surface
       ("340 m²" puis "8") est la surface du terrain, exprimée en ares
       (1 are = 100 m²) — convention belge courante, jamais vue ailleurs
       dans nos 5 autres portails.
   ============================================================ */

export const SITES = {
    'www.realo.be': {
        source: 'Realo',
        // Le conteneur de la carte ; les liens d'annonce n'ont pas de motif
        // distinctif dans leur chemin (/fr/{rue}-{cp}-{commune}/{id}), donc
        // c'est le sélecteur de carte qui fait le travail de cadrage.
        cardSelector: 'div.component-estate-grid-item',
        lienPattern: '/fr/',
        /*
         * Realo publie une page de valeur estimée pour CHAQUE adresse de
         * Belgique, sous /fr/explorer/{id}. Ces cartes se mélangent aux
         * annonces dans les résultats : fourchette de prix (« 300 000 € -
         * 400 000 € »), ni surface ni chambres. Mesuré : 471 sur 942, qui
         * auraient pollué les médianes de marché avec des prix inventés.
         * Les vraies annonces vivent sous /fr/{adresse}/{id}.
         */
        lienExclusion: /\/fr\/explorer\//i,
        paginationParam: 'page',
        paginationStart: 1,
        // Mesuré : 61 maisons à Braine-l'Alleud, 31 à Ternat, ~25 par page.
        // 5 pages = 125 biens par commune, jamais atteint en pratique, et
        // cela borne la charge que ce portail lent impose à la file.
        maxPages: 5,
        hints: {},
    },
    'www.immoweb.be': {
        source: 'Immoweb',
        // Deux gabarits de carte coexistent (biens "premium" et biens
        // standards, classes CSS différentes : "xl-card--result" vs
        // "card--list-classified"), mais les deux partagent l'ancêtre
        // <article class="card ...">, qui porte aussi l'image.
        cardSelector: 'article.card',
        cookieButtonRegex: /accepter/i,
        lienPattern: '/fr/annonce/',
        // Élément d'adresse sur la page de DÉTAIL (voir enrichir_adresses.mjs).
        // Présent sur 12 fiches sondées sur 12 ; il contient parfois
        // « Demander l'adresse exacte » quand le vendeur ne la publie pas,
        // cas traité par lib/adresse_detail.mjs.
        selecteurAdresse: '.classified__information--address',
        // La recherche "/recherche/maison/a-vendre" n'est PAS stricte : une
        // fois les résultats exacts épuisés, Immoweb complète avec d'autres
        // catégories (appartements, immeubles mixtes...). Constaté sur un
        // scrape réel : 331 des 1192 cartes récoltées (28 %) n'étaient pas
        // des maisons. On exclut ces catégories dès la récolte, par le
        // segment de type dans l'URL de l'annonce — plus fiable que de
        // deviner depuis un texte de carte qui ne les nomme pas toujours
        // clairement (aucune des règles de lib/parse.mjs::TYPES_BIEN ne
        // reconnaît "duplex", "penthouse", "studio", etc.).
        lienExclusion: /\/fr\/annonce\/(appartement|immeuble-a-appartements|immeuble-mixte|penthouse|duplex|triplex|rez-de-chaussee|studio|loft|appartement-de-service)\//i,
        paginationParam: 'page',
        paginationStart: 1,
        // Inventaire de loin le plus grand des 7 portails : 60 résultats par
        // page. ⚠️ À RELIRE quand le périmètre s'élargit — avec 26 communes
        // Immoweb annonçait ~970 biens (17 pages), avec 44 il en annonce
        // 1400 et propose jusqu'à la page 47. Le plafond de 20 pages tronquait
        // donc la recherche à 1200, et les biens tombés hors fenêtre
        // ressortaient ensuite en fausses « disparitions » dans l'historique.
        // La pagination s'arrête d'elle-même dès qu'une page ne renvoie rien,
        // donc un plafond généreux ne coûte rien quand l'offre est plus petite.
        maxPages: 30,
        // Tout le reste (prix, surfaces, chambres, "1410 Waterloo") suit les
        // conventions déjà gérées nativement, sans hint dédié.
        hints: {},
    },
    'immo.trior.be': {
        source: 'Trior',
        cardSelector: 'div.estate-list__item',
        cookieButtonRegex: /accepter/i,
        // Restreint aussi aux maisons si jamais le filtre de formulaire
        // (voir scrapper_immo.mjs) échouait silencieusement : une carte
        // appartement n'a que son propre lien /appartement/, donc elle est
        // ignorée par recolterCartes() faute de correspondance.
        lienPattern: '/fr/bien/a-vendre/maison/',
        // Pas de query string : le site filtre via un <form method="post">.
        // scrapper_immo.mjs pilote ce formulaire (catégorie + codes postaux)
        // avant l'extraction, au lieu d'empiler des pages par URL.
        paginationParam: null,
        // Structure : "5" | "3" | "340 m²" | "8" | "Court-Saint-Etienne" |
        //             "Bien exceptionnel à vendre" | "1 850 000 €"
        hints: {
            bareStats: { position: 'avant-surface', champs: ['chambres', 'sallesDeBain'] },
            cpDansLien: true,
            terrainAresApresSurface: true,
        },
    },
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
        // ERA pagine par DÉCALAGE de résultats, pas par numéro de page :
        // pager[offset]=36, 72, 108… Le commentaire précédent affirmait un
        // « scroll infini depuis une seule URL » ; c'est faux, le défilement
        // s'arrête à 36 cartes alors que la page en annonce 97. Les liens
        // « 2 », « 3 », « Suivant » du pied de liste donnent la convention.
        paginationParam: 'pager[offset]',
        paginationPas: 36,
        maxPages: 10,
        cookieButtonRegex: /accepter/i,
        lienPattern: '/a-vendre/',
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

/**
 * Paramètres confirmés par sondage :
 *   postalCodes=BE-1300,BE-1310,...  liste préfixée "BE-", virgules brutes.
 *   priceType=SALE_PRICE, minPrice/maxPrice, minBedroomCount   confirmés.
 *   page=N   60 résultats par page.
 * ⚠️ Le filtre n'est pas strict côté serveur : Immoweb complète avec des
 * biens proches hors périmètre ou légèrement hors budget une fois les
 * résultats exacts épuisés (~16 % de l'échantillon sondé). Sans conséquence :
 * le filtre de périmètre/budget de parse_annonces.mjs les écarte comme pour
 * n'importe quel autre portail.
 */
function urlImmoweb() {
    const p = new URLSearchParams({
        countries: 'BE',
        postalCodes: TOUS_LES_CP.map((cp) => `BE-${cp}`).join(','),
        priceType: 'SALE_PRICE',
        minPrice: String(CRITERES.prixMin),
        maxPrice: String(CRITERES.prixMax),
        minBedroomCount: String(CRITERES.chambresMin),
    });
    return `https://www.immoweb.be/fr/recherche/maison/a-vendre?${p.toString().replace(/%2C/g, ',')}`;
}

/**
 * Century21 filtre par code postal, un paramètre `location` par CP.
 * Mesuré : passer de 15 à 72 codes postaux fait passer la première page de
 * 22 à 80 cartes.
 */
function urlCentury21() {
    const p = new URLSearchParams({
        listingType: 'FOR_SALE',
        type: 'HOUSE',
        countryCode: 'be',
        bedroomsMin: String(CRITERES.chambresMin),
        priceMin: String(CRITERES.prixMin),
        priceMax: String(CRITERES.prixMax),
    });
    return `https://www.century21.be/fr/a-vendre/maison?${TOUS_LES_CP.map((cp) => `location=${cp}`).join('&')}&${p}`;
}

/**
 * Realo : une recherche par commune, car il n'accepte qu'une localité à la fois.
 *
 * On lui passe un simple code postal (`q=1740`) plutôt qu'un slug construit :
 * il le résout lui-même vers sa page canonique et ramène au passage les codes
 * voisins de la commune (1740 → 1740, 1741, 1742). Un slug deviné échouerait
 * sur les noms composés, et on n'a pas sa table de correspondance.
 *
 * Un seul code postal par commune suffit donc, d'où 45 URLs et non 72.
 */
function urlsRealo() {
    const p = new URLSearchParams({
        priceMin: String(CRITERES.prixMin),
        priceMax: String(CRITERES.prixMax),
        bedroomsMin: String(CRITERES.chambresMin),
    });
    return Object.values(COMMUNES_CIBLES).map(
        (cps) => `https://www.realo.be/fr/search?q=${cps[0]}&ways%5B%5D=SALE&types%5B%5D=HOUSE&${p}`,
    );
}

/**
 * Trevi : aucun filtre de localité possible.
 *
 * Son paramètre `zips[]=CP_LIBELLÉ` est mort — vérifié sur le site : 0, 1, 5,
 * 20 ou 60 localités renvoient exactement les mêmes 14 cartes, et au-delà de
 * ~190 l'URL devient trop longue et ne renvoie plus rien. L'ancienne URL du
 * projet, qui portait 15 localités, ne ramenait donc déjà plus que le
 * catalogue national non filtré.
 *
 * On assume : on parcourt tout son catalogue (quelques centaines de maisons,
 * 14 par page) et `parse_annonces.mjs` écarte ce qui est hors périmètre.
 * C'est plus robuste qu'un filtre serveur qu'on ne contrôle pas.
 */
function urlTrevi() {
    return 'https://www.trevi.be/fr/acheter-bien-immobilier/maisons?purpose=0&officeid=0&estatecategory=1';
}

export const URLS = [
    urlImmoweb(),
    urlImmovlan(),

    // Trior : simple page de départ, le filtrage (catégorie + codes postaux)
    // se fait en pilotant son formulaire — voir scrapper_immo.mjs.
    'https://immo.trior.be/fr/2/chercher-bien/a-vendre',

    'https://www.era.be/fr/a-vendre?filter%5Bproperty_type%5D=46&filter%5Bprice%5D=%28min%3A300000%3Bmax%3A500000%29&filter%5Bamount_bedrooms%5D=%28min%3A2%3Bmax%3A%29&filter%5Blocation%5D%5Bmunicipalities%5D=686+234+340+543+444+591+555+687+708+668+183+642+469+279+287&filter%5Blocation%5D%5Bsub_municipalities%5D=1733+2078+821+974+1318+1531+1768+2602+2723+844+957+1909+2508+1300+2264+1026+1735+1769+2108+896+1734+2018+2420+2469+2153+862+1623+1903+2215+2810+2394+2689+1552+2732+1373+1560+2343+2409+2421',

    // ⚠️ Zimmo : ce lien n'a PAS de filtre de localité (le search= est encodé en
    // base64 et n'a jamais été refait avec les communes). Résultat mesuré :
    // des biens à Berlaar (2590) ou Gemmenich (4851). Le filtre CP de
    // lib/parse.mjs les écarte désormais, mais on scrape pour rien : à
    // remplacer par un lien filtré dès que possible.
    'https://www.zimmo.be/fr/rechercher/?search=eyJmaWx0ZXIiOnsic3RhdHVzIjp7ImluIjpbIkZPUl9TQUxFIiwiVEFLRV9PVkVSIl19LCJjYXRlZ29yeSI6eyJpbiI6WyJIT1VTRSJdfSwicHJpY2UiOnsidW5rbm93biI6dHJ1ZSwicmFuZ2UiOnsibWluIjozMDAwMDAsIm1heCI6NTAwMDAwfX0sImJlZHJvb21zIjp7InVua25vd24iOnRydWUsInJhbmdlIjp7Im1pbiI6Mn19fX0%3D#gallery',

    // Corrigé : priceMax était à 5000000 (5 M€) au lieu de 500000 → des biens
    // à 899.000 € remontaient en tête de classement.
    urlCentury21(),

    urlTrevi(),

    ...urlsRealo(),
];

/* ============================================================
   5. FICHIERS
   ============================================================ */

export const FICHIERS = {
    brutes: 'annonces-brutes.json', // récolte navigateur, jamais parsée
    annonces: 'annonces.json', // sortie propre, consommée par le dashboard
    historique: 'historique.json', // mémoire d'un run à l'autre (nouveau/baisse/disparu)
    disparus: 'disparus.json', // biens absents du dernier scrape, pour affichage
    cacheGeocode: 'geocode-cache.json',
    // Adresses relevées sur les pages de détail. Comme historique.json, ce
    // fichier n'est PAS régénérable à volonté : le supprimer impose de
    // revisiter des centaines de fiches (~1/seconde).
    cacheAdresses: 'adresses-cache.json',
    // Récolte par portail, run après run : sert à repérer qu'un scraper s'est
    // cassé (voir lib/sante.mjs). Régénérable, mais il faut quelques runs
    // avant que la surveillance redevienne utile.
    sante: 'sante-portails.json',
    dashboard: 'dashboard.html',
};

/**
 * Seuils de lib/historique.mjs.
 *   joursAvantDisparu : un bien absent depuis MOINS longtemps n'est pas
 *     signalé « disparu » — ça absorbe un scrape partiellement raté sur un
 *     portail (vécu avec ERA : 91 → 33 cartes d'un run à l'autre sans lien
 *     avec une vraie baisse d'offre) sans le confondre avec une vente.
 *   joursPurge : au-delà, on arrête de garder trace d'un bien disparu —
 *     sinon historique.json grossit indéfiniment sur des biens vendus
 *     depuis longtemps.
 */
export const HISTORIQUE = {
    joursAvantDisparu: 2,
    joursPurge: 45,
};

/**
 * Seuils du contrôle de santé des portails (lib/sante.mjs).
 *   seuilChute : baisse de récolte à partir de laquelle on alerte. 0,4 laisse
 *     passer la variation normale de l'offre (±20-30 % d'un run à l'autre)
 *     tout en attrapant les vraies pannes — ERA était tombé de 78 %, Trior
 *     de 100 %.
 *   minRuns : nombre de runs de référence avant de juger quoi que ce soit.
 *   maxRuns : taille de l'historique conservé.
 */
export const SANTE = {
    seuilChute: 0.4,
    minRuns: 2,
    maxRuns: 20,
};
