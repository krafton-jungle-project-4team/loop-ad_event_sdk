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
    assert.equal(requests[0].url, "https://event.api.dev.loop-ad.org");
    assert.equal(requests[0].body.project_id, "demo-shoppingmall");
    assertCanonicalEnvelope(requests[0].body);
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

test("maps manual hotel event fields into properties_json", () => {
    activeSdk = init({
        projectId: "demo-shoppingmall",
        // The event-collector host is fixed by loop-ad_infra app-repository-guide.md.
        // Runtime JS callers may pass an endpoint field, but the SDK ignores it.
        endpoint: "http://localhost:8080/events",
        autoTrackPageViews: false,
        identity: {
            userId: "user-1",
            sessionId: "session-1"
        },
        context: {
            campaignId: "summer-2026",
            promotionId: "promo-banner-001",
            promotionRunId: "run-banner-001",
            adExperimentId: "ad-exp-001",
            segmentId: "seg-repeat-hotel",
            promotionChannel: "onsite_banner",
            device: "mobile"
        }
    });

    activeSdk.track("hotel_detail_view", {
        eventId: "event-1",
        eventTime: "2026-06-27T10:00:00.000+09:00",
        hotelId: "hotel-123",
        hotelCluster: "seoul-family",
        hotelMarket: "seoul",
        hotelCity: "Seoul",
        hotelCountry: "KR",
        checkinDate: "2026-08-01",
        checkoutDate: "2026-08-03",
        adultCount: 2,
        childCount: 1,
        roomPrice: 129000,
        currency: "KRW",
        properties: { route_group: "hotel-detail" }
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://event.api.dev.loop-ad.org");
    assertCanonicalEnvelope(requests[0].body);
    assert.equal(requests[0].body.event_id, "event-1");
    assert.equal(requests[0].body.user_id, "user-1");
    assert.equal(requests[0].body.session_id, "session-1");
    assert.equal(requests[0].body.event_name, "hotel_detail_view");

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.campaign_id, "summer-2026");
    assert.equal(properties.promotion_id, "promo-banner-001");
    assert.equal(properties.promotion_run_id, "run-banner-001");
    assert.equal(properties.ad_experiment_id, "ad-exp-001");
    assert.equal(properties.segment_id, "seg-repeat-hotel");
    assert.equal(properties.promotion_channel, "onsite_banner");
    assert.equal(properties.hotel_id, "hotel-123");
    assert.equal(properties.hotel_cluster, "seoul-family");
    assert.equal(properties.hotel_market, "seoul");
    assert.equal(properties.adult_count, "2");
    assert.equal(properties.child_count, "1");
    assert.equal(properties.room_price, "129000");
    assert.equal(properties.currency, "KRW");
    assert.equal(properties.device, "mobile");
    assert.equal(properties.route_group, "hotel-detail");
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
    assertCanonicalEnvelope(requests[0].body);
    assert.equal(requests[0].body.event_name, "signup_completed");

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.campaign_id, "summer-2026");
    assert.equal(properties.source, "hero_banner");
});

test("setIdentity can update shared context for later events", () => {
    activeSdk = init({ projectId: "demo-shoppingmall", autoTrackPageViews: false });

    activeSdk.setIdentity({ userId: "user-42", sessionId: "session-42" }, { hotelMarket: "busan" });
    activeSdk.track("hotel_click", { hotelId: "hotel-42" });

    assertCanonicalEnvelope(requests[0].body);
    assert.equal(requests[0].body.user_id, "user-42");
    assert.equal(requests[0].body.session_id, "session-42");

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.hotel_market, "busan");
    assert.equal(properties.hotel_id, "hotel-42");
});

test("collects annotated DOM events without reading form input values", () => {
    activeSdk = init({ projectId: "demo-shoppingmall", autoTrackPageViews: false });

    const button = new FakeElement("button", {
        "data-loopad-event": "promotion_click",
        "data-loopad-campaign-id": "camp-summer-2026",
        "data-loopad-promotion-id": "promo-banner-001",
        "data-loopad-promotion-run-id": "run-banner-001",
        "data-loopad-ad-experiment-id": "ad-exp-001",
        "data-loopad-segment-id": "seg-repeat-hotel",
        "data-loopad-content-id": "content-banner-001",
        "data-loopad-content-option-id": "option-a",
        "data-loopad-promotion-channel": "onsite_banner",
        "data-loopad-hotel-id": "hotel-123",
        "data-loopad-hotel-cluster": "seoul-family",
        "data-loopad-hotel-market": "seoul",
        "data-loopad-room-price": "59000",
        "data-loopad-currency": "KRW",
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
    assertCanonicalEnvelope(requests[0].body);
    assert.equal(requests[0].body.event_name, "promotion_click");

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.campaign_id, "camp-summer-2026");
    assert.equal(properties.promotion_id, "promo-banner-001");
    assert.equal(properties.promotion_run_id, "run-banner-001");
    assert.equal(properties.ad_experiment_id, "ad-exp-001");
    assert.equal(properties.segment_id, "seg-repeat-hotel");
    assert.equal(properties.content_id, "content-banner-001");
    assert.equal(properties.content_option_id, "option-a");
    assert.equal(properties.promotion_channel, "onsite_banner");
    assert.equal(properties.hotel_id, "hotel-123");
    assert.equal(properties.hotel_cluster, "seoul-family");
    assert.equal(properties.hotel_market, "seoul");
    assert.equal(properties.room_price, "59000");
    assert.equal(properties.currency, "KRW");
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
    assertCanonicalEnvelope(requests[0].body);

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.page.path, "/checkout");
    assert.equal(
        properties.page.previous_url,
        "https://demo-shoppingmall.dev.loop-ad.org/products/sku-1"
    );
});

test("clearIdentity keeps logged-out work from attaching to a future login", () => {
    activeSdk = init({ projectId: "demo-shoppingmall", autoTrackPageViews: false });

    activeSdk.track("hotel_detail_view", { hotelId: "hotel-before-login" });
    activeSdk.clearIdentity();
    activeSdk.track("promotion_click", { hotelId: "hotel-logged-out" });
    activeSdk.setIdentity({
        userId: "user-1",
        sessionId: "session-1"
    });

    assert.equal(requests.length, 0);

    activeSdk.track("hotel_detail_view", { hotelId: "hotel-after-login" });

    assert.equal(requests.length, 1);
    assertCanonicalEnvelope(requests[0].body);

    const properties = JSON.parse(requests[0].body.properties_json);
    assert.equal(properties.hotel_id, "hotel-after-login");
});

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
        "user_id"
    ].sort());
    assert.equal(body.schema_version, "hotel_rec_promo.v1");
    assert.equal(body.source, "browser_sdk");
    assert.equal(typeof body.properties_json, "string");
}

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
