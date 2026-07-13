import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import * as sdkModule from "../dist/index.mjs";

const { init, version } = sdkModule;

let activeSdk;
let connection;
let connectionGets;
let eventRequests;
let listeners;
let currentUrl;
let warnings;
let originalWarn;
let urlSequence = 0;

beforeEach(() => {
    activeSdk = null;
    connection = connectionFixture();
    connectionGets = 0;
    eventRequests = [];
    listeners = new Map();
    currentUrl = new URL("https://shop.example/products/sku-1");
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);

    globalThis.location = createLocation();
    globalThis.window = createWindow();
    globalThis.history = createHistory();
    globalThis.document = createDocument();
    globalThis.fetch = async (url, options = {}) => {
        if ((options.method ?? "GET") === "GET") {
            connectionGets += 1;
            return jsonResponse(connection);
        }

        eventRequests.push({
            url: String(url),
            options,
            body: JSON.parse(options.body)
        });
        return { ok: true, status: 202 };
    };
});

afterEach(() => {
    activeSdk?.destroy();
    console.warn = originalWarn;
    delete globalThis.location;
    delete globalThis.window;
    delete globalThis.history;
    delete globalThis.document;
    delete globalThis.fetch;
});

test("exports only the connection-based runtime API", async () => {
    assert.equal(typeof init, "function");
    assert.equal(typeof version, "string");
    assert.equal("defaultEndpoint" in sdkModule, false);

    activeSdk = await start();

    assert.deepEqual(
        Object.keys(activeSdk).sort(),
        ["clearIdentity", "destroy", "setIdentity", "track"].sort()
    );
    await assert.rejects(
        init({ projectId: "project", writeKey: "key" }),
        /connectionUrl/
    );
});

test("loads the connection and sends a canonical page_view when identity is ready", async () => {
    activeSdk = await start({
        identity: null,
        autoTrackPageViews: true
    });

    assert.equal(connectionGets, 1);
    assert.equal(eventRequests.length, 0);

    activeSdk.setIdentity({ userId: "user-1", sessionId: "session-1" });

    assert.equal(eventRequests.length, 1);
    const body = eventRequests[0].body;
    assertCanonicalEnvelope(body);
    assert.equal(eventRequests[0].url, connection.collectorUrl);
    assert.equal(body.event_name, "page_view");
    assert.equal(body.user_id, "user-1");
    assert.equal(body.session_id, "session-1");
    const properties = JSON.parse(body.properties_json);
    assert.equal(properties.page_path, "/products/sku-1");
    assert.equal(properties.page.url, currentUrl.href);
    assert.equal(properties.sdk.name, "loop-ad_event_sdk");
});

test("preserves nested JSON types and separates envelope options", async () => {
    activeSdk = await start();

    activeSdk.track(
        "checkout_completed",
        {
            order_id: "order-1",
            amount: 129000.5,
            quantity: 2,
            refundable: true,
            tags: ["new", "mobile"],
            item: { sku: "sku-1", count: 2 }
        },
        {
            eventId: "event-1",
            eventTime: "2026-07-13T10:00:00.000Z"
        }
    );

    assert.equal(eventRequests.length, 1);
    const body = eventRequests[0].body;
    assert.equal(body.event_id, "event-1");
    assert.equal(body.event_time, "2026-07-13T10:00:00.000Z");
    assert.deepEqual(JSON.parse(body.properties_json), {
        order_id: "order-1",
        amount: 129000.5,
        quantity: 2,
        refundable: true,
        tags: ["new", "mobile"],
        item: { sku: "sku-1", count: 2 },
        page_path: "/products/sku-1",
        page: {
            url: "https://shop.example/products/sku-1",
            path: "/products/sku-1",
            title: "Product detail",
            referrer: "https://referrer.example"
        },
        sdk: { name: "loop-ad_event_sdk", version }
    });
});

test("merges declared contexts with event properties taking precedence", async () => {
    activeSdk = await start({
        context: { source: "application" },
        identity: null
    });
    activeSdk.setIdentity(
        { userId: "user-1", sessionId: "session-1" },
        { source: "identity" }
    );
    activeSdk.track("context_event", { source: "event" });

    assert.equal(JSON.parse(eventRequests[0].body.properties_json).source, "event");

    activeSdk.clearIdentity();
    activeSdk.setIdentity({ userId: "user-2", sessionId: "session-2" });
    activeSdk.track("context_event");

    assert.equal(JSON.parse(eventRequests[1].body.properties_json).source, "application");
});

test("drops events until identity is set", async () => {
    activeSdk = await start({ identity: null, debug: true });

    activeSdk.track("page_view");

    assert.equal(eventRequests.length, 0);
    assert.match(warnings[0][0], /identity is not set/);
});

test("enforces registered events, required fields, exact types, and closed objects", async () => {
    activeSdk = await start({ debug: true });

    activeSdk.track("not_registered", {});
    activeSdk.track("checkout_completed", {});
    activeSdk.track("checkout_completed", validCheckout({ amount: "129000" }));
    activeSdk.track("checkout_completed", validCheckout({ quantity: 2.5 }));
    activeSdk.track("checkout_completed", validCheckout({ refundable: 1 }));
    activeSdk.track("checkout_completed", validCheckout({ tags: ["ok", 3] }));
    activeSdk.track("checkout_completed", validCheckout({ item: { sku: "sku-1", count: 1, extra: true } }));
    activeSdk.track("checkout_completed", validCheckout({ extra: "unknown" }));
    activeSdk.track("checkout_completed", validCheckout({ amount: Number.NaN }));
    activeSdk.track("checkout_completed", validCheckout({ item: null }));
    activeSdk.track("checkout_completed", validCheckout({ page_path: "/forged" }));
    activeSdk.track("page_view", new Date());

    const circular = validCheckout();
    circular.item.self = circular.item;
    activeSdk.track("checkout_completed", circular);

    activeSdk.track("checkout_completed", validCheckout());

    assert.equal(eventRequests.length, 1);
    assert.ok(warnings.length >= 12);
    const warningText = JSON.stringify(warnings);
    assert.match(warningText, /not registered/);
    assert.match(warningText, /is required/);
    assert.match(warningText, /must be a number/);
    assert.match(warningText, /must be an integer/);
    assert.match(warningText, /must be a boolean/);
    assert.match(warningText, /is not declared/);
    assert.match(warningText, /is reserved/);
    assert.match(warningText, /plain object/);
});

test("reads only typed data-loopad-properties JSON from DOM annotations", async () => {
    activeSdk = await start({ collectDomEvents: true });
    const element = new FakeElement("button", {
        "data-loopad-event": "dom_interaction",
        "data-loopad-id": "buy-button",
        "data-loopad-label": "Buy",
        "data-loopad-properties": JSON.stringify({
            amount: 129000,
            enabled: true,
            labels: ["primary"],
            target: { id: "sku-1" }
        })
    });

    document.dispatch("click", { type: "click", target: element });

    assert.equal(eventRequests.length, 1);
    const properties = JSON.parse(eventRequests[0].body.properties_json);
    assert.equal(properties.amount, 129000);
    assert.equal(properties.enabled, true);
    assert.deepEqual(properties.labels, ["primary"]);
    assert.deepEqual(properties.target, { id: "sku-1" });
    assert.deepEqual(properties.element, {
        tag: "button",
        loopad_id: "buy-button",
        label: "Buy",
        text: "Buy"
    });
});

test("allows DOM events without a properties attribute when the schema is empty", async () => {
    activeSdk = await start({ collectDomEvents: true });
    const element = new FakeElement("button", {
        "data-loopad-event": "page_view"
    });

    document.dispatch("click", { type: "click", target: element });

    assert.equal(eventRequests.length, 1);
});

test("drops malformed, oversized, sensitive, and schema-invalid DOM properties", async () => {
    activeSdk = await start({ collectDomEvents: true, debug: true });
    const rawValues = [
        "{invalid",
        "[]",
        JSON.stringify({ amount: "wrong" }),
        JSON.stringify({ amount: 1, card: "4111111111111111" }),
        JSON.stringify({ amount: 1, nested: { ssn: "123-45-6789" } }),
        JSON.stringify({ amount: 1, padding: "x".repeat(33 * 1024) })
    ];

    for (const raw of rawValues) {
        document.dispatch("click", {
            type: "click",
            target: new FakeElement("button", {
                "data-loopad-event": "dom_interaction",
                "data-loopad-properties": raw
            })
        });
    }

    assert.equal(eventRequests.length, 0);
    const warningText = JSON.stringify(warnings);
    assert.doesNotMatch(warningText, /4111111111111111/);
    assert.doesNotMatch(warningText, /123-45-6789/);
    assert.match(warningText, /not valid JSON/);
    assert.match(warningText, /root must be an object/);
    assert.match(warningText, /sensitive-looking/);
    assert.match(warningText, /exceeds 32768 bytes/);
});

test("tracks actual SPA URL changes once and records the previous URL", async () => {
    activeSdk = await start({ autoTrackPageViews: true });
    assert.equal(eventRequests.length, 1);

    history.pushState({}, "", "/cart");
    history.replaceState({}, "", "/cart");

    assert.equal(eventRequests.length, 2);
    const properties = JSON.parse(eventRequests[1].body.properties_json);
    assert.equal(properties.page.path, "/cart");
    assert.equal(properties.page.previous_url, "https://shop.example/products/sku-1");
});

test("caches a valid connection by URL", async () => {
    const connectionUrl = freshConnectionUrl();
    activeSdk = await init(baseOptions({ connectionUrl }));
    activeSdk.destroy();
    activeSdk = await init(baseOptions({ connectionUrl }));

    assert.equal(connectionGets, 1);
});

test("rejects invalid connection responses and Tracking Plan schemas", async () => {
    const invalidCases = [
        {
            mutate: (value) => {
                value.events[1].propertiesSchema = { type: "string" };
            },
            message: /propertiesSchema must be an object/
        },
        {
            mutate: (value) => {
                value.events[1].propertiesSchema.properties.item.properties.extra = { type: "date" };
            },
            message: /date is unsupported/
        },
        {
            mutate: (value) => {
                value.events[1].propertiesSchema.properties.item.required = ["missing"];
            },
            message: /required references an unknown property/
        },
        {
            mutate: (value) => {
                value.events[1].propertiesSchema.required = ["constructor"];
            },
            message: /required references an unknown property/
        },
        {
            mutate: (value) => {
                value.events[1].propertiesSchema.properties.tags = { type: "array" };
            },
            message: /items is required/
        },
        {
            mutate: (value) => {
                value.events[1].propertiesSchema.properties.amount = {
                    type: "number",
                    properties: {}
                };
            },
            message: /cannot define nested fields/
        },
        {
            mutate: (value) => {
                value.events[1].propertiesSchema.properties.page = { type: "string" };
            },
            message: /is reserved/
        },
        {
            mutate: (value) => {
                value.events[1].propertiesSchema.properties.item.properties.constructor = {
                    type: "string"
                };
            },
            message: /is unsafe/
        },
        {
            mutate: (value) => {
                value.events[1].propertiesSchema = tooDeepSchema();
            },
            message: /exceeds depth 8/
        },
        {
            mutate: (value) => {
                value.events[1].propertiesSchema = tooLargeSchema();
            },
            message: /exceeds 100 schema nodes/
        }
    ];

    for (const invalidCase of invalidCases) {
        connection = connectionFixture();
        invalidCase.mutate(connection);
        await assert.rejects(
            init(baseOptions({ connectionUrl: freshConnectionUrl() })),
            invalidCase.message
        );
    }
});

test("rejects connection transport failures", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(
        init(baseOptions({ connectionUrl: freshConnectionUrl() })),
        /HTTP 404/
    );

    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => {
            throw new Error("bad json");
        }
    });
    await assert.rejects(
        init(baseOptions({ connectionUrl: freshConnectionUrl() })),
        /response is not JSON/
    );

    globalThis.fetch = originalFetch;
});

test("drops requests larger than the collector limit", async () => {
    activeSdk = await start({ debug: true });

    activeSdk.track("large_event", { value: "한".repeat(100000) });

    assert.equal(eventRequests.length, 0);
    assert.match(JSON.stringify(warnings), /request body is too large/);
});

function baseOptions(overrides = {}) {
    return {
        connectionUrl: freshConnectionUrl(),
        identity: { userId: "user-1", sessionId: "session-1" },
        autoTrackPageViews: false,
        collectDomEvents: false,
        ...overrides
    };
}

async function start(overrides = {}) {
    return init(baseOptions(overrides));
}

function freshConnectionUrl() {
    urlSequence += 1;
    return "https://config.test/connections/test-" + urlSequence;
}

function validCheckout(overrides = {}) {
    return {
        order_id: "order-1",
        amount: 129000,
        quantity: 2,
        refundable: true,
        tags: ["new"],
        item: { sku: "sku-1", count: 2 },
        ...overrides
    };
}

function connectionFixture() {
    return {
        projectId: "generic-project",
        writeKey: "write-key",
        collectorUrl: "https://collector.example/events",
        schemaVersion: "tracking-plan.v1",
        schemaUrl: "https://config.test/connections/test/schema",
        revision: 1,
        cacheTtlSeconds: 60,
        events: [
            {
                eventName: "page_view",
                propertiesSchema: {
                    type: "object",
                    properties: {},
                    required: []
                }
            },
            {
                eventName: "checkout_completed",
                propertiesSchema: {
                    type: "object",
                    properties: {
                        order_id: { type: "string" },
                        amount: { type: "number" },
                        quantity: { type: "integer" },
                        refundable: { type: "boolean" },
                        tags: { type: "array", items: { type: "string" } },
                        item: {
                            type: "object",
                            properties: {
                                sku: { type: "string" },
                                count: { type: "integer" }
                            },
                            required: ["sku", "count"]
                        },
                        source: { type: "string" }
                    },
                    required: [
                        "order_id",
                        "amount",
                        "quantity",
                        "refundable",
                        "tags",
                        "item"
                    ]
                }
            },
            {
                eventName: "context_event",
                propertiesSchema: {
                    type: "object",
                    properties: { source: { type: "string" } },
                    required: ["source"]
                }
            },
            {
                eventName: "dom_interaction",
                propertiesSchema: {
                    type: "object",
                    properties: {
                        amount: { type: "number" },
                        enabled: { type: "boolean" },
                        labels: { type: "array", items: { type: "string" } },
                        target: {
                            type: "object",
                            properties: { id: { type: "string" } },
                            required: ["id"]
                        }
                    },
                    required: ["amount"]
                }
            },
            {
                eventName: "large_event",
                propertiesSchema: {
                    type: "object",
                    properties: { value: { type: "string" } },
                    required: ["value"]
                }
            }
        ]
    };
}

function tooDeepSchema() {
    let schema = { type: "string" };
    for (let index = 0; index < 9; index += 1) {
        schema = {
            type: "object",
            properties: { child: schema },
            required: ["child"]
        };
    }
    return schema;
}

function tooLargeSchema() {
    const properties = {};
    for (let index = 0; index < 100; index += 1) {
        properties["property_" + index] = { type: "string" };
    }
    return { type: "object", properties, required: [] };
}

function jsonResponse(body) {
    return {
        ok: true,
        status: 200,
        json: async () => structuredClone(body)
    };
}

function assertCanonicalEnvelope(body) {
    assert.deepEqual(Object.keys(body).sort(), [
        "event_id",
        "event_name",
        "event_time",
        "project_id",
        "properties_json",
        "schema_version",
        "session_id",
        "source",
        "user_id",
        "write_key"
    ].sort());
    assert.equal(body.project_id, connection.projectId);
    assert.equal(body.write_key, connection.writeKey);
    assert.equal(body.schema_version, connection.schemaVersion);
    assert.equal(body.source, "browser_sdk");
}

function createLocation() {
    return {
        get href() {
            return currentUrl.href;
        },
        get pathname() {
            return currentUrl.pathname;
        }
    };
}

function createWindow() {
    return {
        addEventListener(type, handler) {
            addListener(type, handler);
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler);
        },
        dispatch(type, event = { type }) {
            dispatch(type, event);
        }
    };
}

function createHistory() {
    return {
        pushState(_state, _title, url) {
            if (url) currentUrl = new URL(url, currentUrl.href);
        },
        replaceState(_state, _title, url) {
            if (url) currentUrl = new URL(url, currentUrl.href);
        }
    };
}

function createDocument() {
    return {
        title: "Product detail",
        referrer: "https://referrer.example",
        nodeType: 9,
        addEventListener(type, handler) {
            addListener(type, handler);
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler);
        },
        dispatch(type, event) {
            dispatch(type, event);
        }
    };
}

function addListener(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
}

function dispatch(type, event) {
    for (const handler of listeners.get(type) ?? []) handler(event);
}

class FakeElement {
    constructor(tagName, attributes = {}) {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this.parentElement = null;
        this.textContent = "";
        this.attributes = new Map(Object.entries(attributes));
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    closest(selector) {
        let current = this;
        while (current) {
            if (current.matches(selector)) return current;
            current = current.parentElement;
        }
        return null;
    }

    matches(selector) {
        return selector === "[data-loopad-event]" && this.hasAttribute("data-loopad-event");
    }
}
