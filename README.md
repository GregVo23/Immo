# Recherche immobilière — Brabant wallon & périphérie flamande

Agrège les annonces de 7 portails (Immoweb, Immovlan, ERA, Century21, Trevi,
Zimmo, Trior), les nettoie, les déduplique et génère un dashboard HTML
autonome.

## Utilisation

```bash
npm start         # scrape les 7 portails + parse → annonces.json
npm run reparse   # re-parse SANS re-scraper      → annonces.json
npm run adresses  # visite les fiches : adresse exacte + photos (incrémental, caché)
npm run dashboard # génère dashboard.html
npm test          # tests parsing, historique, adresses, santé, caractéristiques, marché (344 cas)
npm run all       # scrape + adresses + dashboard
```

Une variante utile après avoir modifié la sélection des photos dans
`lib/parse.mjs` :

```bash
node enrichir_adresses.mjs --sans-visite   # rejoue le choix sur le cache, sans réseau
```

Le cache mémorise les **candidats** et non le choix retenu : affiner la règle
ne coûte donc jamais une nouvelle visite des fiches.

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
scrapper_immo.mjs      → annonces-brutes.json  (texte + URLs d'images, aucun parsing)
parse_annonces.mjs     → annonces.json         (structuré, filtré, dédupliqué)
enrichir_adresses.mjs  → annonces.json         (adresse exacte + photos, depuis les fiches)
generate_dashboard.mjs → dashboard.html        (géocodage + mesures)
```

Le navigateur ne fait que ramasser : fragments de texte et liste d'URLs
d'images. Tout le tri se fait en Node, dans `lib/parse.mjs`, en fonctions
pures — y compris le choix de la photo à afficher.

Même principe pour les **caches**, qui rendent les opérations coûteuses
ponctuelles : `adresses-cache.json` mémorise les candidats bruts de chaque
fiche — pas le résultat — donc changer la règle de sélection se rejoue hors
ligne (`--sans-visite`), sans une seule requête ; `geocode-cache.json` évite
de redemander à Nominatim une adresse déjà résolue (1 requête/seconde).

Conséquence pratique : corriger une regex ne demande pas de re-scraper les
7 portails. On relance `npm run reparse` sur les données brutes déjà
récoltées, et `npm test` valide la correction en une seconde.

## Santé des portails

Chaque run compare sa récolte par portail à la **médiane des runs précédents**
(`sante-portails.json`) et alerte au-delà de −40 %.

Pourquoi : un portail muet se remarque, un portail qui s'effondre sans tomber
à zéro, non. ERA est passé de 100 à 22 cartes (défilement qui abandonnait trop
tôt) et Trior de 220 à 0 (une fenêtre promotionnelle HubSpot interceptait le
clic de son formulaire) — **les deux en silence**. Sans surveillance, on croit
simplement que le marché s'est calmé.

La référence est la médiane et non le dernier run : si le run précédent était
lui-même cassé, le comparer à lui ferait passer la panne pour la normale — et
la réparation pour une anomalie.

Seuils dans `SANTE` (config.mjs). Le seuil de 40 % laisse passer la variation
normale de l'offre (±20-30 %) tout en attrapant les vraies pannes.

## Adresses exactes

Les pages de résultats ne donnent presque jamais l'adresse : mesuré sur un run
réel, **63 biens sur 823 (7,6 %)** seulement avaient une rue, les autres étant
positionnés au centre de leur commune. C'est un problème de fond, pas
cosmétique : « accès gare » pèse **40 points sur 100** dans le score, et sur un
barème où 0,8 km vaut 100 points et 6 km en vaut 45, l'erreur de ±2 km
(largeur courante d'une commune) déplaçait un bien de 30 à 40 points. Le
classement était donc en grande partie du bruit.

`npm run adresses` visite la page de détail de chaque bien et en extrait la
rue (`lib/adresse_detail.mjs`). Couverture actuelle : **772 biens sur 1282
(60 %)**, dont 702 géocodés à l'adresse près. Le reste correspond surtout à
des annonces dont le vendeur masque volontairement l'adresse (« Demander
l'adresse exacte ») — on ne devine rien, ces biens gardent leur position
communale et leur badge « Position approx. ».

Effet mesuré du passage aux adresses exactes : déplacement moyen de 7,2 km, et
**14 points d'écart moyen** sur le critère « accès gare », 104 biens bougeant
de plus de 20 points.

Le coût tient grâce au **cache** (`adresses-cache.json`) : une adresse ne
change jamais, donc une fiche déjà visitée ne l'est plus jamais — y compris
celles sans adresse publiée, sinon elles seraient réessayées à chaque run pour
rien. Le premier passage est long (~1 fiche/seconde) ; les suivants ne
traitent que les nouvelles annonces. Le cache est écrit tous les 20 biens :
un run interrompu n'est pas perdu. Les erreurs techniques (délais réseau), en
revanche, ne sont **pas** mises en cache : elles sont retentées au run suivant.

⚠️ **Les coordonnées GPS présentes dans le HTML des portails sont
inutilisables** — vérifié sur données réelles : deux annonces Immoweb situées à
20 km l'une de l'autre (Ternat 1741 et Rebecq 1430) portaient des
`latitude`/`longitude` identiques, et une annonce Immovlan à Piétrain (Brabant
wallon) pointait en province de Liège, ~30 km à côté. Ces valeurs appartiennent
à d'autres composants de la page. On extrait donc le TEXTE de l'adresse et on
le confie au géocodage Nominatim déjà en place.

Piège de parsing à ne pas réintroduire : en néerlandais le type de voie est
**soudé** au nom (`Assesteenweg`, `Koldamstraat`, `Fossebaan`), alors qu'en
français c'est un mot isolé (`Rue De Tirlemont`). Exiger une frontière de mot
des deux côtés faisait rater 4 adresses flamandes sur 5.

## Photos : la bonne, et les suivantes

**Le problème n'était pas d'en trouver, mais d'en trouver trop.** Un audit sur
les 1282 biens a montré que **461 vignettes (36 %) n'étaient pas la photo du
bien** : 368 logos d'agence, 92 placeholders `nopic.svg`, des pictogrammes PEB.
Chez Immoweb, la carte de résultats ne contient souvent **aucune** photo — le
premier `<img>` est le logo de l'agence.

Le navigateur récolte donc **tous** les candidats, et `lib/parse.mjs` tranche
(`estImageUtilisable`, `choisirImage`, `construireGalerie`). Corriger la règle
ne demande qu'un `npm run reparse`, ou un `--sans-visite` pour les fiches.

Quand la carte n'a rien d'exploitable, la photo vient de la fiche de détail —
déjà visitée pour l'adresse, donc sans coût supplémentaire. Résultat :
**1280 biens sur 1282 ont une photo**, et **1168 ont une galerie** (jusqu'à
10 photos) qui défile au survol de la vignette, avec des pastilles de position.
Les photos ne sont pas préchargées : la suivante n'est demandée qu'au survol,
sinon ouvrir le dashboard lancerait plus de dix mille requêtes d'images.

Construire une galerie propre demande deux précautions, chacune tirée d'un cas
réel :

- **La même photo revient en plusieurs tailles** — ERA sert le même fichier
  sous trois `styles/` Drupal, Immoweb en 736×736 et 300×300, Whise en `/640/`
  et `/1920/`. Sans normalisation, la galerie affiche trois fois le même salon.
- **Une fiche mélange plusieurs biens** — une fiche Century21 portait
  **60 photos appartenant à quatre biens différents** (les « biens
  similaires »). D'où l'ancrage sur la couverture (`og:image`), qui décrit ce
  bien-là par définition : on ne garde que les photos rangées avec elle. Le
  repli sur le plus gros groupe n'intervient que si la couverture est isolée —
  Immovlan et Trevi la rangent à part. Inverser cet ordre affichait la maison
  du voisin.

Motifs écartés (`IMAGES_REJETEES`) : logos, pictogrammes PEB/EPC, icônes
d'interface, bannières publicitaires, placeholders, habillage de site. Chacun
vient de données réelles, et la liste est volontairement étroite : un motif
large comme `default` supprimerait les 66 photos ERA, servies sous
`sites/default/files/styles`.

## Caractéristiques lues sur les fiches

Cinq champs que les pages de résultats ne donnent jamais, extraits par
`lib/caracteristiques.mjs` :

| Champ | Couverture | Pourquoi il compte |
|---|---|---|
| Année de construction | 823 (64 %) | Isolation, conformité électrique, travaux à prévoir |
| PEB en kWh/m²/an | 850 (66 %) | Comparable entre régions, contrairement à la lettre |
| Nombre de façades | 778 (61 %) | 4 = isolée, 2 = mitoyenne des deux côtés |
| État du bien | 770 (60 %) | « À rénover » vs « Excellent état » |
| Revenu cadastral | 579 (45 %) | Base du précompte immobilier, dû chaque année |

Au total **1118 biens sur 1282 (87 %)** portent au moins un de ces champs.

Les portails exposent ces faits sous **trois formes incompatibles**, d'où les
trois passes : tableaux `<tr>`/`<dl>` (Immoweb, Trior), libellé et valeur sur
la même ligne (Zimmo, et Trior qui colle deux paires bout à bout —
« 1850Parking extérieur Oui »), ou valeur sur la ligne **suivante** (Immovlan,
ERA, Century21).

### Pièges, tous tirés de données réelles

- **Le PEB chiffré se reconnaît à son UNITÉ, pas à son libellé.** Immoweb
  publie deux consommations sur la même fiche : « d'énergie primaire
  342 kWh/m² » et « théorique totale 54000 kWh/an ». La seconde porte sur tout
  le logement — la confondre donnerait des valeurs cent fois trop grandes.
  Exiger « /m² » tranche sans dépendre du libellé, qui change à chaque portail.
  C'est ce changement de règle qui a fait passer la couverture de 13 % à 66 %.
- **Century21 fait suivre « Façades » de « 420 m² »** (c'est la surface du
  terrain, mal appariée) et annonce des constructions en **1111**. D'où les
  plages de validité : 1 à 6 façades, années 1700 à N+3.
- **Planchers de plausibilité** : 10 kWh/m²/an et 50 € de revenu cadastral.
  En dessous, ce n'est pas une donnée mais un fragment de numéro ramassé par
  erreur — un nom de fichier `EPC.pdf` suivi de `01_Begane_grond.pdf` donnait
  un « PEB 1 kWh/m² » sur 19 biens.
- **Le report efface avant de réappliquer.** `Object.assign` ajoute mais
  n'enlève jamais : sans effacement préalable, corriger un parseur laissait
  l'ancienne valeur erronée en place — exactement ce que `--sans-visite` est
  censé rendre impossible.

Le texte brut des fiches est mis en cache (~5 Ko par bien). Ajouter un champ
— type de chauffage, cave, garage — ne coûte donc **aucune visite** : un
parseur, un `node enrichir_adresses.mjs --sans-visite`, et c'est appliqué.

## Régions

Chaque bien porte un tag **Bruxelles / Wallonie / Flandre**, déduit du code
postal (`regionDuCp` dans `config.mjs`) et filtrable dans le dashboard.
Répartition actuelle : Wallonie 865, Flandre 376, Bruxelles 41.

Ce n'est pas qu'une étiquette géographique : la région fixe les **droits
d'enregistrement**, très différents d'une région à l'autre — de l'ordre de
8 000 € à 25 000 € d'écart sur un bien à 400 000 €.

La déduction se fait par tranches de codes postaux, exhaustives par
construction : aucune commune ajoutée à `COMMUNES_CIBLES` ne peut passer au
travers. Attention au découpage — le Brabant flamand occupe deux tranches
non contiguës (1500-1999 et 3000-3499), séparées par la province d'Anvers.

## Historique : nouveautés, baisses de prix, disparitions

`parse_annonces.mjs` compare chaque run à `historique.json` (créé au premier
`npm start`) pour détecter :
- **🆕 Nouveau** — un bien dont AUCUN lien (principal ou fusionné d'un autre
  portail) n'était connu avant ce run.
- **📉 Baisse de prix** — comparée uniquement au lien PRINCIPAL de l'annonce :
  si la fusion inter-portails change de source principale d'un run à l'autre,
  on ne compare pas deux prix de portails différents, donc pas de fausse
  baisse inventée. Le compromis : une vraie baisse peut être manquée le run
  où la source principale change (rare, sans conséquence au run suivant).
- **❌ Disparu** — absent depuis `HISTORIQUE.joursAvantDisparu` jours (2 par
  défaut) au moins. Ce délai n'est pas cosmétique : ERA est déjà tombé de 91 à
  33 cartes entre deux runs sans rapport avec une vraie baisse d'offre (aléa
  de scrape) — sans lui, un run raté ferait passer des dizaines de biens
  encore en vente pour vendus. Purgé de l'historique après
  `HISTORIQUE.joursPurge` jours (45) d'absence continue.

Le tout premier run ne marque **rien** comme nouveau (rien à comparer : ce
serait 100 % de bruit, pas un signal). De même, l'ajout d'un nouveau portail
(comme Immoweb ou Trior) fait mécaniquement apparaître tous ses biens comme
« nouveaux » au run suivant — c'est correct au sens strict (ils sont
nouveaux *pour ce suivi*), mais à interpréter comme tel plutôt que comme une
vraie vague d'arrivées sur le marché.

`historique.json` **n'est pas régénérable** comme les autres fichiers
gitignorés (annonces.json, geocode-cache.json...) : lui seul retient la
mémoire d'un run à l'autre. Le supprimer remet tout le suivi à zéro.
`disparus.json` est reconstruit à chaque run, secondaire.

Dans le dashboard : badges 🆕/📉 sur les cartes concernées, case « Nouveautés
seulement », tri « Plus récents d'abord », section repliable « Récemment
disparus », et deux tuiles KPI (Nouveautés, Baisses de prix).

| Fichier | Rôle |
|---|---|
| `config.mjs` | **Seul fichier à éditer** pour le périmètre : communes, budget, URLs, sélecteurs, régions |
| `lib/parse.mjs` | Parsing (prix, surfaces, chambres, PEB) + choix des photos + déduplication. Fonctions pures |
| `lib/adresse_detail.mjs` | Extraction de l'adresse depuis une fiche (JSON-LD → sélecteur → texte) |
| `lib/historique.mjs` | Suivi d'un run à l'autre : nouveautés, baisses, disparitions |
| `lib/sante.mjs` | Détection des portails qui s'effondrent en silence |
| `lib/racine.mjs` | Ancre le dossier de travail sur la racine du projet |
| `scrapper_immo.mjs` | Pilotage Playwright, scroll adaptatif, pagination |
| `parse_annonces.mjs` | Brut → propre, filtres de pertinence, rapport de qualité |
| `enrichir_adresses.mjs` | Visite des fiches : adresse exacte et galeries photo, avec cache |
| `maj_gares.mjs` | Régénère la liste des gares depuis le référentiel SNCB |
| `generate_dashboard.mjs` | Géocodage Nominatim (avec cache) + mesures + HTML |
| `lib/gares.mjs` | Gares du périmètre — **généré**, voir `maj_gares.mjs` |
| `lib/marche.mjs` | Médiane du prix au m² par commune et écart de chaque bien |
| `lib/caracteristiques.mjs` | Année de construction, état, façades, PEB chiffré, revenu cadastral |
| `test_*.mjs` | 344 cas bâtis sur des données réellement observées |

## Le prix relatif au marché local

« 1 411 €/m² » ne dit rien tout seul : c'est excellent à Rixensart (médiane
**3 160 €/m²**) et banal à Liedekerke (**2 158 €/m²**). Sans référence locale,
on ne distingue pas un bien bon marché d'un bien situé dans une commune bon
marché — et c'est précisément ce que l'œil ne peut pas faire sur un millier
de lignes.

Chaque fiche porte donc son écart à la médiane de **sa** commune
(`-18 % / Wavre`), et un tri « écart au marché croissant » met les meilleures
affaires en tête. Couverture : **1031 biens sur 1282**, répartis sur
38 communes.

Trois précautions :

- **Médiane, pas moyenne** : une maison de 930 m² à 414 €/m² ne doit pas
  tirer toute une commune vers le bas.
- **Seuil d'échantillon** (`MARCHE.minEchantillon`, 8 par défaut) : en dessous,
  aucun chiffre n'est publié. Une commune à trois biens donnerait une fausse
  précision, pire qu'une case vide.
- **Calculée en Node, pas dans le navigateur** : la référence porte sur tout
  le marché connu. La calculer sur la sélection affichée la ferait bouger à
  chaque filtre — un bien deviendrait « sous le marché » simplement parce
  qu'on a masqué ses voisins plus chers.

### Ce que cette fonctionnalité a révélé

Le tri par écart a immédiatement remonté des biens à **−84 %**, tous avec des
surfaces habitables de 700 à 930 m² pour 3 chambres. C'étaient des erreurs,
pas des affaires : la carte de résultats Immoweb n'affiche parfois **qu'une**
surface, sans libellé, et c'est le terrain.

Corrigé en relisant les fiches déjà en cache (`--sans-visite`, zéro requête) :
les surfaces y sont explicitement libellées. Vérification sur les 1005 biens
dont la fiche donne une surface habitable : **1001 concordent avec la carte**,
la carte est donc fiable — le défaut était étroit et ne touchait que les
**8 biens** dont la fiche ne mentionne aucune surface habitable, seulement
« Surface du terrain ». Pour ceux-là, l'habitable est désormais retiré plutôt
que faux, et le prix au m² recalculé.

Gain annexe : la surface de terrain, lue sur fiche, passe à **1088 biens** —
c'est un critère du score.

⚠️ Reste un cas que l'on ne peut pas corriger : un bien de Grez-Doiceau dont
Immoweb annonce lui-même habitable = terrain = jardin = 780 m². La donnée est
fausse à la source. Dix autres biens ont légitimement habitable = terrain
(maisons neuves sur petite parcelle, bâties sur plusieurs niveaux), donc une
règle automatique y ferait plus de dégâts qu'elle n'en réparerait.

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

## Les gares : référentiel officiel, pas une liste à la main

`node maj_gares.mjs` régénère `lib/gares.mjs` depuis le référentiel SNCB
(api.irail.be). À relancer après avoir élargi `COMMUNES_CIBLES`.

Pourquoi un script : « accès gare » pèse **40 points sur 100** et le barème
est raide (0,8 km = 100 points, 6 km = 45). Une erreur de coordonnées de 2 km
déplace un bien de 20 à 30 points. La liste écrite à la main en contenait :

- **Genappe y figurait comme gare** alors que sa ligne est fermée aux
  voyageurs depuis des décennies. Ses 49 biens étaient notés comme ayant une
  gare à 500 m ; la vraie plus proche est à 6,3 km.
- **Hélécine était rattachée à Louvain, 23,9 km** — alors qu'Ezemaal est à
  1,2 km. Même chose pour La Bruyère (Villers-la-Ville 22,4 km → Rhisnes
  0,7 km) et Orp-Jauche (Wavre 27 km → Neerwinden 6,1 km).
- Douze gares décalées de 1 à 2,3 km, et trois noms en double entre français
  et néerlandais (Halle/Hal, Vilvoorde/Vilvorde, Groot-Bijgaarden/Grand-Bigard).

Bilan du passage de 30 à 118 gares : **1083 biens sur 1282** ont vu leur
distance gare corrigée, de 3,3 km en moyenne. Médiane désormais à 1,5 km,
765 biens à moins de 2 km.

Critère de sélection : au moins 3 biens du périmètre à moins de 6 km, **ou**
le centre d'une commune cible à moins de 6 km. Le second critère évite une
dépendance circulaire — une commune fraîchement ajoutée n'a encore aucun
bien, donc n'amènerait aucune gare, et ses futurs biens seraient rattachés à
une gare lointaine.

## La carte

Trois vues : **Fiches**, **Carte**, **Tableau**. Le choix de vue, le thème, les
favoris, les pondérations du score **et les filtres** sont mémorisés dans le
navigateur : recharger après un nouveau scrape ne fait plus perdre la sélection
en cours.

**Masquer un bien** : le bouton ✕ sur la vignette l'écarte de toutes les vues,
définitivement. Contrairement aux filtres, ce n'est pas remis à zéro par
« Réinitialiser » — c'est un choix délibéré, au même titre qu'un favori. La
case « Afficher les N bien(s) masqué(s) » les fait réapparaître en grisé pour
en restaurer un (↺), et « Tout réafficher » vide la liste.

L'exclusion mémorise **deux** identifiants par bien : son lien et sa clé
d'adresse (rue + numéro + code postal). Le lien seul ne suffirait pas — la
fusion inter-portails retient l'exemplaire le plus complet, qui peut changer
d'un run à l'autre, et le bien masqué réapparaîtrait sous le lien d'un autre
portail. Les biens sans adresse exacte retombent sur le lien seul.

La carte superpose au fond OpenStreetMap — qui rend déjà les autoroutes en
orange avec leurs écussons E19/E40/E411 — les **118 gares** et les **12 accès
autoroute** qui servent au calcul du score. Chaque famille a sa forme, sa
couleur et son libellé : rond bleu pour les biens, carré orange pour les gares,
triangle vert pour les accès. La couleur du bien suit son score (rampe bleue,
plus foncé = meilleur).

Les 130 libellés se chevauchaient et couvraient toute la région bruxelloise vus
de loin : ils n'apparaissent donc qu'à partir du zoom 12, et le nom reste
accessible au survol en dessous. Une couche optionnelle affiche un rayon de
2 km autour de chaque gare.

**Positions approximatives** : **580 biens sur 1282** n'ont pas d'adresse
publiée et sont géocodés au centre de leur commune — jusqu'à 14 au même point.
Ils sont étalés en spirale (120 à 450 m) pour rester cliquables un par un, et
signalés par un contour discontinu plus une mention dans l'infobulle. Ce
décalage n'affecte que l'affichage : `coords`, qui sert à toutes les distances,
reste intact.

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
- **Trior n'a pas d'URL de recherche filtrable** : son formulaire soumet en
  `POST` (style ASP.NET). `scrapper_immo.mjs` le pilote directement (catégorie
  « Maison » + sélection multiple des codes postaux du périmètre, valeur =
  CP) plutôt que de construire un lien.
- **Le code postal Trior n'est nulle part dans le texte de la carte**
  (« Waterloo » seul, jamais « 1410 Waterloo ») — seulement dans l'URL de
  l'annonce (`.../maison/1410-waterloo/7854102`). `parseCpEtVilleDepuisLien`
  sert de repli.
- **Terrain en ares** : Trior affiche un entier nu juste après la surface
  habitable (« 340 m² » puis « 8 ») qui vaut le terrain en ares (1 are =
  100 m²) — une convention belge absente des 5 autres portails.
- **Immoweb duplique chaque fait en deux fragments** : un prix lisible
  (« 495 000 € ») et sa version compacte (« 495000€ »), des chambres en toutes
  lettres et en abrégé (« 3 chambres » / « 3 ch. »), une unité répétée pour
  l'accessibilité (« mètres carrés » après « m² »). Sans le filtre dédié,
  « mètres carrés » (13 caractères, pas de chiffre, pas de €) passait pour un
  titre valable.
- **Immoweb sépare ses faits par un point médian décoratif** (`·`), tantôt en
  fragment isolé, tantôt collé à la valeur (`"· 241"`) — les deux cas sont
  nettoyés avant tout traitement, sinon `"· 241"` ne se recollait pas avec le
  `"m²"` qui suit.
- **Le PEB d'Immoweb est une icône, pas du texte** (`peb_e.png`) : lu depuis
  les URLs d'image et injecté comme un fragment `"PEB E"` ordinaire.
- **Le filtre d'Immoweb n'est pas strict côté serveur** : une fois les
  résultats exacts épuisés, il complète avec des biens proches hors périmètre
  ou légèrement hors budget (~16 % de l'échantillon sondé). Sans conséquence :
  le filtre de `parse_annonces.mjs` les écarte comme n'importe quel portail.
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

- **Zimmo n'apporte quasiment rien** (1 bien retenu) : son URL de recherche
  n'a pas de filtre de localité — le `search=` est encodé en base64 — donc on
  scrape des biens à Berlaar ou Gemmenich, écartés ensuite par le filtre de
  périmètre. Refaire le lien depuis le site, ou retirer Zimmo de `URLS`.
- **Les URLs de recherche ne suivent pas `COMMUNES_CIBLES`**, sauf celles
  d'Immovlan et de Trior qui sont construites depuis la config. Ajouter une
  commune n'élargit donc que le filtre d'acceptation : les liens ERA,
  Century21 et Trevi doivent être régénérés à la main depuis les sites.
- **Trevi ne donne que 5 biens** sur 15 communes demandées. Offre réellement
  limitée, ou filtre d'URL trop restrictif — à vérifier.
- **Les distances sont à vol d'oiseau** (Haversine), pas des temps de trajet
  réels. Une gare à 3 km peut demander 25 minutes sans voiture.
- **Les fiches ne sont exploitées que partiellement** : description complète,
  type de chauffage, présence d'un garage ou d'une cave sont dans le texte
  brut désormais mis en cache, mais pas encore extraits. Les ajouter ne coûte
  plus de visite — seulement un parseur dans `lib/caracteristiques.mjs` et un
  `--sans-visite`.
- **Revenu cadastral absent sur 55 % des biens** : seuls Immoweb, Immovlan,
  Trior et ERA le publient. Sans lui, le précompte immobilier — un coût
  annuel récurrent — reste invisible pour la moitié du catalogue.
- **114 biens n'ont qu'une seule photo** : soit l'annonce n'en publie pas
  davantage, soit le portail charge sa galerie trop tard pour la récolte.
- **89 fiches ont échoué** à la dernière récolte (délais réseau). Elles sont
  retentées automatiquement au prochain `npm run adresses`.
