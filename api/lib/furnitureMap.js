// Maps Roboflow class names (lowercased) to FloorPlan Studio's FURNITURE_DEFS ids.
//
// IMPORTANT: this list was written from the workflow name/description only — we were not able
// to call Roboflow's `workflows_get` to read the model's real class list (MCP connector wasn't
// authorized during setup). Before relying on this in production:
//   1. Run one real detection (see the smoke test in test/smoke.js).
//   2. Log `raw.predictions[].class` for a sample image.
//   3. Fill in any classes below that come back as "unmapped" in the server logs.
//
// Left side: lowercased Roboflow class name. Right side: id from FURNITURE_DEFS in the HTML file.
export const FURNITURE_CLASS_MAP = {
  sofa: 'sofa_3',
  couch: 'sofa_3',
  loveseat: 'sofa_2',
  'sofa 2 seat': 'sofa_2',
  'sofa 3 seat': 'sofa_3',
  chair: 'chair',
  'dining chair': 'chair',
  armchair: 'armchair',
  'lounge chair': 'armchair',
  table: 'table_rect',
  'dining table': 'table_rect',
  'round table': 'table_round',
  'coffee table': 'coffee',
  desk: 'desk',
  bed: 'bed_d',
  'single bed': 'bed_s',
  'double bed': 'bed_d',
  'king bed': 'bed_k',
  cabinet: 'cabinet',
  'wall cabinet': 'wall_cab',
  wardrobe: 'wardrobe',
  closet: 'wardrobe',
  shelf: 'shelf',
  bookshelf: 'shelf',
  bookcase: 'shelf',
  sink: 'sink',
  toilet: 'toilet',
  bathtub: 'bathtub',
  tub: 'bathtub',
  plant: 'plant',
  houseplant: 'plant',
  potted_plant: 'plant',
  'potted plant': 'plant',
  rug: 'rug',
  carpet: 'rug',
  tv: 'tv',
  television: 'tv',
  monitor: 'tv',
  door: 'door',
  window: 'window',
};

/**
 * @param {string} rawClassName
 * @returns {string|null} a FURNITURE_DEFS id, or null if there's no known mapping
 */
export function mapClassToFurnitureId(rawClassName) {
  if (!rawClassName) return null;
  const key = String(rawClassName).trim().toLowerCase();
  return FURNITURE_CLASS_MAP[key] || null;
}
