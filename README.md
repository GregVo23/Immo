# Recherche immobilière — Brabant wallon & périphérie flamande

Agrège les annonces de 5 portails (Immovlan, ERA, Century21, Trevi, Zimmo), les
nettoie, les déduplique et génère un dashboard HTML autonome.

## Utilisation

```bash
npm start         # scrape les 5 portails + parse → annonces.json
npm run reparse   # re-parse SANS re-scraper      → annonces.json
npm run dashboard # génère dashboard.html
npm test          # tests du parsing (123 cas)
npm run all       # scrape + dashboard
```

Pour sonder un portail à ajouter :

```bash
node explorer_site.mjs "<url de recherche>"
```

Il rapporte les motifs d'URL, les conteneurs candidats et les fragments de
texte des premières cartes — de quoi remplir une entrée de `SITES`.

## Autonomie du dossier

Tout est contenu dans `scraper-playwright/` : dépendances dans son propre
`node_modules`, aucun lien `file:` local, aucun import hors du dossier.

Les scripts d'entrée importent `lib/racine.mjs` **en premier**, ce qui ancre le
dossier de travail sur la racine du projet. Sans ça, `node
scraper-playwright\scrapper_immo.mjs` lancé depuis `c:\IMMO` écrivait
`storage/`, `debug/` et `geocode-cache.json` à côté du projet — d'où un cache
de géocodage et un dataset dupliqués. Les scripts fonctionnent donc depuis
n'importe quel dossier.

Seule dépendance externe : les binaires de navigateur Playwright, installés au
niveau de la machine dans `%LOCALAPPDATA%\ms-playwright` (~1,6 Go). C'est
normal et partagé entre projets ; sur une machine neuve, `npx playwright
install chromium` les récupère.

## Architecture

Le point clé : **la récolte et le parsing sont séparés**.

```
scrapper_immo.mjs   → annonces-brutes.json   (texte brut, aucun parsing)
parse_annonces.mjs  → annonces.json          (structuré, filtré, dédupliqué)
generate_dashboard.mjs → dashboard.html      (géocodage + mesures)
```

Le navigateur ne fait que ramasser les fragments de texte de chaque carte.
Tout le parsing se fait en Node, dans `lib/parse.mjs`, en fonctions pures.

Conséquence pratique : corriger une regex ne demande pas de re-scraper les
4 sites. On relance `npm run reparse` sur les données brutes déjà récoltées,
et `npm test` valide la correction en une seconde.

| Fichier | Rôle |
|---|---|
| `config.mjs` | **Seul fichier à éditer** pour le périmètre : communes, budget, URLs, sélecteurs |
| `lib/parse.mjs` | Parsing (prix, surfaces, chambres, PEB) + déduplication. Fonctions pures |
| `scrapper_immo.mjs` | Pilotage Playwright, scroll adaptatif, pagination |
| `parse_annonces.mjs` | Brut → propre, filtres de pertinence, rapport de qualité |
| `generate_dashboard.mjs` | Géocodage Nominatim (avec cache) + mesures + HTML |
| `test_parse.mjs` | Tests sur des cas réels observés dans les données |

## Le score est réglable, et honnête

Le score n'est pas calculé côté Node : il est calculé **dans le navigateur**, à
partir de pondérations que tu règles avec des sliders (7 critères : accès gare,
prix/m², chambres, surface, proximité Bruxelles, accès autoroute, terrain).
Réglages mémorisés dans le navigateur, plus 4 profils pré-réglés.

Surtout : **un critère dont la donnée manque est exclu du calcul**, et la carte
indique alors sur quelle part des critères pondérés le score repose. Deux biens
n'ont pas forcément un score comparable, et le dashboard le dit.

C'est la correction d'un biais de la version précédente : les commodités étaient
déduites du titre de l'annonce, or seul ERA rédige des titres descriptifs
(« …avec garage et jardin »). ERA gagnait jusqu'à 20 points que Century21 et
Trevi, sans titre éditorial, ne pouvaient structurellement pas obtenir.

## La carte

Trois vues : **Fiches**, **Carte**, **Tableau** (le choix est mémorisé).

La carte superpose au fond OpenStreetMap — qui rend déjà les autoroutes en
orange avec leurs écussons E19/E40/E411 — les **29 gares** et les **12 accès
autoroute** qui servent au calcul du score. Chaque famille a sa forme, sa
couleur et son libellé : rond bleu pour les biens, carré orange pour les gares,
triangle vert pour les accès. La couleur du bien suit son score (rampe bleue,
plus foncé = meilleur).

Les 41 libellés se chevauchaient et couvraient toute la région bruxelloise vus
de loin : ils n'apparaissent donc qu'à partir du zoom 11, et le nom reste
accessible au survol en dessous. Une couche optionnelle affiche un rayon de
2 km autour de chaque gare.

**Positions approximatives** : 134 biens sur 192 n'ont pas d'adresse publiée et
sont géocodés au centre de leur commune — jusqu'à 14 au même point. Ils sont
étalés en spirale (120 à 450 m) pour rester cliquables un par un, et signalés
par un contour discontinu plus une mention dans l'infobulle. Ce décalage
n'affecte que l'affichage : `coords`, qui sert à toutes les distances, reste
intact.

## Périmètre géographique

Défini dans `config.mjs` par commune, **avec tous ses codes postaux**. Une
commune belge en couvre souvent plusieurs (anciennes communes fusionnées) :
filtrer sur une liste plate de 15 codes excluait à tort Louvain-la-Neuve (1348),
Genval (1332) ou Schepdaal (1703), pourtant dans les communes visées et bien
desservies.

## Filtres appliqués

Écartés : biens **déjà vendus** (les portails les laissent dans les résultats),
biens **hors périmètre**, biens **hors budget** (270 000 – 550 000 €, tolérance
de 10 % autour de 300–500 k€).

Conservés mais signalés : **sous option** (une option échoue souvent),
**au-dessus du budget** nominal, **prix « à partir de »** (projet neuf),
**prix modifié** (signalé par Immovlan — le seul indice de baisse disponible
sans historique), **position approximative** (géocodage à la localité, pas à
l'adresse).

Deux annonces d'un même portail aux chiffres identiques ne sont **pas**
fusionnées — ce sont souvent deux lots d'un même projet neuf, et perdre un bien
réel est pire qu'afficher un doublon. Elles portent un badge « annonce jumelle ».

## Pièges rencontrés (à ne pas réintroduire)

- **Century21** : chaque photo du carrousel est un `<a>` vers l'annonce (~30 par
  bien). Cibler ces liens remontait 520 diapositives sans texte au lieu de 24
  cartes → 0 annonce en silence. Le sélecteur doit viser le **conteneur** de la
  carte. Ses classes CSS sont hachées à chaque build (`style-module--card--7555a`)
  → ne jamais coder une classe complète en dur.
- **Century21** : la première `<img>` de chaque carte est un placeholder
  `data:image/svg+xml`. La vraie photo est dans `<source srcset>`.
- **Surfaces** : une carte affiche souvent habitable ET terrain. Prendre le
  premier `m²` rencontré donnait des « 295 m² habitables » qui étaient le
  terrain. Les valeurs sont classées par les mots qui les entourent ; quand rien
  ne permet de trancher, l'annonce est marquée incertaine.
- **Nombres nus** : Century21 affiche les pièces sans libellé, à côté d'icônes.
  Le compteur de photos du carrousel arrive en fragments séparés (`"1"`, `"/"`,
  `"30"`), donc « les 2 premiers entiers » donnait 1 chambre et 30 salles de
  bain sur toutes ses annonces. Les stats sont repérées par leur position
  relative au fragment de surface.
- **Séparateur de milliers** : ERA écrit `"1,829 m²"` pour 1829 m². Lu comme un
  décimal, un terrain de 1829 m² devenait 2 m².
- **Regex `m²` et `réservé`** : ne pas terminer par `\b`. `\b` se base sur
  `[A-Za-z0-9_]`, donc ni `²` ni `é` n'offrent de frontière en fin de chaîne —
  le motif ne matche jamais. Utiliser un lookahead.
- **`tagName` des éléments SVG est en minuscules** (`"svg"`, `"style"`),
  contrairement aux éléments HTML. Sans `toUpperCase()`, le CSS interne des
  icônes et des blobs JPEG binaires entraient dans les données.
- **Immovlan bloque le headless historique** (« You were blocked from &lt;ip&gt; »),
  même avec un User-Agent réaliste. `channel: 'chromium'` dans les
  `launchOptions` sélectionne le moteur headless récent, qui passe — ce qui
  évite d'ouvrir une fenêtre visible à chaque run.
- **Valeur et unité séparées** : Immovlan met « 154 » et « m² » dans deux
  éléments distincts, et place « Surface constructible » APRÈS sa valeur.
  `lib/parse.mjs` les recolle avant de parser.
- **La première surface non libellée est l'habitable**, pas la plus petite :
  la règle du minimum donnait 65 m² habitables pour une maison de 172 m².
- **Le statut se lit sur les fragments BRUTS** : le nettoyage retire les
  bandeaux `*** SOUS-OPTION ***` et `Vendu` (qui étaient pris pour des titres),
  donc les chercher après nettoyage ne trouve rien.
- **Chambres** : lire les fragments courts avant les longs. Le titre ERA
  « …bel-étage 3 chambres… » écrasait sinon la vraie valeur (4).
- **Zimmo** : l'URL de recherche n'a pas de filtre de localité (le `search=` est
  encodé en base64). On scrape donc des biens à Berlaar ou Gemmenich, écartés
  ensuite par le filtre de périmètre. À remplacer par un lien filtré.

## Limites connues

- **Zimmo ne rapporte rien** : son URL n'a pas de filtre de localité, donc ses
  21 annonces sont toutes hors zone. Refaire le lien depuis le site, ou retirer
  Zimmo de `URLS`.
- **Les URLs de recherche ne suivent pas `COMMUNES_CIBLES`**, sauf celle
  d'Immovlan qui est construite depuis la config. Ajouter une commune n'élargit
  donc que le filtre d'acceptation : les liens ERA, Century21 et Trevi doivent
  être régénérés à la main depuis les sites.
- **Trevi ne donne que 5 biens** sur 15 communes demandées. Offre réellement
  limitée, ou filtre d'URL trop restrictif — à vérifier.
- Les distances sont à vol d'oiseau (Haversine), pas des temps de trajet réels.
- Seules les pages de listing sont lues : pas d'année de construction ni de
  description complète (elles sont sur les pages détail). Le PEB est récupéré
  sur environ 70 % des biens.
- Aucun historique : chaque run remplace le précédent. Pas de détection des
  nouveautés ni des baisses de prix.
