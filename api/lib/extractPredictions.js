// Roboflow workflow output shapes vary per-workflow (it depends entirely on how the workflow's
// blocks are named/wired). We didn't have grounded access to this workflow's exact schema, so
// instead of hard-coding one shape, we walk the response looking for the detections array and
// its accompanying source-image dimensions.
//
// A typical object-detection workflow output block looks like:
//   { predictions: [ { x, y, width, height, confidence, class, class_id, ... }, ... ],
//     image: { width, height } }
// but the outer key names ("predictions", "model_predictions", "detections", ...) are whatever
// the workflow author picked. This function finds that shape structurally instead of by name.

/**
 * @param {any} workflowOutput - one entry from the Roboflow `outputs` array (a dict keyed by
 *   the workflow's own output names).
 * @returns {{ predictions: Array<object>, imageWidth: number|null, imageHeight: number|null, matchedKey: string|null }}
 */
export function extractPredictions(workflowOutput) {
  if (!workflowOutput || typeof workflowOutput !== 'object') {
    return { predictions: [], imageWidth: null, imageHeight: null, matchedKey: null };
  }

  const looksLikeDetection = (obj) =>
    obj &&
    typeof obj === 'object' &&
    'class' in obj &&
    ('x' in obj || 'bbox' in obj || 'points' in obj);

  // Breadth-first search for the first array of detection-shaped objects, and the first
  // {width, height} sibling object we can find along the way (usually the source image size).
  const queue = [{ value: workflowOutput, path: [] }];
  let foundPredictions = null;
  let foundKey = null;
  let imageDims = null;

  while (queue.length) {
    const { value, path } = queue.shift();
    if (!value || typeof value !== 'object') continue;

    for (const [key, val] of Object.entries(value)) {
      if (
        !imageDims &&
        val &&
        typeof val === 'object' &&
        typeof val.width === 'number' &&
        typeof val.height === 'number' &&
        !Array.isArray(val)
      ) {
        imageDims = { width: val.width, height: val.height };
      }

      if (!foundPredictions && Array.isArray(val) && val.length > 0 && looksLikeDetection(val[0])) {
        foundPredictions = val;
        foundKey = [...path, key].join('.');
      }

      if (val && typeof val === 'object') {
        queue.push({ value: val, path: [...path, key] });
      }
    }
  }

  return {
    predictions: foundPredictions || [],
    imageWidth: imageDims?.width ?? null,
    imageHeight: imageDims?.height ?? null,
    matchedKey: foundKey,
  };
}
