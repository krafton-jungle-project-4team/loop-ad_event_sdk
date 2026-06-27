import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import * as sdkModule from "../dist/index.mjs";

const { init, version } = sdkModule;

let requests;
let listeners;
let currentUrl;
let activeSdk;

beforeEach(() => {
    requests = [];
    listeners = new Map();
    currentUrl = new URL("https://demo-shoppingmall.dev.loop-ad.org/products/sku-1");
    activeSdk = null;

    globalThis.location = createLocation();
    globalThis.window = createWindow();
    globalThis.history = createHistory();
    globalThis.document = createDocument();
    globalThis.fetch = async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return { ok: true, status: 202 };
    };
});

afterEach(() => {
    activeSdk?.destroy();
});

test("exports a small runtime API", () => {
    assert.equal(typeof init, "function");
    assert.equal(typeof version, "string");
    assert.equal("defaultEndpoint" in sdkModule, false);

    activeSdk = init({ projectId: "demo-shoppingmall", autoTrackPageViews: false });

    assert.equal(typeof activeSdk.track, "function");
    assert.equal(typeof activeSdk.setIdentity, "function");
    assert.equal(typeof activeSdk.clearIdentity, "function");
    assert.equal(typeof activeSdk.destroy, "function");
    assert.equal("pageView" in activeSdk, false);
    assert.equal("identify" in activeSdk, false);
    assert.equal("setContext" in activeSdk, false);
});

test("records the current page when identity becomes ready", () => {
    activeSdk = init({ projectId: "demo-shoppingmall" });

    assert.equal(requests.length, 0);

    activeSdk.setIdentity({
        userId: "user-1",
        sessionId: "session-1"
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://ingest.dev.loop-ad.org/");
    assert.equal(requests[0].body.project_id, "demo-shoppingmall");
    assert.equal(requests[0].body.event_name, "page_view");
    assert.equal(requests[0].body.user_id, "user-1");
    assert.equal(requests[0].body.session_id, "session-1");

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.page.path, "/products/sku-1");
    assert.equal(properties.sdk.name, "loop-ad_event_sdk");
});

test("does not duplicate the current page for repeated identity updates", () => {
    activeSdk = init({ projectId: "demo-shoppingmall" });

    activeSdk.setIdentity({
        userId: "user-1",
        sessionId: "session-1"
    });
    activeSdk.setIdentity({
        userId: "user-1",
        sessionId: "session-1"
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.event_name, "page_view");
});

test("sends initial page_view immediately when identity is already known", () => {
    activeSdk = init({
        projectId: "demo-shoppingmall",
        identity: {
            userId: "user-1",
            sessionId: "session-1"
        }
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.event_name, "page_view");
    assert.equal(requests[0].body.user_id, "user-1");
    assert.equal(requests[0].body.session_id, "session-1");
});

test("maps manual product_view fields to snake_case payload fields", () => {
    activeSdk = init({
        projectId: "demo-shoppingmall",
        endpoint: "http://localhost:8080/events",
        autoTrackPageViews: false,
        identity: {
            userId: "user-1",
            sessionId: "session-1"
        },
        context: {
            channel: "google",
            campaignId: "summer-2026",
            ageGroup: "30s",
            gender: "male",
            device: "mobile"
        }
    });

    activeSdk.track("product_view", {
        eventId: "event-1",
        eventTime: "2026-06-27T10:00:00.000+09:00",
        category: "Home/Eco-Friendly",
        productId: "GGOEGCBD142299",
        inventoryStatus: "in_stock",
        price: 12900,
        properties: { route_group: "product-detail" }
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "http://localhost:8080/events");
    assert.equal(requests[0].body.event_id, "event-1");
    assert.equal(requests[0].body.user_id, "user-1");
    assert.equal(requests[0].body.session_id, "session-1");
    assert.equal(requests[0].body.event_name, "product_view");
    assert.equal(requests[0].body.channel, "google");
    assert.equal(requests[0].body.campaign_id, "summer-2026");
    assert.equal(requests[0].body.age_group, "30s");
    assert.equal(requests[0].body.product_id, "GGOEGCBD142299");
    assert.equal(requests[0].body.price, 12900);

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.route_group, "product-detail");
});

test("sends custom string event names", () => {
    activeSdk = init({
        projectId: "demo-shoppingmall",
        autoTrackPageViews: false,
        identity: {
            userId: "user-1",
            sessionId: "session-1"
        }
    });

    activeSdk.track("signup_completed", {
        campaignId: "summer-2026",
        properties: { source: "hero_banner" }
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.event_name, "signup_completed");
    assert.equal(requests[0].body.campaign_id, "summer-2026");

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.source, "hero_banner");
});

test("setIdentity can update shared context for later events", () => {
    activeSdk = init({ projectId: "demo-shoppingmall", autoTrackPageViews: false });

    activeSdk.setIdentity({ userId: "user-42", sessionId: "session-42" }, { ageGroup: "20s" });
    activeSdk.track("checkout_start", { quantity: 2 });

    assert.equal(requests[0].body.user_id, "user-42");
    assert.equal(requests[0].body.session_id, "session-42");
    assert.equal(requests[0].body.age_group, "20s");
    assert.equal(requests[0].body.quantity, 2);
});

test("collects annotated DOM events without reading form input values", () => {
    activeSdk = init({ projectId: "demo-shoppingmall", autoTrackPageViews: false });

    const button = new FakeElement("button", {
        "data-loopad-event": "add_to_cart",
        "data-loopad-product-id": "SKU-1",
        "data-loopad-category": "fresh-food",
        "data-loopad-price": "5900",
        "data-loopad-quantity": "2",
        "data-loopad-prop-slot": "main"
    });
    button.textContent = "Add to cart";

    document.dispatch("click", { type: "click", target: button });
    assert.equal(requests.length, 0);

    activeSdk.setIdentity({
        userId: "user-1",
        sessionId: "session-1"
    });

    assert.equal(requests.length, 0);

    document.dispatch("click", { type: "click", target: button });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.event_name, "add_to_cart");
    assert.equal(requests[0].body.product_id, "SKU-1");
    assert.equal(requests[0].body.category, "fresh-food");
    assert.equal(requests[0].body.price, 5900);
    assert.equal(requests[0].body.quantity, 2);

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.slot, "main");
    assert.equal(properties.element.tag, "button");
    assert.equal(properties.element.text, undefined);
});

test("tracks SPA navigation through history patching after identity is ready", () => {
    activeSdk = init({
        projectId: "demo-shoppingmall",
        identity: {
            userId: "user-1",
            sessionId: "session-1"
        }
    });
    requests = [];

    history.pushState(null, "", "/checkout");

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.event_name, "page_view");

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.page.path, "/checkout");
    assert.equal(
        properties.page.previous_url,
        "https://demo-shoppingmall.dev.loop-ad.org/products/sku-1"
    );
});

test("clearIdentity keeps logged-out work from attaching to a future login", () => {
    activeSdk = init({ projectId: "demo-shoppingmall", autoTrackPageViews: false });

    activeSdk.track("product_view", { productId: "SKU-before-login" });
    activeSdk.clearIdentity();
    activeSdk.track("add_to_cart", { productId: "SKU-logged-out" });
    activeSdk.setIdentity({
        userId: "user-1",
        sessionId: "session-1"
    });

    assert.equal(requests.length, 0);

    activeSdk.track("product_view", { productId: "SKU-after-login" });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.product_id, "SKU-after-login");
});

function createLocation() {
    return {
        get href() {
            return currentUrl.href;
        },
        get pathname() {
            return currentUrl.pathname;
        },
        get protocol() {
            return currentUrl.protocol;
        }
    };
}

function createWindow() {
    return {
        addEventListener(type, handler) {
            if (!listeners.has(type)) {
                listeners.set(type, new Set());
            }
            listeners.get(type).add(handler);
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler);
        },
        dispatch(type, event = { type }) {
            for (const handler of listeners.get(type) ?? []) {
                handler(event);
            }
        }
    };
}

function createHistory() {
    return {
        pushState(_state, _title, url) {
            if (url) {
                currentUrl = new URL(url, currentUrl.href);
            }
        },
        replaceState(_state, _title, url) {
            if (url) {
                currentUrl = new URL(url, currentUrl.href);
            }
        }
    };
}

function createDocument() {
    return {
        title: "Product detail",
        referrer: "https://referrer.example",
        nodeType: 9,
        addEventListener(type, handler) {
            if (!listeners.has(type)) {
                listeners.set(type, new Set());
            }
            listeners.get(type).add(handler);
        },
        removeEventListener(type, handler) {
            listeners.get(type)?.delete(handler);
        },
        dispatch(type, event) {
            for (const handler of listeners.get(type) ?? []) {
                handler(event);
            }
        }
    };
}

class FakeElement {
    constructor(tagName, attributes = {}) {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this.parentElement = null;
        this.children = [];
        this.textContent = "";
        this.attributes = new Map(Object.entries(attributes));
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    getAttributeNames() {
        return Array.from(this.attributes.keys());
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    closest(selector) {
        let current = this;

        while (current) {
            if (current.matches(selector)) {
                return current;
            }

            current = current.parentElement;
        }

        return null;
    }

    matches(selector) {
        return selector === "[data-loopad-event]" && this.hasAttribute("data-loopad-event");
    }
}
