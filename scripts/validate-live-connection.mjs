import assert from "node:assert/strict";
import { init } from "../dist/index.mjs";

const connectionUrl =
  process.env.LOOPAD_CONNECTION_URL ??
  "https://dashboard.api.dev.loop-ad.org/api/public/v1/sdk/connections/wk_b35b42ee88bb4469becef289cdf29c57";
const origin =
  process.env.LOOPAD_ALLOWED_ORIGIN ??
  "https://demo-shoppingmall.dev.loop-ad.org";
const nativeFetch = globalThis.fetch;
const postRequests = [];
const postResponses = [];
const postResponseBodies = [];
const postPromises = [];
const warnings = [];
const originalWarn = console.warn;

globalThis.location = {
  href: `${origin}/schema-validation`,
  pathname: "/schema-validation",
};
globalThis.document = {
  title: "Schema validation",
  referrer: "",
  addEventListener() {},
  removeEventListener() {},
};
console.warn = (...args) => warnings.push(args);
globalThis.fetch = (input, options = {}) => {
  const url = String(input);
  if ((options.method ?? "GET") === "GET") {
    return nativeFetch(url, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Origin: origin,
      },
    });
  }

  postRequests.push(JSON.parse(options.body));
  const pending = nativeFetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      Origin: origin,
    },
  }).then(async (response) => {
    postResponses.push(response.status);
    postResponseBodies.push(await response.clone().text());
    return response;
  });
  postPromises.push(pending);
  return pending;
};

const client = await init({
  connectionUrl,
  identity: {
    userId: "schema-validation-user",
    sessionId: `schema-validation-${Date.now()}`,
  },
  autoTrackPageViews: false,
  collectDomEvents: false,
  debug: true,
});

const validProperties = {
  sample_id: "live-probe",
  amount: 129000.5,
  quantity: 2,
  active: true,
  tags: ["live", "probe"],
  item: {
    sku: "probe-sku",
    count: 2,
  },
};

client.track("schema_validation_probe", validProperties);
client.track("schema_validation_probe", { ...validProperties, quantity: 1.5 });
client.track("schema_validation_probe", { ...validProperties, unknown_property: true });
client.track("__loopad_unregistered_validation_probe", validProperties);
await Promise.all(postPromises);

assert.equal(postRequests.length, 1);
assert.equal(postRequests[0].event_name, "schema_validation_probe");
assert.deepEqual(
  JSON.parse(postRequests[0].properties_json).item,
  validProperties.item,
);
assert.deepEqual(
  postResponses,
  [202],
  `collector response: ${postResponseBodies.join(" | ")}`,
);
assert.equal(warnings.length, 3);

client.destroy();
console.warn = originalWarn;
globalThis.fetch = nativeFetch;

console.info(
  JSON.stringify({
    connectionUrl,
    collectorStatus: postResponses[0],
    sent: postRequests.length,
    dropped: warnings.length,
  }),
);
