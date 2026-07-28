import { runFurnitureDetectionWorkflow, RoboflowError } from './lib/roboflowClient.js';
import { extractPredictions } from './lib/extractPredictions.js';
import { mapClassToFurnitureId } from './lib/furnitureMap.js';

// POST /api/detect-furniture
// Body: { "image": "<base64, no data: prefix>" }
// This replaces the old Express route + multer upload. The frontend now resizes the photo
// and reads it as base64 in the browser (see resizeImageToBase64() in index.html), so this
// function only ever receives a small JSON body instead of a multipart file upload.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const image = req.body && req.body.image;
  if (!image || typeof image !== 'string') {
    res.status(400).json({ error: 'Missing "image" (base64 string) in the request body.' });
    return;
  }

  try {
    const raw = await runFurnitureDetectionWorkflow({ imageBase64: image });

    // Roboflow's response is a list, one entry per input image — we sent one image.
    const firstOutput = Array.isArray(raw?.outputs) ? raw.outputs[0] : raw?.outputs ?? raw;
    const { predictions, imageWidth, imageHeight, matchedKey } = extractPredictions(firstOutput);

    if (!matchedKey) {
      console.warn(
        '[detect-furniture] Could not locate a predictions array in the workflow output. ' +
          'Top-level keys were:',
        firstOutput && typeof firstOutput === 'object' ? Object.keys(firstOutput) : firstOutput
      );
    }

    const unmapped = new Set();
    const detections = predictions
      .map((p) => {
        const furnitureId = mapClassToFurnitureId(p.class);
        if (!furnitureId) unmapped.add(p.class);
        return {
          furnitureId, // null if class isn't in FURNITURE_CLASS_MAP yet
          className: p.class,
          confidence: typeof p.confidence === 'number' ? p.confidence : null,
          // Roboflow object-detection predictions are typically CENTER x/y in source-image pixels.
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
        };
      })
      .filter((d) => d.furnitureId); // drop classes we don't yet know how to place

    res.status(200).json({
      detections,
      imageWidth,
      imageHeight,
      unmappedClasses: [...unmapped],
    });
  } catch (err) {
    if (err instanceof RoboflowError) {
      console.error('[detect-furniture] Roboflow error:', err.message);
      res.status(err.status && err.status < 500 ? err.status : 502).json({
        error: 'Furniture detection failed.',
        detail: err.message,
      });
      return;
    }
    console.error('[detect-furniture] Unexpected error:', err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
}
