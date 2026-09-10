/**
 * Génère dashboard.html à partir de annonces.json.
 *
 * Deux principes :
 *  1. Node calcule des MESURES brutes (distances, prix/m²), jamais un score.
 *  2. Le score est calculé dans le navigateur, à partir de pondérations que tu
 *     règles avec des sliders. Un critère dont la donnée manque est exclu du
 *     calcul et l'annonce affiche sur quelle part des critères son score repose,
 *     au lieu de laisser croire à une note comparable.
 *
 * C'est ce qui corrige le biais de l'ancienne version : les commodités étaient
 * déduites du titre, or seul ERA a des titres descriptifs. ERA gagnait jusqu'à
 * 20 points que Trevi et Century21 ne pouvaient pas obtenir.
 */

import './lib/racine.mjs'; // doit rester en premier : fixe le dossier de travail
import fs from 'fs';
import { FICHIERS } from './config.mjs';

/* ============================================================
   1. RÉFÉRENTIELS GÉOGRAPHIQUES
   ============================================================ */

const BRUXELLES_CENTRE = { lat: 50.8466, lon: 4.3528 };

const GARES = [
    { nom: 'Bruxelles-Central', lat: 50.8455, lon: 4.3572 },
    { nom: 'Bruxelles-Midi', lat: 50.836, lon: 4.3352 },
    { nom: 'Bruxelles-Nord', lat: 50.86, lon: 4.3612 },
    { nom: 'Bruxelles-Luxembourg', lat: 50.8377, lon: 4.3796 },
    { nom: 'Etterbeek', lat: 50.8322, lon: 4.3897 },
    { nom: 'Schaerbeek', lat: 50.8735, lon: 4.3746 },
    { nom: 'Watermael', lat: 50.8093, lon: 4.4166 },
    { nom: 'Boitsfort', lat: 50.801, lon: 4.4237 },
    { nom: 'Halle', lat: 50.7377, lon: 4.2417 },
    { nom: 'Malines', lat: 51.0182, lon: 4.4805 },
    { nom: 'Louvain', lat: 50.8809, lon: 4.7166 },
    { nom: 'Ottignies', lat: 50.6653, lon: 4.5667 },
    { nom: 'Louvain-la-Neuve', lat: 50.6693, lon: 4.6152 },
    { nom: 'Waterloo', lat: 50.7186, lon: 4.3986 },
    { nom: "Braine-l'Alleud", lat: 50.6844, lon: 4.3667 },
    { nom: 'Nivelles', lat: 50.5975, lon: 4.3269 },
    { nom: 'Wavre', lat: 50.7167, lon: 4.6167 },
    { nom: 'La Hulpe', lat: 50.7314, lon: 4.4936 },
    { nom: 'Rixensart', lat: 50.7186, lon: 4.5236 },
    { nom: 'Genval', lat: 50.7108, lon: 4.5069 },
    { nom: 'Genappe', lat: 50.6136, lon: 4.4519 },
    { nom: 'Villers-la-Ville', lat: 50.5973, lon: 4.5217 },
    { nom: 'Vilvoorde', lat: 50.9275, lon: 4.4239 },
    { nom: 'Zaventem', lat: 50.8694, lon: 4.4728 },
    { nom: 'Asse', lat: 50.9058, lon: 4.2003 },
    { nom: 'Ternat', lat: 50.8814, lon: 4.1494 },
    { nom: 'Liedekerke', lat: 50.8722, lon: 4.0847 },
    { nom: 'Denderleeuw', lat: 50.8825, lon: 4.0742 },
    { nom: 'Sint-Martens-Bodegem', lat: 50.8503, lon: 4.2247 },
    { nom: 'Groot-Bijgaarden', lat: 50.8703, lon: 4.2653 },
];

const ACCES_AUTOROUTE = [
    { nom: 'R0 / E19 Hal', lat: 50.7378, lon: 4.2358 },
    { nom: 'R0 / E19 Groot-Bijgaarden', lat: 50.8622, lon: 4.2669 },
    { nom: 'R0 / A12 Strombeek', lat: 50.8992, lon: 4.3459 },
    { nom: 'R0 / E19 Machelen', lat: 50.9106, lon: 4.4392 },
    { nom: 'R0 / E40 Zaventem', lat: 50.8836, lon: 4.4681 },
    { nom: 'R0 / E411 Overijse', lat: 50.7719, lon: 4.5333 },
    { nom: 'R0 / N5 Waterloo', lat: 50.7297, lon: 4.3931 },
    { nom: "E19 Braine-l'Alleud", lat: 50.6725, lon: 4.3739 },
    { nom: 'E411 Wavre', lat: 50.7156, lon: 4.6203 },
    { nom: 'E40 Louvain', lat: 50.8654, lon: 4.6839 },
    { nom: 'E411 Ottignies/LLN', lat: 50.6572, lon: 4.6119 },
    { nom: 'E429 Ternat/Asse', lat: 50.8778, lon: 4.1731 },
];

/* ============================================================
   2. GÉOCODAGE
   ============================================================ */

function chargerCache() {
    if (fs.existsSync(FICHIERS.cacheGeocode)) return JSON.parse(fs.readFileSync(FICHIERS.cacheGeocode, 'utf-8'));
    return {};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Requête de géocodage la plus précise possible : avec la rue quand on l'a
 * (ERA), sinon au centre de la localité. Le niveau de précision est renvoyé
 * pour que le dashboard puisse le signaler.
 */
function requeteGeocodage(a) {
    if (a.rue && a.cp) return { q: `${a.rue}, ${a.cp} ${a.ville ?? ''}, Belgique`.trim(), precision: 'adresse' };
    if (a.cp) return { q: `${a.cp} ${a.ville ?? ''}, Belgique`.trim(), precision: 'localite' };
    return null;
}

/** Compteur d'appels réseau réels, replis compris. */
let appelsNominatim = 0;

async function interrogerNominatim(q, cache) {
    if (cache[q] !== undefined) return cache[q];
    appelsNominatim++;
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=be&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'scraper-immo-personnel/3.0' } });
        const data = await res.json();
        // Nominatim demande 1 req/s maximum : on respecte la limite.
        await sleep(1100);
        const coords = data?.length ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
        cache[q] = coords;
        return coords;
    } catch (e) {
        console.warn(`   ⚠️ géocodage échoué pour "${q}" : ${e.message}`);
        cache[q] = null;
        return null;
    }
}

async function geocoder(a, cache) {
    const req = requeteGeocodage(a);
    if (!req) return { coords: null, precision: null };

    const coords = await interrogerNominatim(req.q, cache);
    if (coords) return { coords, precision: req.precision };

    // Repli sur le code postal seul. Certaines orthographes de localité ne sont
    // pas connues de Nominatim (« Woluwe-saint-Etienne », « Baisy-Thy »), et une
    // rue introuvable ne doit pas faire perdre la commune : mieux vaut une
    // position au centre du code postal, signalée comme approximative, que pas
    // de position du tout — sinon tous les critères de distance sont exclus.
    if (a.cp) {
        const repli = await interrogerNominatim(`${a.cp}, Belgique`, cache);
        if (repli) return { coords: repli, precision: 'localite' };
    }
    return { coords: null, precision: null };
}

/* ============================================================
   3. MESURES
   ============================================================ */

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function plusProche(lat, lon, liste) {
    let meilleur = null;
    let distance = Infinity;
    for (const p of liste) {
        const d = haversineKm(lat, lon, p.lat, p.lon);
        if (d < distance) {
            distance = d;
            meilleur = p;
        }
    }
    return { nom: meilleur.nom, km: Math.round(distance * 10) / 10 };
}

function mesurer(a, coords, precision) {
    if (!coords) {
        return {
            ...a,
            coords: null,
            precisionGeo: null,
            gareNom: null,
            distanceGareKm: null,
            routeNom: null,
            distanceRouteKm: null,
            distanceBruxellesKm: null,
        };
    }
    const gare = plusProche(coords.lat, coords.lon, GARES);
    const route = plusProche(coords.lat, coords.lon, ACCES_AUTOROUTE);
    return {
        ...a,
        coords,
        precisionGeo: precision,
        gareNom: gare.nom,
        distanceGareKm: gare.km,
        routeNom: route.nom,
        distanceRouteKm: route.km,
        distanceBruxellesKm: Math.round(haversineKm(coords.lat, coords.lon, BRUXELLES_CENTRE.lat, BRUXELLES_CENTRE.lon) * 10) / 10,
    };
}

/* ============================================================
   4. PIPELINE
   ============================================================ */

if (!fs.existsSync(FICHIERS.annonces)) {
    console.error(`❌ ${FICHIERS.annonces} introuvable. Lance d'abord : npm start (ou npm run reparse)`);
    process.exit(1);
}

const annoncesBrutes = JSON.parse(fs.readFileSync(FICHIERS.annonces, 'utf-8'));

// Optionnel : absent au tout premier run (aucun bien n'a encore pu disparaître).
const disparus = fs.existsSync(FICHIERS.disparus) ? JSON.parse(fs.readFileSync(FICHIERS.disparus, 'utf-8')) : [];

console.log(`📍 Géocodage de ${annoncesBrutes.length} biens (1 req/s pour les adresses non mises en cache)...`);

const cache = chargerCache();
const annonces = [];

for (const [i, a] of annoncesBrutes.entries()) {
    const { coords, precision } = await geocoder(a, cache);
    // `fragments` n'a servi qu'au parsing : inutile de l'embarquer dans le HTML.
    const { fragments, ...reste } = a;
    annonces.push(mesurer(reste, coords, precision));
    if ((i + 1) % 10 === 0) process.stdout.write('.');
}

fs.writeFileSync(FICHIERS.cacheGeocode, JSON.stringify(cache, null, 2));
console.log(`\n   ${appelsNominatim} requête(s) Nominatim, le reste depuis le cache.`);

const sansCoords = annonces.filter((a) => !a.coords).length;
if (sansCoords) console.log(`   ⚠️ ${sansCoords} bien(s) non géolocalisés : les critères de distance seront exclus de leur score.`);

/* ------------------------------------------------------------
   Positions d'AFFICHAGE pour la carte
   ------------------------------------------------------------
   64 % des biens partagent leur point : faute d'adresse, ils sont géocodés au
   centre de leur commune — jusqu'à 14 empilés au même endroit. Sur la carte,
   ils ne feraient qu'un seul marqueur.

   On les étale donc en spirale autour du centre communal. Ces positions sont
   DÉJÀ approximatives (badge « Position approx. »), donc le décalage n'invente
   rien de plus : il rend seulement les biens cliquables un par un. Les biens
   géocodés à l'adresse exacte ne sont jamais déplacés, et `coords` — qui sert
   à toutes les distances — reste intact.
   ------------------------------------------------------------ */

const ANGLE_OR = Math.PI * (3 - Math.sqrt(5)); // répartition régulière en spirale

function calculerPositionsAffichage(liste) {
    const groupes = new Map();
    for (const a of liste) {
        if (!a.coords) continue;
        const cle = `${a.coords.lat.toFixed(5)},${a.coords.lon.toFixed(5)}`;
        if (!groupes.has(cle)) groupes.set(cle, []);
        groupes.get(cle).push(a);
    }

    let etales = 0;
    for (const groupe of groupes.values()) {
        // Position exacte, ou seul à cet endroit : rien à faire.
        if (groupe.length === 1) {
            groupe[0].coordsAffichage = groupe[0].coords;
            continue;
        }
        let i = 0;
        for (const a of groupe) {
            if (a.precisionGeo === 'adresse') {
                a.coordsAffichage = a.coords;
                continue;
            }
            // Rayon croissant en racine carrée : densité constante, ~120 m pour
            // le premier, ~450 m au 14e — on reste dans la commune.
            const rayonM = 120 * Math.sqrt(i + 1);
            const angle = i * ANGLE_OR;
            const dLat = (rayonM * Math.cos(angle)) / 111320;
            const dLon = (rayonM * Math.sin(angle)) / (111320 * Math.cos((a.coords.lat * Math.PI) / 180));
            a.coordsAffichage = { lat: a.coords.lat + dLat, lon: a.coords.lon + dLon };
            i++;
            etales++;
        }
    }
    return etales;
}

const etales = calculerPositionsAffichage(annonces);
if (etales) console.log(`   🗺️ ${etales} bien(s) étalés autour de leur centre communal pour rester distincts sur la carte.`);

/* ============================================================
   5. HTML
   ============================================================
   Palette : instance de référence du guide dataviz (validée avec
   scripts/validate_palette.js en clair ET en sombre).
     - une seule teinte catégorielle (slot 1 bleu) : il n'y a qu'une série,
       donc pas de légende nécessaire
     - jauge de score = rampe séquentielle bleue (le score est une magnitude,
       pas un état) : remplissage bleu, piste = pas clair de la même rampe
     - couleurs de statut réservées, toujours accompagnées d'une icône ET d'un
       libellé (jamais la couleur seule)
   ============================================================ */

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Recherche immobilière</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
:root {
  color-scheme: light;
  --page:            #f9f9f7;
  --surface:         #fcfcfb;
  --text-primary:    #0b0b0b;
  --text-secondary:  #52514e;
  --text-muted:      #898781;
  --border:          rgba(11,11,11,0.10);
  --gridline:        #e1e0d9;
  --baseline:        #c3c2b7;
  --series-1:        #2a78d6;
  --seq-track:       #cde2fb;
  --seq-fill:        #2a78d6;
  --status-good:     #0ca30c;
  --status-warning:  #fab219;
  --status-serious:  #ec835a;
  --status-critical: #d03b3b;
  --success-text:    #006300;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --page:           #0d0d0d;
    --surface:        #1a1a19;
    --text-primary:   #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted:     #898781;
    --border:         rgba(255,255,255,0.10);
    --gridline:       #2c2c2a;
    --baseline:       #383835;
    --series-1:       #3987e5;
    --seq-track:      #184f95;
    --seq-fill:       #3987e5;
    --success-text:   #0ca30c;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page:           #0d0d0d;
  --surface:        #1a1a19;
  --text-primary:   #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted:     #898781;
  --border:         rgba(255,255,255,0.10);
  --gridline:       #2c2c2a;
  --baseline:       #383835;
  --series-1:       #3987e5;
  --seq-track:      #184f95;
  --seq-fill:       #3987e5;
  --success-text:   #0ca30c;
}

* { box-sizing: border-box; }
body {
  margin: 0; padding: 24px 20px 64px;
  background: var(--page); color: var(--text-primary);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.wrap { max-width: 1360px; margin: 0 auto; }

h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.01em; }
.sous-titre { color: var(--text-secondary); font-size: 13px; margin: 0; }
.entete { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }

.carte-plane { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }

/* ---------- KPI ---------- */
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
.kpi { background: var(--surface); padding: 16px 18px; }
.kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; }
.kpi-valeur { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
.kpi-note { font-size: 11px; color: var(--text-secondary); margin-top: 3px; }
.kpi.hero .kpi-valeur { font-size: 48px; line-height: 1.05; font-weight: 600; }

/* ---------- Filtres ---------- */
.barre-filtres { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: flex-end; padding: 14px 16px; margin-bottom: 16px; }
.champ { display: flex; flex-direction: column; gap: 4px; }
.champ label { font-size: 11px; font-weight: 600; color: var(--text-secondary); }
input[type="text"], input[type="number"], select {
  font: inherit; font-size: 13px; padding: 6px 9px;
  background: var(--surface); color: var(--text-primary);
  border: 1px solid var(--baseline); border-radius: 6px; min-height: 34px;
}
input[type="text"] { width: 190px; }
input[type="number"] { width: 110px; }
select { min-width: 150px; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--series-1); outline-offset: 1px; }

button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid var(--baseline); background: var(--surface); color: var(--text-primary); padding: 7px 12px; min-height: 34px; }
button:hover { border-color: var(--text-muted); }
button[aria-pressed="true"] { background: var(--series-1); border-color: var(--series-1); color: #fff; }
.case { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); min-height: 34px; }

/* ---------- Pondérations ---------- */
.panneau-poids { padding: 16px 18px; margin-bottom: 16px; }
.panneau-poids > summary { cursor: pointer; font-weight: 600; font-size: 13px; }
.grille-poids { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px 22px; margin-top: 14px; }
.poids-ligne { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; }
.poids-ligne .nom { font-size: 12px; color: var(--text-secondary); }
.poids-ligne .val { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-primary); font-weight: 600; }
.poids-ligne input[type="range"] { grid-column: 1 / -1; width: 100%; accent-color: var(--series-1); }
.actions-poids { display: flex; gap: 8px; margin-top: 14px; align-items: center; flex-wrap: wrap; }
.aide { font-size: 12px; color: var(--text-secondary); margin: 8px 0 0; }

/* ---------- Graphique communes ---------- */
.bloc-graphe { padding: 16px 18px; margin-bottom: 16px; }
.bloc-graphe > summary { cursor: pointer; font-size: 13px; font-weight: 600; }
/* Replié, le bloc ne doit pas garder la marge basse de sa légende. */
.bloc-graphe:not([open]) > summary { margin: 0; }
.titre-bloc { font-size: 13px; font-weight: 600; margin: 0 0 2px; }
.legende-bloc { font-size: 12px; color: var(--text-secondary); margin: 8px 0 14px; }
.barres { display: flex; flex-direction: column; gap: 6px; }
.barre-ligne { display: grid; grid-template-columns: 150px 1fr 42px; gap: 10px; align-items: center; cursor: pointer; background: none; border: none; padding: 2px 0; text-align: left; min-height: 28px; }
.barre-ligne:hover .piste { background: var(--gridline); }
.barre-ligne .nom { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* display:block indispensable : ce sont des <span>, donc inline par défaut,
   et un élément inline ignore height — les barres étaient invisibles. */
.piste { display: block; height: 14px; background: transparent; border-radius: 2px; position: relative; }
.barre { display: block; height: 14px; max-height: 24px; background: var(--series-1); border-radius: 0 4px 4px 0; }
.barre-ligne .compte { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--text-primary); text-align: right; }
.axe { border-top: 1px solid var(--baseline); margin-top: 10px; padding-top: 4px; display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }

/* ---------- Biens disparus ---------- */
.liste-disparus { display: flex; flex-direction: column; gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.ligne-disparu { display: grid; grid-template-columns: 1fr auto auto auto; gap: 12px; align-items: center; padding: 8px 12px; background: var(--surface); font-size: 12px; }
.ligne-disparu .titre { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ligne-disparu .lieu { color: var(--text-muted); }
.ligne-disparu .prix { font-variant-numeric: tabular-nums; color: var(--text-secondary); white-space: nowrap; }
.ligne-disparu .depuis { color: var(--text-muted); white-space: nowrap; }
.ligne-disparu a { color: var(--series-1); text-decoration: none; font-weight: 600; }
.ligne-disparu a:hover { text-decoration: underline; }

/* ---------- Grille de biens ---------- */
.grille { display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 16px; }
.bien { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
.photo { aspect-ratio: 4 / 3; background: var(--gridline); position: relative; overflow: hidden; }
.photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
.photo .absente { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 12px; }
.fav { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); display: flex; align-items: center; justify-content: center; font-size: 15px; padding: 0; }
.corps { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
.bien h3 { font-size: 14px; font-weight: 600; margin: 0; line-height: 1.35; }
.lieu { font-size: 12px; color: var(--text-secondary); margin: 0; }

/* Jauge de score : rampe séquentielle (magnitude), piste = pas clair de la même rampe */
.jauge-bloc { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: baseline; }
.jauge-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.jauge-valeur { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
.jauge { grid-column: 1 / -1; height: 6px; background: var(--seq-track); border-radius: 3px; overflow: hidden; }
.jauge > span { display: block; height: 100%; background: var(--seq-fill); border-radius: 0 3px 3px 0; }
.fiabilite { grid-column: 1 / -1; font-size: 11px; color: var(--text-secondary); }

.prix-ligne { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.prix { font-size: 19px; font-weight: 600; letter-spacing: -0.02em; }
.prix-m2 { font-size: 12px; color: var(--text-secondary); }
.faits { display: flex; flex-wrap: wrap; gap: 6px; }
.fait { font-size: 12px; color: var(--text-secondary); background: var(--page); border: 1px solid var(--border); border-radius: 5px; padding: 3px 8px; }
.trajets { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text-secondary); }

/* Badges de statut : icône + libellé, jamais la couleur seule */
.badges { display: flex; flex-wrap: wrap; gap: 6px; }
.badge { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 5px; border: 1px solid; display: inline-flex; align-items: center; gap: 4px; }
.badge.avertissement { color: var(--text-primary); border-color: var(--status-warning); background: color-mix(in srgb, var(--status-warning) 14%, transparent); }
.badge.incertain     { color: var(--text-primary); border-color: var(--status-serious); background: color-mix(in srgb, var(--status-serious) 14%, transparent); }
.badge.info          { color: var(--text-secondary); border-color: var(--border); background: var(--page); }
.badge.bon           { color: var(--text-primary); border-color: var(--status-good); background: color-mix(in srgb, var(--status-good) 12%, transparent); }

.pied { border-top: 1px solid var(--border); padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px; color: var(--text-muted); }
.pied a { color: var(--series-1); font-weight: 600; text-decoration: none; font-size: 12px; }
.pied a:hover { text-decoration: underline; }

/* ---------- Vue tableau (jumelle accessible de la grille) ---------- */
.tableau-conteneur { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--gridline); white-space: nowrap; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tbody tr:hover { background: var(--page); }

/* ---------- Carte ---------- */
/* Les tuiles restent en cartographie claire dans les deux thèmes : la couleur
   des routes EST porteuse de sens (les autoroutes sont orange sur OSM), et
   inverser les tuiles en mode sombre détruirait ce codage. La carte se lit
   comme une image, pas comme un élément d'interface. */
#blocCarte { padding: 0; overflow: hidden; }
#carte { height: 620px; width: 100%; background: var(--gridline); }
#carte.zoom-faible .etiquette-gare, #carte.zoom-faible .etiquette-route { display: none; }
.carte-entete { padding: 14px 18px 12px; }
.carte-pied { padding: 12px 18px; border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; }

.leaflet-container { font: inherit; font-size: 13px; }
.leaflet-popup-content-wrapper { border-radius: 8px; }
.leaflet-popup-content { margin: 12px 14px; min-width: 210px; }
.popup-titre { font-weight: 600; font-size: 13px; margin: 0 0 4px; line-height: 1.35; color: #0b0b0b; }
.popup-lieu { font-size: 12px; color: #52514e; margin: 0 0 8px; }
.popup-prix { font-size: 16px; font-weight: 600; color: #0b0b0b; }
.popup-m2 { font-size: 12px; color: #52514e; margin-left: 6px; }
.popup-faits { font-size: 12px; color: #52514e; margin: 6px 0; }
.popup-note { font-size: 11px; color: #898781; margin: 6px 0 0; }
.popup-lien { display: inline-block; margin-top: 8px; font-size: 12px; font-weight: 600; color: #2a78d6; text-decoration: none; }
.popup-lien:hover { text-decoration: underline; }
.popup-img { width: 100%; height: 90px; object-fit: cover; border-radius: 5px; margin-bottom: 8px; display: block; }

/* Marqueurs de gare et d'accès autoroute : forme ET couleur ET libellé, pour
   que l'identité ne repose jamais sur la seule couleur. */
.pastille { border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.25); box-sizing: border-box; }
.pastille-gare { width: 14px; height: 14px; background: #eb6834; border-radius: 3px; }
.pastille-route { width: 0; height: 0; background: none; border: 7px solid transparent; border-bottom: 12px solid #1baf7a; box-shadow: none; filter: drop-shadow(0 0 1px rgba(0,0,0,.5)); }
.etiquette-gare, .etiquette-route { background: rgba(255,255,255,.92); border: none; box-shadow: none; padding: 1px 5px; border-radius: 3px; font-size: 11px; font-weight: 600; color: #0b0b0b; }
.etiquette-gare { color: #8a3410; }
.etiquette-route { color: #0f6b4a; }
.etiquette-gare::before, .etiquette-route::before { display: none; }

/* Légende : chaque famille avec sa forme, sa couleur et son libellé */
.legende { display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center; font-size: 12px; color: var(--text-secondary); }
.legende-item { display: inline-flex; align-items: center; gap: 6px; }
.puce { display: inline-block; border: 2px solid var(--surface); box-sizing: border-box; }
.puce-bien { width: 13px; height: 13px; border-radius: 50%; background: var(--seq-fill); }
.puce-approx { width: 13px; height: 13px; border-radius: 50%; background: transparent; border: 2px dashed var(--seq-fill); }
.puce-gare { width: 13px; height: 13px; border-radius: 3px; background: #eb6834; }
.puce-route { width: 0; height: 0; border: 6px solid transparent; border-bottom: 11px solid #1baf7a; }
.rampe { display: inline-flex; align-items: center; gap: 4px; }
.rampe span { width: 15px; height: 9px; display: inline-block; border-radius: 2px; }

.segmente { display: inline-flex; border: 1px solid var(--baseline); border-radius: 6px; overflow: hidden; }
.segmente button { border: none; border-radius: 0; border-left: 1px solid var(--baseline); }
.segmente button:first-child { border-left: none; }

.vide { padding: 40px; text-align: center; color: var(--text-secondary); }
[hidden] { display: none !important; }
</style>
</head>
<body>
<div class="wrap">

  <div class="entete">
    <div>
      <h1>Recherche immobilière</h1>
      <p class="sous-titre">Brabant wallon et périphérie flamande — les pondérations du score sont réglables ci-dessous.</p>
    </div>
    <div style="display:flex; gap:8px; align-items:center;">
      <button id="btnTheme" title="Basculer clair / sombre">◐ Thème</button>
      <div class="segmente" role="group" aria-label="Mode d'affichage">
        <button id="vueCartes" aria-pressed="true">▦ Fiches</button>
        <button id="vueCarte" aria-pressed="false">🗺 Carte</button>
        <button id="vueTable" aria-pressed="false">▤ Tableau</button>
      </div>
    </div>
  </div>

  <div class="kpis" id="kpis"></div>

  <div class="carte-plane barre-filtres" role="search" aria-label="Filtres">
    <div class="champ">
      <label for="q">Recherche</label>
      <input type="text" id="q" placeholder="Ville, rue, gare...">
    </div>
    <div class="champ">
      <label for="commune">Commune</label>
      <select id="commune"><option value="*">Toutes</option></select>
    </div>
    <div class="champ">
      <label for="source">Portail</label>
      <select id="source"><option value="*">Tous</option></select>
    </div>
    <div class="champ">
      <label for="prixMax">Prix max (€)</label>
      <input type="number" id="prixMax" placeholder="500000" step="10000">
    </div>
    <div class="champ">
      <label for="prixM2Max">Prix/m² max</label>
      <input type="number" id="prixM2Max" placeholder="3000" step="100">
    </div>
    <div class="champ">
      <label for="chMin">Chambres min</label>
      <select id="chMin"><option value="0">Toutes</option><option value="2">2+</option><option value="3">3+</option><option value="4">4+</option><option value="5">5+</option></select>
    </div>
    <div class="champ">
      <label for="gareMax">Gare &lt; (km)</label>
      <input type="number" id="gareMax" placeholder="5" step="0.5">
    </div>
    <div class="champ">
      <label for="tri">Trier par</label>
      <select id="tri">
        <option value="score">Score décroissant</option>
        <option value="prixM2">Prix/m² croissant</option>
        <option value="prix">Prix croissant</option>
        <option value="gare">Distance gare croissante</option>
        <option value="surface">Surface décroissante</option>
        <option value="recent">Plus récents d'abord</option>
      </select>
    </div>
    <label class="case"><input type="checkbox" id="favOnly"> Favoris seulement</label>
    <label class="case"><input type="checkbox" id="masquerOptions" checked> Masquer les biens sous option</label>
    <label class="case"><input type="checkbox" id="prixConnuSeulement" checked> Prix connu uniquement</label>
    <label class="case"><input type="checkbox" id="masquerIncertains"> Masquer les données incertaines</label>
    <label class="case"><input type="checkbox" id="nouveautesSeulement"> Nouveautés seulement</label>
    <button id="btnReset">Réinitialiser</button>
  </div>

  <details class="carte-plane panneau-poids" id="panneauPoids">
    <summary>Pondérations du score</summary>
    <p class="aide">
      Le score est une moyenne pondérée de critères normalisés sur 100. <strong>Un critère dont la donnée
      manque est exclu du calcul</strong> et la carte indique alors sur quelle part des critères le score
      repose — deux biens n'ont pas forcément un score comparable.
    </p>
    <div class="grille-poids" id="grillePoids"></div>
    <div class="actions-poids">
      <button id="btnPoidsDefaut">Valeurs par défaut</button>
      <button id="btnPoidsGare">Priorité train</button>
      <button id="btnPoidsPrix">Priorité prix</button>
      <button id="btnPoidsEspace">Priorité espace</button>
    </div>
  </details>

  <details class="carte-plane bloc-graphe" id="blocCommunes" open>
    <summary id="titreCommunes">Biens par commune</summary>
    <p class="legende-bloc">Sur la sélection courante. Clique une commune pour filtrer.</p>
    <div class="barres" id="barresCommunes"></div>
    <div class="axe" id="axeCommunes"></div>
  </details>

  <details class="carte-plane bloc-graphe" id="blocDisparus">
    <summary id="titreDisparus">Récemment disparus</summary>
    <p class="legende-bloc">Absents du dernier scrape depuis au moins quelques jours (probablement vendus ou retirés) — le lien peut ne plus fonctionner.</p>
    <div id="listeDisparus" class="liste-disparus"></div>
  </details>

  <div id="grille" class="grille"></div>

  <div id="blocCarte" class="carte-plane" hidden>
    <div class="carte-entete">
      <p class="titre-bloc">Localisation des biens</p>
      <p class="legende-bloc">
        Les autoroutes et les voies ferrées viennent du fond de carte OpenStreetMap (autoroutes en orange, avec leurs écussons E19, E40, E411…).
        Les gares et les accès autoroute qui servent au score sont superposés — leurs noms apparaissent en zoomant, ou au survol.
      </p>
    </div>
    <div id="carte"></div>
    <div class="carte-pied">
      <div class="legende">
        <span class="legende-item"><span class="puce puce-bien"></span> Bien (position exacte)</span>
        <span class="legende-item"><span class="puce puce-approx"></span> Position au centre de la commune</span>
        <span class="legende-item"><span class="puce puce-gare"></span> Gare</span>
        <span class="legende-item"><span class="puce puce-route"></span> Accès autoroute</span>
        <span class="legende-item">
          Score :
          <span class="rampe" aria-hidden="true">
            <span style="background:#86b6ef"></span><span style="background:#5598e7"></span><span style="background:#2a78d6"></span><span style="background:#1c5cab"></span><span style="background:#0d366b"></span>
          </span>
          faible → élevé
        </span>
      </div>
      <button id="btnRecadrer">Recadrer sur la sélection</button>
    </div>
  </div>

  <div id="vueTableau" class="carte-plane tableau-conteneur" hidden>
    <table>
      <caption class="vide" style="padding:12px; text-align:left; color:var(--text-secondary);">
        Mêmes données que les cartes, sous forme de tableau.
      </caption>
      <thead><tr>
        <th class="num">Score</th><th>Commune</th><th>Titre</th>
        <th class="num">Prix</th><th class="num">€/m²</th><th class="num">Ch.</th>
        <th class="num">Hab.</th><th class="num">Terrain</th><th>Gare</th><th class="num">km</th>
        <th>PEB</th><th>Statut</th><th>Portail</th><th>Lien</th>
      </tr></thead>
      <tbody id="corpsTableau"></tbody>
    </table>
  </div>

</div>

<script>
const ANNONCES = ${JSON.stringify(annonces)};
const DISPARUS = ${JSON.stringify(disparus)};
const GARES = ${JSON.stringify(GARES)};
const ACCES_AUTOROUTE = ${JSON.stringify(ACCES_AUTOROUTE)};

/* ------------------------------------------------------------
   Critères de score : mesure brute → note 0-100 par interpolation
   ------------------------------------------------------------ */
const CRITERES = {
  gare:      { label: 'Accès gare',        defaut: 40, valeur: a => a.distanceGareKm,       echelle: [[0.8,100],[2,85],[3.5,70],[6,45],[10,15],[20,0]] },
  prixM2:    { label: 'Prix au m²',        defaut: 20, valeur: a => a.prixM2,               echelle: [[1800,100],[2400,85],[3000,60],[3600,35],[4500,10],[6000,0]] },
  chambres:  { label: 'Chambres',          defaut: 10, valeur: a => a.chambres,             echelle: [[2,35],[3,70],[4,90],[5,100]] },
  surface:   { label: 'Surface habitable', defaut: 10, valeur: a => a.surfaceHabitable,     echelle: [[90,10],[120,40],[150,70],[200,90],[280,100]] },
  bruxelles: { label: 'Proximité Bruxelles', defaut: 10, valeur: a => a.distanceBruxellesKm, echelle: [[8,100],[15,80],[22,55],[30,25],[45,0]] },
  autoroute: { label: 'Accès autoroute',   defaut: 5,  valeur: a => a.distanceRouteKm,      echelle: [[2,100],[4,80],[7,50],[12,15],[20,0]] },
  terrain:   { label: 'Terrain',           defaut: 5,  valeur: a => a.surfaceTerrain,       echelle: [[0,0],[150,30],[400,65],[800,90],[1500,100]] },
};

const PRESETS = {
  defaut:  Object.fromEntries(Object.entries(CRITERES).map(([k, c]) => [k, c.defaut])),
  gare:    { gare: 60, prixM2: 10, chambres: 5,  surface: 5,  bruxelles: 15, autoroute: 5,  terrain: 0 },
  prix:    { gare: 20, prixM2: 45, chambres: 10, surface: 15, bruxelles: 5,  autoroute: 5,  terrain: 0 },
  espace:  { gare: 20, prixM2: 15, chambres: 20, surface: 25, bruxelles: 0,  autoroute: 5,  terrain: 15 },
};

/** Interpolation linéaire par paliers, bornée aux extrémités. */
function interpoler(x, echelle) {
  if (x <= echelle[0][0]) return echelle[0][1];
  const dernier = echelle[echelle.length - 1];
  if (x >= dernier[0]) return dernier[1];
  for (let i = 0; i < echelle.length - 1; i++) {
    const [x0, y0] = echelle[i], [x1, y1] = echelle[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return dernier[1];
}

/**
 * Score = moyenne pondérée des critères DISPONIBLES.
 * La fiabilité = part du poids demandé qui a effectivement pu être calculée.
 */
function scorer(a, poids) {
  let somme = 0, poidsDispo = 0, poidsDemande = 0;
  const manquants = [];
  for (const [cle, crit] of Object.entries(CRITERES)) {
    const p = poids[cle] ?? 0;
    if (p <= 0) continue;
    poidsDemande += p;
    const v = crit.valeur(a);
    if (v == null || Number.isNaN(v)) { manquants.push(crit.label); continue; }
    somme += p * interpoler(v, crit.echelle);
    poidsDispo += p;
  }
  if (poidsDispo === 0) return { score: null, fiabilite: 0, manquants };
  return {
    score: Math.round(somme / poidsDispo),
    fiabilite: Math.round((poidsDispo / poidsDemande) * 100),
    manquants,
  };
}

/* ------------------------------------------------------------
   État
   ------------------------------------------------------------ */
const lire = (cle, defaut) => { try { return JSON.parse(localStorage.getItem(cle)) ?? defaut; } catch { return defaut; } };
const ecrire = (cle, val) => { try { localStorage.setItem(cle, JSON.stringify(val)); } catch { /* stockage indisponible */ } };

let poids = { ...PRESETS.defaut, ...lire('immo_poids', {}) };
let favoris = lire('immo_favoris', []);
let vue = 'cartes'; // 'cartes' | 'carte' | 'tableau'

const $ = (id) => document.getElementById(id);
const euro = (n) => n == null ? '—' : n.toLocaleString('fr-BE') + ' €';
const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mediane = (xs) => { const v = xs.filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

/* ------------------------------------------------------------
   Pondérations : construction des sliders
   ------------------------------------------------------------ */
$('grillePoids').innerHTML = Object.entries(CRITERES).map(([cle, c]) => \`
  <div class="poids-ligne">
    <span class="nom"><label for="poids-\${cle}">\${c.label}</label></span>
    <span class="val" id="val-\${cle}">\${poids[cle]}</span>
    <input type="range" id="poids-\${cle}" min="0" max="60" step="5" value="\${poids[cle]}" aria-label="Poids : \${c.label}">
  </div>\`).join('');

for (const cle of Object.keys(CRITERES)) {
  $('poids-' + cle).addEventListener('input', (e) => {
    poids[cle] = parseInt(e.target.value, 10);
    $('val-' + cle).textContent = poids[cle];
    ecrire('immo_poids', poids);
    rendre();
  });
}

function appliquerPreset(p) {
  poids = { ...p };
  for (const cle of Object.keys(CRITERES)) {
    $('poids-' + cle).value = poids[cle] ?? 0;
    $('val-' + cle).textContent = poids[cle] ?? 0;
  }
  ecrire('immo_poids', poids);
  rendre();
}
$('btnPoidsDefaut').onclick = () => appliquerPreset(PRESETS.defaut);
$('btnPoidsGare').onclick   = () => appliquerPreset(PRESETS.gare);
$('btnPoidsPrix').onclick   = () => appliquerPreset(PRESETS.prix);
$('btnPoidsEspace').onclick = () => appliquerPreset(PRESETS.espace);

/* ------------------------------------------------------------
   Favoris, thème, vue
   ------------------------------------------------------------ */
function basculerFavori(lien) {
  favoris = favoris.includes(lien) ? favoris.filter(l => l !== lien) : [...favoris, lien];
  ecrire('immo_favoris', favoris);
  rendre();
}

$('btnTheme').onclick = () => {
  const actuel = document.documentElement.getAttribute('data-theme');
  const sombreSysteme = matchMedia('(prefers-color-scheme: dark)').matches;
  const suivant = actuel ? (actuel === 'dark' ? 'light' : 'dark') : (sombreSysteme ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', suivant);
  ecrire('immo_theme', suivant);
};
const themeMemorise = lire('immo_theme', null);
if (themeMemorise) document.documentElement.setAttribute('data-theme', themeMemorise);

const BOUTONS_VUE = { cartes: 'vueCartes', carte: 'vueCarte', tableau: 'vueTable' };
function choisirVue(v) {
  vue = v;
  for (const [nom, id] of Object.entries(BOUTONS_VUE)) $(id).setAttribute('aria-pressed', String(nom === v));
  ecrire('immo_vue', v);
  rendre();
}
for (const [nom, id] of Object.entries(BOUTONS_VUE)) $(id).onclick = () => choisirVue(nom);
// Bloc « Biens par commune » repliable, état mémorisé.
$('blocCommunes').open = lire('immo_communes_ouvert', true);
$('blocCommunes').addEventListener('toggle', () => ecrire('immo_communes_ouvert', $('blocCommunes').open));

// « Récemment disparus » : replié par défaut (info secondaire), état mémorisé.
$('blocDisparus').open = lire('immo_disparus_ouvert', false);
$('blocDisparus').addEventListener('toggle', () => ecrire('immo_disparus_ouvert', $('blocDisparus').open));

const vueMemorisee = lire('immo_vue', null);
if (vueMemorisee && BOUTONS_VUE[vueMemorisee]) vue = vueMemorisee;
// Reflète la vue mémorisée sur les boutons dès le chargement.
for (const [nom, id] of Object.entries(BOUTONS_VUE)) $(id).setAttribute('aria-pressed', String(nom === vue));

/* ------------------------------------------------------------
   CARTE
   ------------------------------------------------------------ */

// Rampe séquentielle bleue : le score est une magnitude, pas un état.
// Plus foncé = meilleur score.
function couleurScore(score) {
  if (score == null) return '#b7b7b2';
  if (score < 40) return '#86b6ef';
  if (score < 55) return '#5598e7';
  if (score < 70) return '#2a78d6';
  if (score < 85) return '#1c5cab';
  return '#0d366b';
}

let carte = null;
let coucheBiens = null;
let coucheRayons = null;
let dernierCadrage = '';

function initCarte() {
  if (carte) return;

  carte = L.map('carte', { scrollWheelZoom: true, zoomControl: true }).setView([50.76, 4.36], 10);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(carte);

  // --- Gares : carré orange + libellé permanent ---
  const coucheGares = L.layerGroup();
  for (const g of GARES) {
    L.marker([g.lat, g.lon], {
      // Attribut title sur la pastille : le nom reste accessible au survol
      // même quand l'étiquette permanente est masquée par le zoom.
      icon: L.divIcon({ className: '', html: \`<div class="pastille pastille-gare" title="Gare de \${echapper(g.nom)}"></div>\`, iconSize: [14, 14], iconAnchor: [7, 7] }),
      keyboard: false,
    })
      .bindTooltip(g.nom, { permanent: true, direction: 'right', offset: [8, 0], className: 'etiquette-gare' })
      .addTo(coucheGares);
  }
  coucheGares.addTo(carte);

  // --- Accès autoroute : triangle aqua + libellé permanent ---
  const coucheRoutes = L.layerGroup();
  for (const r of ACCES_AUTOROUTE) {
    L.marker([r.lat, r.lon], {
      icon: L.divIcon({ className: '', html: \`<div class="pastille pastille-route" title="Accès autoroute \${echapper(r.nom)}"></div>\`, iconSize: [14, 12], iconAnchor: [7, 6] }),
      keyboard: false,
    })
      .bindTooltip(r.nom, { permanent: true, direction: 'top', offset: [0, -6], className: 'etiquette-route' })
      .addTo(coucheRoutes);
  }
  coucheRoutes.addTo(carte);

  // --- Rayon de 2 km autour des gares (désactivé par défaut) ---
  coucheRayons = L.layerGroup();
  for (const g of GARES) {
    L.circle([g.lat, g.lon], { radius: 2000, color: '#eb6834', weight: 1, opacity: 0.5, fillColor: '#eb6834', fillOpacity: 0.06 }).addTo(coucheRayons);
  }

  coucheBiens = L.layerGroup().addTo(carte);

  L.control
    .layers(null, {
      'Biens': coucheBiens,
      'Gares': coucheGares,
      'Accès autoroute': coucheRoutes,
      'Rayon 2 km autour des gares': coucheRayons,
    }, { collapsed: false })
    .addTo(carte);

  // Les 41 libellés permanents (29 gares + 12 accès) se chevauchent et
  // couvrent toute la région bruxelloise vus de loin. On ne les affiche qu'à
  // partir du zoom 11, là où il y a la place ; en dessous, les marqueurs
  // restent visibles et leur nom s'affiche au survol.
  const majZoom = () => $('carte').classList.toggle('zoom-faible', carte.getZoom() < 11);
  carte.on('zoomend', majZoom);
  majZoom();

  // Exposée pour pouvoir piloter la carte depuis la console du navigateur
  // (carteImmo.setView([lat, lon], zoom)) et pour les tests automatisés.
  window.carteImmo = carte;
}

function popupHtml(a, note) {
  const approx = a.precisionGeo === 'localite';
  return \`
    \${a.imageUrl ? \`<img class="popup-img" src="\${echapper(a.imageUrl)}" alt="" loading="lazy" onerror="this.remove()">\` : ''}
    <p class="popup-titre">\${echapper(a.titre)}</p>
    <p class="popup-lieu">\${echapper(a.rue ? a.rue + ', ' : '')}\${echapper(a.cp ?? '')} \${echapper(a.ville ?? a.commune ?? '')}</p>
    <div><span class="popup-prix">\${euro(a.prix)}</span>\${a.prixM2 ? \`<span class="popup-m2">\${a.prixM2.toLocaleString('fr-BE')} €/m²</span>\` : ''}</div>
    <p class="popup-faits">
      \${[a.chambres ? a.chambres + ' ch.' : null, a.surfaceHabitable ? a.surfaceHabitable + ' m²' : null, a.peb ? 'PEB ' + echapper(a.peb) : null].filter(Boolean).join(' · ')}
    </p>
    <p class="popup-faits">Score \${note.score ?? '—'}/100\${a.gareNom ? \` · \${echapper(a.gareNom)} à \${a.distanceGareKm} km\` : ''}</p>
    \${approx ? '<p class="popup-note">Position approximative : centre de la commune, adresse non publiée.</p>' : ''}
    <a class="popup-lien" href="\${echapper(a.lien)}" target="_blank" rel="noopener">Voir l\\'annonce →</a>\`;
}

function dessinerBiens(liste, notes) {
  if (!carte) return;
  coucheBiens.clearLayers();

  const points = [];
  for (const a of liste) {
    const c = a.coordsAffichage ?? a.coords;
    if (!c) continue;
    points.push([c.lat, c.lon]);

    const note = notes.get(a.lien) ?? { score: null };
    const estFav = favoris.includes(a.lien);
    const approx = a.precisionGeo === 'localite';

    L.circleMarker([c.lat, c.lon], {
      radius: estFav ? 10 : 7,
      // Anneau de la couleur du fond : c'est le séparateur des marqueurs qui
      // se chevauchent, à la place d'un contour sombre.
      color: estFav ? '#0b0b0b' : '#ffffff',
      weight: estFav ? 3 : 2,
      // Trait discontinu = position au centre de la commune, pas une adresse.
      dashArray: approx ? '3,2' : null,
      fillColor: couleurScore(note.score),
      fillOpacity: approx ? 0.75 : 1,
    })
      .bindPopup(popupHtml(a, note), { maxWidth: 260 })
      .bindTooltip(\`\${echapper(a.commune ?? '')} — \${euro(a.prix)}\`, { direction: 'top' })
      .addTo(coucheBiens);
  }

  // On ne recadre que si la sélection a changé, pour ne pas remettre la vue à
  // zéro à chaque frappe dans les filtres.
  const signature = \`\${points.length}|\${$('commune').value}|\${$('source').value}\`;
  if (points.length && signature !== dernierCadrage) {
    dernierCadrage = signature;
    carte.fitBounds(points, { padding: [40, 40], maxZoom: 13 });
  }
}

function recadrer() {
  dernierCadrage = '';
  rendre();
}
$('btnRecadrer').onclick = recadrer;

/* ------------------------------------------------------------
   Remplissage des listes déroulantes
   ------------------------------------------------------------ */
const sources = [...new Set(ANNONCES.flatMap(a => a.sources ?? [a.source]))].filter(Boolean).sort();
$('source').innerHTML = '<option value="*">Tous</option>' + sources.map(s => \`<option value="\${echapper(s)}">\${echapper(s)}</option>\`).join('');

/* ------------------------------------------------------------
   Filtrage
   ------------------------------------------------------------ */
function filtrer(ignorerCommune = false) {
  const q = $('q').value.trim().toLowerCase();
  const commune = $('commune').value;
  const source = $('source').value;
  const prixMax = parseInt($('prixMax').value, 10) || Infinity;
  const prixM2Max = parseInt($('prixM2Max').value, 10) || Infinity;
  const chMin = parseInt($('chMin').value, 10) || 0;
  const gareMax = parseFloat($('gareMax').value) || Infinity;
  const favOnly = $('favOnly').checked;
  const masquerOptions = $('masquerOptions').checked;
  const prixConnuSeulement = $('prixConnuSeulement').checked;
  const masquerIncertains = $('masquerIncertains').checked;
  const nouveautesSeulement = $('nouveautesSeulement').checked;

  return ANNONCES.filter(a => {
    if (favOnly && !favoris.includes(a.lien)) return false;
    if (masquerOptions && a.statut !== 'disponible') return false;
    // Certains portails (Trior sous option, notamment) n'affichent aucun prix
    // sur une bonne partie de leurs biens : ce filtre les écarte sans se
    // confondre avec "masquerIncertains", plus large (surface, chambres...).
    if (prixConnuSeulement && a.prix == null) return false;
    if (nouveautesSeulement && !a.nouveau) return false;
    if (!ignorerCommune && commune !== '*' && a.commune !== commune) return false;
    if (source !== '*' && !(a.sources ?? [a.source]).includes(source)) return false;
    if (masquerIncertains && a.champsManquants?.length) return false;

    if (q) {
      const foin = [a.titre, a.adresse, a.ville, a.commune, a.gareNom, a.rue].join(' ').toLowerCase();
      if (!foin.includes(q)) return false;
    }
    // Une donnée manquante ne doit pas faire disparaître l'annonce d'un filtre
    // numérique : on ne l'exclut que si la valeur est connue ET hors critère.
    if (a.prix != null && a.prix > prixMax) return false;
    if (a.prixM2 != null && a.prixM2 > prixM2Max) return false;
    if (a.chambres != null && a.chambres < chMin) return false;
    if (a.distanceGareKm != null && a.distanceGareKm > gareMax) return false;
    return true;
  });
}

function trier(liste, notes) {
  const cle = $('tri').value;
  const copie = [...liste];
  const inf = (v) => v == null ? Infinity : v;
  if (cle === 'score')   copie.sort((a, b) => (notes.get(b.lien)?.score ?? -1) - (notes.get(a.lien)?.score ?? -1));
  if (cle === 'prixM2')  copie.sort((a, b) => inf(a.prixM2) - inf(b.prixM2));
  if (cle === 'prix')    copie.sort((a, b) => inf(a.prix) - inf(b.prix));
  if (cle === 'gare')    copie.sort((a, b) => inf(a.distanceGareKm) - inf(b.distanceGareKm));
  if (cle === 'surface') copie.sort((a, b) => (b.surfaceHabitable ?? -1) - (a.surfaceHabitable ?? -1));
  // Biens sans date connue (vus avant la mise en place du suivi, ou premier
  // run) : repli sur l'époque Unix (1970), la plus ancienne possible, pour
  // qu'ils se retrouvent en fin de liste plutôt qu'en tête d'un tri décroissant.
  if (cle === 'recent') copie.sort((a, b) => new Date(b.premiereFoisVu ?? 0) - new Date(a.premiereFoisVu ?? 0));
  return copie;
}

/* ------------------------------------------------------------
   Rendu
   ------------------------------------------------------------ */
const formaterDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-BE') : '');

function badgesDe(a, note) {
  const out = [];
  // Nouveau et baisse de prix viennent de historique.json (voir lib/historique.mjs) :
  // absents au tout premier run, faute de scrape antérieur pour comparer.
  if (a.nouveau) out.push('<span class="badge bon">🆕 Nouveau</span>');
  if (a.baisseDePrix) {
    const delta = a.baisseDePrix.ancienPrix - a.baisseDePrix.nouveauPrix;
    out.push(\`<span class="badge bon" title="\${a.baisseDePrix.ancienPrix.toLocaleString('fr-BE')} € → \${a.baisseDePrix.nouveauPrix.toLocaleString('fr-BE')} € depuis le \${formaterDate(a.baisseDePrix.depuis)}">📉 -\${delta.toLocaleString('fr-BE')} €</span>\`);
  }
  // Signalé par Immovlan : le prix a bougé depuis la mise en ligne.
  if (a.prixModifie) out.push('<span class="badge info" title="Le portail signale un changement de prix depuis la mise en ligne">📉 Prix modifié</span>');
  // Prix de départ d'un projet neuf : le montant affiché n'est pas ferme.
  if (a.prixAPartirDe) out.push('<span class="badge incertain" title="Prix « à partir de » : montant de départ, pas un prix ferme">◍ Prix de départ</span>');
  // Trior (appartements neufs) : le montant exclut des frais, pas comparable tel quel.
  if (a.prixHorsFrais) out.push('<span class="badge incertain" title="Prix hors frais (agence ou notaire) : non comparable tel quel">◍ Hors frais</span>');
  // Rente viagère (Immoweb) : le montant affiché n'est que le bouquet initial,
  // pas le coût réel (bouquet + mensualité jusqu'au décès du vendeur).
  if (a.venteViagere) out.push('<span class="badge incertain" title="Vente en rente viagère : prix affiché = bouquet initial uniquement, hors mensualité">◍ Rente viagère</span>');
  if (a.statut === 'option') out.push('<span class="badge avertissement">⏳ Sous option</span>');
  if (a.statut === 'reserve') out.push('<span class="badge avertissement">⏳ Réservé</span>');
  // Une annonce ancienne signale une marge de négociation.
  if (a.joursEnLigne != null && a.joursEnLigne >= 120) out.push(\`<span class="badge info" title="En ligne depuis longtemps : marge de négociation probable">📅 \${a.joursEnLigne} j en ligne</span>\`);
  if (a.multiSource) out.push(\`<span class="badge info" title="Publié sur plusieurs portails">🔗 \${a.sources.length} portails</span>\`);
  // Mêmes chiffres qu'une autre annonce du même portail : soit un doublon,
  // soit deux lots d'un même projet neuf. On ne tranche pas, on prévient.
  if (a.doublonPotentiel?.length) out.push(\`<span class="badge info" title="Caractéristiques identiques à \${a.doublonPotentiel.length} autre(s) annonce(s) du même portail : doublon ou lots d'un même projet">⧉ Annonce jumelle</span>\`);
  if (a.auDessusDuBudget) out.push('<span class="badge avertissement">⚠️ Au-dessus du budget</span>');
  if (a.champsManquants?.includes('surfacesAmbigues')) out.push('<span class="badge incertain">◍ Surface incertaine</span>');
  if (a.champsManquants?.includes('prix')) out.push('<span class="badge incertain">◍ Prix non lu</span>');
  if (a.precisionGeo === 'localite') out.push('<span class="badge info" title="Distance mesurée depuis le centre de la localité, pas l\\'adresse exacte">◎ Position approx.</span>');
  if (a.peb) out.push(\`<span class="badge \${/^[AB]/.test(a.peb) ? 'bon' : 'info'}">PEB \${echapper(a.peb)}</span>\`);
  return out.join('');
}

function carteBien(a, note) {
  const estFav = favoris.includes(a.lien);
  const score = note.score;
  return \`
  <article class="bien">
    <div class="photo">
      \${a.imageUrl ? \`<img src="\${echapper(a.imageUrl)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=&quot;absente&quot;>Photo indisponible</div>'">\` : '<div class="absente">Pas de photo</div>'}
      <button class="fav" onclick="basculerFavori('\${echapper(a.lien)}')" aria-label="\${estFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-pressed="\${estFav}">\${estFav ? '★' : '☆'}</button>
    </div>
    <div class="corps">
      <div class="jauge-bloc">
        <span class="jauge-label">Score</span>
        <span class="jauge-valeur">\${score == null ? '—' : score + '/100'}</span>
        <span class="jauge"><span style="width:\${score ?? 0}%"></span></span>
        \${note.fiabilite < 100 ? \`<span class="fiabilite">Calculé sur \${note.fiabilite} % des critères pondérés\${note.manquants.length ? ' — manque : ' + note.manquants.join(', ').toLowerCase() : ''}</span>\` : ''}
      </div>

      <div>
        <h3>\${echapper(a.titre)}</h3>
        <p class="lieu">\${echapper(a.rue ? a.rue + ', ' : '')}\${echapper(a.cp ?? '')} \${echapper(a.ville ?? a.commune ?? '')}</p>
      </div>

      <div class="prix-ligne">
        <span class="prix">\${euro(a.prix)}</span>
        \${a.prixM2 ? \`<span class="prix-m2">\${a.prixM2.toLocaleString('fr-BE')} €/m²</span>\` : ''}
      </div>

      <div class="faits">
        \${a.chambres ? \`<span class="fait">\${a.chambres} ch.</span>\` : ''}
        \${a.sallesDeBain ? \`<span class="fait">\${a.sallesDeBain} sdb</span>\` : ''}
        \${a.surfaceHabitable ? \`<span class="fait">\${a.surfaceHabitable} m² hab.</span>\` : ''}
        \${a.surfaceTerrain ? \`<span class="fait">\${a.surfaceTerrain} m² terrain</span>\` : ''}
        \${a.surfaceConstructible ? \`<span class="fait" title="Emprise bâtissable — ni la surface habitable ni le jardin">\${a.surfaceConstructible} m² constructible</span>\` : ''}
        \${a.typeBien ? \`<span class="fait">\${echapper(a.typeBien)}</span>\` : ''}
        \${a.joursEnLigne != null ? \`<span class="fait">\${a.joursEnLigne} j en ligne</span>\` : ''}
      </div>

      \${a.gareNom ? \`<div class="trajets">
        <span>Gare : \${echapper(a.gareNom)} — \${a.distanceGareKm} km</span>
        \${a.routeNom ? \`<span>Autoroute : \${echapper(a.routeNom)} — \${a.distanceRouteKm} km</span>\` : ''}
        \${a.distanceBruxellesKm != null ? \`<span>Bruxelles-Central : \${a.distanceBruxellesKm} km</span>\` : ''}
      </div>\` : '<div class="trajets"><span>Position non géolocalisée</span></div>'}

      <div class="badges">\${badgesDe(a, note)}</div>
    </div>
    <div class="pied">
      <span>\${echapper((a.sources ?? [a.source]).join(' · '))}</span>
      <a href="\${echapper(a.lien)}" target="_blank" rel="noopener">Voir l'annonce →</a>
    </div>
  </article>\`;
}

function ligneTableau(a, note) {
  return \`<tr>
    <td class="num">\${note.score ?? '—'}\${note.fiabilite < 100 ? ' *' : ''}</td>
    <td>\${echapper(a.commune ?? '—')}</td>
    <td>\${echapper(a.titre)}</td>
    <td class="num">\${a.prix == null ? '—' : a.prix.toLocaleString('fr-BE')}</td>
    <td class="num">\${a.prixM2 ?? '—'}</td>
    <td class="num">\${a.chambres ?? '—'}</td>
    <td class="num">\${a.surfaceHabitable ?? '—'}</td>
    <td class="num">\${a.surfaceTerrain ?? '—'}</td>
    <td>\${echapper(a.gareNom ?? '—')}</td>
    <td class="num">\${a.distanceGareKm ?? '—'}</td>
    <td>\${echapper(a.peb ?? '—')}</td>
    <td>\${a.statut === 'disponible' ? '—' : echapper(a.statut)}\${a.joursEnLigne != null ? ' · ' + a.joursEnLigne + ' j' : ''}</td>
    <td>\${echapper((a.sources ?? [a.source]).join(' · '))}</td>
    <td><a href="\${echapper(a.lien)}" target="_blank" rel="noopener">ouvrir</a></td>
  </tr>\`;
}

function rendreKpis(liste) {
  const prixMed = mediane(liste.map(a => a.prix));
  const m2Med = mediane(liste.map(a => a.prixM2));
  const gareMed = mediane(liste.map(a => a.distanceGareKm));
  const incertains = liste.filter(a => a.champsManquants?.length).length;
  const nouveaux = liste.filter(a => a.nouveau).length;
  const baisses = liste.filter(a => a.baisseDePrix).length;

  $('kpis').innerHTML = \`
    <div class="kpi hero">
      <div class="kpi-label">Biens retenus</div>
      <div class="kpi-valeur">\${liste.length}</div>
      <div class="kpi-note">sur \${ANNONCES.length} au total</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Prix médian</div>
      <div class="kpi-valeur">\${prixMed == null ? '—' : Math.round(prixMed / 1000) + 'k €'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Prix/m² médian</div>
      <div class="kpi-valeur">\${m2Med == null ? '—' : m2Med.toLocaleString('fr-BE')} €</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Distance gare médiane</div>
      <div class="kpi-valeur">\${gareMed == null ? '—' : gareMed + ' km'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Données incomplètes</div>
      <div class="kpi-valeur">\${incertains}</div>
      <div class="kpi-note">\${incertains ? 'score partiel sur ces biens' : 'tous les champs lus'}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Favoris</div>
      <div class="kpi-valeur">\${favoris.length}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Nouveautés</div>
      <div class="kpi-valeur">\${nouveaux}</div>
      <div class="kpi-note">depuis le dernier scrape</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Baisses de prix</div>
      <div class="kpi-valeur">\${baisses}</div>
    </div>\`;
}

function rendreCommunes(listeSansCommune) {
  const comptes = {};
  for (const a of listeSansCommune) {
    const c = a.commune ?? 'Inconnue';
    comptes[c] = (comptes[c] ?? 0) + 1;
  }
  const entrees = Object.entries(comptes).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entrees.map(e => e[1]));
  const actuelle = $('commune').value;

  // Le <select> et le graphique lisent le même décompte
  $('commune').innerHTML = \`<option value="*">Toutes (\${listeSansCommune.length})</option>\`
    + entrees.map(([c, n]) => \`<option value="\${echapper(c)}"\${c === actuelle ? ' selected' : ''}>\${echapper(c)} (\${n})</option>\`).join('');
  if (actuelle !== '*' && !comptes[actuelle]) $('commune').value = '*';

  $('barresCommunes').innerHTML = entrees.map(([c, n]) => \`
    <button class="barre-ligne" onclick="filtrerCommune('\${echapper(c)}')" title="\${echapper(c)} : \${n} bien(s) — cliquer pour filtrer">
      <span class="nom">\${echapper(c)}</span>
      <span class="piste"><span class="barre" style="width:\${Math.max((n / max) * 100, 2)}%"></span></span>
      <span class="compte">\${n}</span>
    </button>\`).join('');

  // Le décompte reste visible une fois le bloc replié.
  $('titreCommunes').textContent = \`Biens par commune (\${entrees.length})\`;

  $('axeCommunes').innerHTML = \`<span>0</span><span>\${max} bien\${max > 1 ? 's' : ''}</span>\`;
  // Masqué en vue carte : deux lectures géographiques côte à côte se
  // concurrencent, et ses 19 barres repoussaient la carte hors de l'écran.
  $('blocCommunes').hidden = entrees.length < 2 || vue === 'carte';
}

function filtrerCommune(c) {
  $('commune').value = $('commune').value === c ? '*' : c;
  rendre();
}

function rendre() {
  // Le graphique et le <select> des communes ignorent le filtre de commune,
  // sinon sélectionner une commune ferait disparaître toutes les autres barres.
  rendreCommunes(filtrer(true));

  const liste = filtrer();
  const notes = new Map(liste.map(a => [a.lien, scorer(a, poids)]));
  const triee = trier(liste, notes);

  rendreKpis(liste);

  $('grille').hidden = vue !== 'cartes';
  $('blocCarte').hidden = vue !== 'carte';
  $('vueTableau').hidden = vue !== 'tableau';

  if (vue === 'carte') {
    initCarte();
    // Leaflet mesure son conteneur à l'initialisation : caché, il se croit de
    // taille nulle et n'affiche qu'une tuile. invalidateSize() le recalcule
    // après l'affichage.
    requestAnimationFrame(() => carte.invalidateSize());
    dessinerBiens(triee, notes);
  }

  if (!triee.length) {
    $('grille').innerHTML = '<div class="vide">Aucun bien ne correspond à ces filtres.</div>';
    $('corpsTableau').innerHTML = '<tr><td colspan="14" class="vide">Aucun bien ne correspond à ces filtres.</td></tr>';
    return;
  }
  $('grille').innerHTML = triee.map(a => carteBien(a, notes.get(a.lien))).join('');
  $('corpsTableau').innerHTML = triee.map(a => ligneTableau(a, notes.get(a.lien))).join('');
}

/* ------------------------------------------------------------
   Écoute des filtres
   ------------------------------------------------------------ */
for (const id of ['q', 'commune', 'source', 'prixMax', 'prixM2Max', 'chMin', 'gareMax', 'tri', 'favOnly', 'masquerOptions', 'prixConnuSeulement', 'masquerIncertains', 'nouveautesSeulement']) {
  $(id).addEventListener('input', rendre);
  $(id).addEventListener('change', rendre);
}
$('btnReset').onclick = () => {
  for (const id of ['q', 'prixMax', 'prixM2Max', 'gareMax']) $(id).value = '';
  $('commune').value = '*'; $('source').value = '*'; $('chMin').value = '0'; $('tri').value = 'score';
  // "Masquer les biens sous option" et "Prix connu uniquement" sont cochées
  // par défaut : le réinitialiser doit y revenir, pas les décocher.
  $('favOnly').checked = false; $('masquerOptions').checked = true; $('prixConnuSeulement').checked = true; $('masquerIncertains').checked = false; $('nouveautesSeulement').checked = false;
  rendre();
};

/* ------------------------------------------------------------
   Récemment disparus : liste statique, indépendante des filtres de la
   grille principale (secondaire, généralement courte).
   ------------------------------------------------------------ */
function rendreDisparus() {
  $('blocDisparus').hidden = DISPARUS.length === 0;
  if (!DISPARUS.length) return;

  $('titreDisparus').textContent = \`Récemment disparus (\${DISPARUS.length})\`;

  const tries = [...DISPARUS].sort((a, b) => b.joursAbsence - a.joursAbsence);
  $('listeDisparus').innerHTML = tries.map(d => \`
    <div class="ligne-disparu">
      <span class="titre">\${echapper(d.titre)} <span class="lieu">— \${echapper(d.commune ?? '?')}</span></span>
      <span class="prix">\${euro(d.prixActuel)}</span>
      <span class="depuis">disparu depuis \${d.joursAbsence} j</span>
      \${d.lien ? \`<a href="\${echapper(d.lien)}" target="_blank" rel="noopener">Voir →</a>\` : '<span></span>'}
    </div>\`).join('');
}
rendreDisparus();

rendre();
</script>
</body>
</html>`;

fs.writeFileSync(FICHIERS.dashboard, html);

const poidsTotal = 100;
console.log(`\n✅ ${FICHIERS.dashboard} généré (${annonces.length} biens, ${(html.length / 1024).toFixed(0)} Ko)`);
console.log(`   Score réglable dans le dashboard (pondérations par défaut = ${poidsTotal} points répartis sur 7 critères).`);
console.log(`   Ouvre-le : start ${FICHIERS.dashboard}`);
