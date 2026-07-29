const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;

export class RoboflowError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = 'RoboflowError';
    this.status = status;
    this.cause = cause;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs the configured Roboflow workflow against a single base64-encoded image.
 *
 * @param {Object} opts
 * @param {string} opts.imageBase64 - raw base64 (no data: prefix)
 * @param {Object} [opts.parameters] - workflow parameters, if the workflow declares any
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.retries]
 * @returns {Promise<any>} the parsed JSON body of the Roboflow response (an object with an
 *   `outputs` array — one entry per input image)
 */
export async function runFurnitureDetectionWorkflow({
  imageBase64,
  parameters = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
}) {
  const apiKey = process.env.ROBOFLOW_API_KEY;
  if (!apiKey) {
    throw new RoboflowError('ROBOFLOW_API_KEY is not set. Add it in Vercel project settings.', {
      status: 500,
    });
  }

  const apiUrl = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com';
  const workspace = process.env.ROBOFLOW_WORKSPACE_NAME || 'tinnns-workspace';
  const workflowId =
    process.env.ROBOFLOW_WORKFLOW_ID || 'furniture-vfurniture-q5tkw-hv0i3-1-yolo11n-t1-logic';
 const endpoint =
  `${apiUrl}/${workspace}/workflows/chat?workflowUrl=${encodeURIComponent(workflowId)}`;
  console.log("Calling Roboflow:", endpoint);
  return await res.json();\
  const json = await res.json();
console.log(JSON.stringify(json, null, 2));
return json;
  

  const body = JSON.stringify({
    api_key: apiKey,
    inputs: {
      image: { type: 'base64', value: imageBase64 },
      ...parameters,
    },
  });

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new RoboflowError(`Roboflow returned ${res.status}: ${text.slice(0, 300)}`, {
          status: res.status,
        });
      }

      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const isLastAttempt = attempt === retries;
      const isAbort = err.name === 'AbortError';
      // Don't retry on 4xx (bad request / bad key) — only on timeouts / network / 5xx.
      const status = err instanceof RoboflowError ? err.status : null;
      const shouldRetry = !isLastAttempt && (isAbort || !status || status >= 500);
      if (!shouldRetry) break;
      await sleep(300 * 2 ** attempt);
    }
  }

  if (lastErr instanceof RoboflowError) throw lastErr;
  throw new RoboflowError(
    lastErr?.name === 'AbortError' ? 'Roboflow request timed out.' : 'Roboflow request failed.',
    { cause: lastErr }
  );
}
