/**
 * Régénère lib/gares.mjs depuis le référentiel officiel SNCB (api.irail.be).
 *
 * Exécutable seul : `node maj_gares.mjs`. À relancer après avoir élargi
 * COMMUNES_CIBLES, pour que les nouvelles communes amènent leurs gares.
 *
 * Pourquoi un script plutôt qu'une liste écrite à la main : « accès gare »
 * pèse 40 points sur 100 et le barème est raide (0,8 km = 100 points,
 * 6 km = 45). Une erreur de coordonnées de 2 km déplace un bien de 20 à
 * 30 points. La liste manuelle en contenait : Genappe y figurait alors que
 * sa ligne est fermée aux voyageurs depuis des décennies — ses biens
 * étaient notés comme ayant une gare sur place — et douze autres gares
 * étaient décalées de 1 à 2,3 km.
 *
 * Critère : une gare est retenue si au moins 3 biens du périmètre sont à
 * moins de 6 km, OU si elle est à moins de 6 km du centre d'une commune
 * cible. Au-delà de 6 km une gare ne peut jamais être la plus proche d'un
 * bien ; en dessous de 3 biens c'est du bruit (biens isolés, géocodage
 * approximatif). Le second critère évite la dépendance circulaire d'une
 * commune fraîchement ajoutée, qui n'a encore aucun bien.
 */

import './lib/racine.mjs';
import fs from 'fs';
import { chromium } from 'playwright';
import { FICHIERS, CP_VERS_COMMUNE } from './config.mjs';

const RAYON_KM = 6;
const BIENS_MINIMUM = 3;

const R = 6371;
const rad = (d) => (d * Math.PI) / 180;
function distance(aLat, aLon, bLat, bLon) {
    const x = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
}

async function gareseOfficielles() {
    const nav = await chromium.launch({ headless: true, channel: 'chromium' });
    try {
        const page = await nav.newPage();
        const d = await page.evaluate(async () => {
            const r = await fetch('https://api.irail.be/stations/?format=json&lang=fr');
            return r.ok ? await r.json() : null;
        });
        if (!d?.station) throw new Error('api.irail.be injoignable');
        return d.station;
    } finally {
        await nav.close();
    }
}

/** Les biens géolocalisés du dernier dashboard : ils définissent le périmètre réel. */
function biensGeolocalises() {
    const h = fs.readFileSync(FICHIERS.dashboard, 'utf-8');
    const debut = h.indexOf('const ANNONCES = [');
    const fin = h.indexOf(';\nconst DISPARUS', debut);
    if (debut < 0 || fin < 0) throw new Error(`${FICHIERS.dashboard} illisible — lance d'abord npm run dashboard`);
    return JSON.parse(h.slice(debut + 'const ANNONCES = '.length, fin)).filter((a) => a.coords && a.dansPerimetre);
}

/**
 * Points d'ancrage du périmètre : les centres des communes cibles, ET les
 * biens déjà géolocalisés.
 *
 * Les deux sont nécessaires. Les biens seuls suffiraient presque, mais ils
 * créent une dépendance circulaire : une commune fraîchement ajoutée à
 * COMMUNES_CIBLES n'a encore aucun bien, donc n'amènerait aucune gare — et
 * ses biens, une fois trouvés, seraient rattachés à une gare lointaine.
 * Les centres de communes seuls suffiraient aussi, mais ils ignorent les
 * hameaux excentrés où se trouvent beaucoup de biens.
 */
async function ancresDuPerimetre() {
    const cache = fs.existsSync(FICHIERS.cacheGeocode) ? JSON.parse(fs.readFileSync(FICHIERS.cacheGeocode, 'utf-8')) : {};
    const ancres = [];
    let geocodes = 0;

    for (const [cp, commune] of Object.entries(CP_VERS_COMMUNE)) {
        const dejaVu = Object.keys(cache).find((k) => k.startsWith(`${cp} `) && cache[k]);
        if (dejaVu) {
            ancres.push(cache[dejaVu]);
            continue;
        }
        const q = `${cp} ${commune}`;
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=be&q=${encodeURIComponent(q)}`;
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'scraper-immo-personnel/3.0' } });
            const data = await res.json();
            await new Promise((r) => setTimeout(r, 1100)); // Nominatim : 1 req/s
            cache[q] = data?.length ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
            if (cache[q]) ancres.push(cache[q]);
            geocodes++;
        } catch (e) {
            console.warn(`   ⚠️ géocodage échoué pour "${q}" : ${e.message}`);
        }
    }
    if (geocodes) fs.writeFileSync(FICHIERS.cacheGeocode, JSON.stringify(cache, null, 2));

    const biens = biensGeolocalises().map((a) => a.coords);
    console.log(`   ${Object.keys(CP_VERS_COMMUNE).length} codes postaux cibles (${geocodes} géocodé(s) à l'instant), ${biens.length} biens localisés.`);
    return { centres: ancres, biens };
}

const officielles = await gareseOfficielles();
console.log(`\n🚉 GARES\n   ${officielles.length} gares au référentiel SNCB.`);
const { centres, biens } = await ancresDuPerimetre();

const retenues = [];
for (const g of officielles) {
    const lat = Number(g.locationY);
    const lon = Number(g.locationX);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // Retenue si elle dessert vraiment le périmètre : assez de biens à portée,
    // ou simplement proche d'une commune cible (cas d'une commune sans bien).
    const proches = biens.filter((c) => distance(lat, lon, c.lat, c.lon) <= RAYON_KM).length;
    const presDunCentre = centres.some((c) => distance(lat, lon, c.lat, c.lon) <= RAYON_KM);
    if (proches >= BIENS_MINIMUM || presDunCentre) retenues.push({ nom: g.name, lat: +lat.toFixed(4), lon: +lon.toFixed(4) });
}
retenues.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

const contenu = `/**
 * Gares desservant le périmètre — NE PAS ÉDITER À LA MAIN.
 *
 * Généré par \`node maj_gares.mjs\` depuis le référentiel officiel SNCB
 * (api.irail.be). Relancer après avoir élargi COMMUNES_CIBLES.
 *
 * Critère : ${BIENS_MINIMUM} biens du périmètre à moins de ${RAYON_KM} km, ou un centre de commune cible à moins de ${RAYON_KM} km.
 * Dernière génération : ${new Date().toISOString().slice(0, 10)} — ${retenues.length} gares.
 */

export const GARES = [
${retenues.map((g) => `    { nom: ${JSON.stringify(g.nom)}, lat: ${g.lat}, lon: ${g.lon} },`).join('\n')}
];
`;

fs.writeFileSync('lib/gares.mjs', contenu);
console.log(`   ✅ ${retenues.length} gares écrites dans lib/gares.mjs`);
console.log(`   → relance « npm run dashboard » pour recalculer les distances.`);
