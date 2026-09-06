/**
 * Ancre le dossier de travail sur la racine du projet.
 *
 * Pourquoi : le scraper et le dashboard écrivent en chemins relatifs
 * (annonces.json, geocode-cache.json, debug/, et storage/ pour Crawlee).
 * Lancés depuis un autre dossier — `node scraper-playwright\scrapper_immo.mjs`
 * exécuté depuis c:\IMMO, par exemple — ils éparpillaient tout à côté du
 * projet, avec pour effet un cache de géocodage et un dataset dupliqués.
 *
 * ⚠️ Doit rester le PREMIER import des scripts d'entrée : les imports ESM
 * s'exécutent dans l'ordre, et Crawlee fige son dossier de stockage au moment
 * où il est chargé.
 */

import path from 'path';
import { fileURLToPath } from 'url';

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.cwd() !== RACINE) {
    process.chdir(RACINE);
}
