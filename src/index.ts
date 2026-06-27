export type StandardEventName =
    | "page_view"
    | "product_view"
    | "add_to_cart"
    | "checkout_start"
    | "purchase"
    | "ad_impression"
    | "ad_click"
    | "coupon_issued"
    | "coupon_used";

export type EventName = StandardEventName | (string & {});

export type EventPropertyValue =
    | string
    | number
    | boolean
    | null
    | EventPropertyValue[]
    | { [key: string]: EventPropertyValue };

export interface EventProperties {
    [key: string]: EventPropertyValue;
}

export interface EventContext {
    channel?: string | null;
    campaignId?: string | null;
    ageGroup?: string | null;
    gender?: string | null;
    device?: string | null;
    category?: string | null;
    productId?: string | null;
    inventoryStatus?: string | null;
    price?: number | null;
    quantity?: number | null;
    revenue?: number | null;
    couponId?: string | null;
    orderId?: string | null;
    experimentId?: string | null;
    variantId?: string | null;
    actionId?: string | null;
    mappingId?: string | null;
    adId?: string | null;
    creativeId?: string | null;
    banditPolicyId?: string | null;
    banditArmId?: string | null;
    banditDecisionId?: string | null;
    rewardValue?: number | null;
}

export interface Identity {
    userId: string;
    sessionId: string;
}

export interface TrackFields extends EventContext {
    eventId?: string | null;
    eventTime?: string | number | Date | null;
    properties?: EventProperties | null;
}

export interface InitOptions {
    projectId: string;
    endpoint?: string | null;
    identity?: Identity | null;
    debug?: boolean | null;
    autoTrackPageViews?: boolean | null;
    collectDomEvents?: boolean | null;
    context?: EventContext | null;
}

interface LoopAdEventPayload {
    project_id: string;
    event_id: string;
    user_id: string;
    session_id: string;
    event_time: string;
    event_name: string;
    channel: string;
    campaign_id: string;
    age_group: string;
    gender: string;
    device: string;
    category: string;
    product_id: string;
    inventory_status: string;
    price: number;
    quantity: number;
    revenue: number;
    coupon_id: string;
    order_id: string;
    experiment_id: string;
    variant_id: string;
    action_id: string;
    mapping_id: string;
    ad_id: string;
    creative_id: string;
    bandit_policy_id: string;
    bandit_arm_id: string;
    bandit_decision_id: string;
    reward_value: number;
    properties_json: string;
}

export interface LoopAdEventSdkClient {
    track(eventName: EventName, fields?: TrackFields): void;
    setIdentity(identity: Identity, context?: EventContext | null): void;
    clearIdentity(): void;
    destroy(): void;
}

export const version =
    typeof __SDK_VERSION__ === "string" ? __SDK_VERSION__ : "0.1.0";

export function init(options: InitOptions): LoopAdEventSdkClient {
    const initOptions = withDefaultInitOptions(options);

    if (active && !active.destroyed) {
        warn(active.config.debug || initOptions.debug, "LoopAdEventSDK init() was called more than once.");
        return active.client;
    }

    active = new Runtime(initOptions);
    active.start();
    return active.client;
}

declare const __SDK_VERSION__: string | undefined;

class Runtime {
    readonly client: LoopAdEventSdkClient = Object.freeze({
        track: (eventName: EventName, fields?: TrackFields) => this.track(eventName, fields),
        setIdentity: (identity: Identity, context?: EventContext | null) =>
            this.setIdentity(identity, context),
        clearIdentity: () => this.clearIdentity(),
        destroy: () => this.destroy()
    });

    destroyed = false;

    private currentUrl = "";
    private originalPushState: History["pushState"] | null = null;
    private originalReplaceState: History["replaceState"] | null = null;

    constructor(readonly config: DefaultInitOptions) {}

    start(): void {
        this.currentUrl = href();

        if (this.config.collectDomEvents) {
            this.listenToDom();
        }

        if (this.config.autoTrackPageViews) {
            this.patchHistory();
            if (this.config.identity) {
                this.trackPageView();
            }
        }
    }

    private track(
        eventName: EventName,
        fields: TrackFields = {},
        previousUrl?: string,
        elementInfo?: { [key: string]: EventPropertyValue }
    ): void {
        if (this.destroyed) {
            return;
        }

        const normalizedEventName = text(eventName);
        if (!normalizedEventName) {
            throw new Error("LoopAdEventSDK requires a non-empty event name.");
        }

        // Segment/PostHog/Amplitude keep capture separate from transport. This
        // MVP keeps that boundary, but intentionally drops pre-identity events
        // because Loop Ad only records logged-in activity.
        const draft = this.draft(normalizedEventName, fields, previousUrl, elementInfo);
        const identity = this.config.identity;

        if (!identity) {
            warn(this.config.debug, "LoopAdEventSDK dropped an event because identity is not set.");
            return;
        }

        this.send(this.payload(draft, identity));
    }

    private draft(
        eventName: string,
        fields: TrackFields,
        previousUrl?: string,
        elementInfo?: { [key: string]: EventPropertyValue }
    ): EventDraft {
        const properties: EventProperties = {
            ...(fields.properties ?? {}),
            page: page(previousUrl),
            sdk: { name: SDK_NAME, version }
        };

        if (elementInfo) {
            properties.element = elementInfo;
        }

        return {
            eventName,
            eventId: text(fields.eventId) ?? id("evt"),
            eventTime: eventTime(fields.eventTime),
            context: cleanContext({ ...this.config.context, ...fields }),
            properties
        };
    }

    private payload(draft: EventDraft, identity: Identity): LoopAdEventPayload {
        const context = draft.context;

        return {
            project_id: this.config.projectId,
            event_id: draft.eventId,
            user_id: identity.userId,
            session_id: identity.sessionId,
            event_time: draft.eventTime,
            event_name: draft.eventName,
            channel: text(context.channel) ?? "",
            campaign_id: text(context.campaignId) ?? "",
            age_group: text(context.ageGroup) ?? "",
            gender: text(context.gender) ?? "",
            device: text(context.device) ?? "",
            category: text(context.category) ?? "",
            product_id: text(context.productId) ?? "",
            inventory_status: text(context.inventoryStatus) ?? "",
            price: money(context.price),
            quantity: quantity(context.quantity),
            revenue: money(context.revenue),
            coupon_id: text(context.couponId) ?? "",
            order_id: text(context.orderId) ?? "",
            experiment_id: text(context.experimentId) ?? "",
            variant_id: text(context.variantId) ?? "",
            action_id: text(context.actionId) ?? "",
            mapping_id: text(context.mappingId) ?? "",
            ad_id: text(context.adId) ?? "",
            creative_id: text(context.creativeId) ?? "",
            bandit_policy_id: text(context.banditPolicyId) ?? "",
            bandit_arm_id: text(context.banditArmId) ?? "",
            bandit_decision_id: text(context.banditDecisionId) ?? "",
            reward_value: numberOrZero(context.rewardValue),
            properties_json: serialize(draft.properties)
        };
    }

    private send(payload: LoopAdEventPayload): void {
        if (typeof fetch !== "function") {
            warn(this.config.debug, "LoopAdEventSDK cannot send events because fetch is unavailable.");
            return;
        }

        void fetch(this.config.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "omit",
            keepalive: true,
            body: JSON.stringify(payload)
        }).catch((error) => warn(this.config.debug, "LoopAdEventSDK event send failed.", error));
    }

    private setIdentity(identity: Identity, context?: EventContext | null): void {
        const hadIdentity = this.config.identity !== null;
        this.config.identity = normalizeIdentity(identity);

        if (context) {
            this.setContext(context);
        }

        if (!hadIdentity && this.config.autoTrackPageViews) {
            this.trackPageView();
        }
    }

    private clearIdentity(): void {
        this.config.identity = null;
    }

    private setContext(context: EventContext): void {
        this.config.context = cleanContext({
            ...this.config.context,
            ...context
        });
    }

    private listenToDom(): void {
        if (typeof document === "undefined") {
            return;
        }

        for (const eventName of DOM_EVENTS) {
            document.addEventListener(eventName, this.handleDomEvent, true);
        }
    }

    private readonly handleDomEvent = (event: Event): void => {
        const element = closestEventElement(event.target);

        if (!element) {
            return;
        }

        const expectedEvent = domListenEvent(element);
        if (expectedEvent !== event.type) {
            return;
        }

        const eventName = text(attr(element, "data-loopad-event"));
        if (!eventName) {
            warn(this.config.debug, "LoopAdEventSDK skipped a DOM event without data-loopad-event.", element);
            return;
        }

        const fields = fieldsFromElement(element);
        const elementInfo = elementProperties(element);
        this.track(eventName, fields, undefined, elementInfo);
    };

    private patchHistory(): void {
        if (typeof history === "undefined" || typeof window === "undefined") {
            return;
        }

        this.originalPushState = history.pushState;
        this.originalReplaceState = history.replaceState;
        history.pushState = this.patchHistoryMethod("pushState");
        history.replaceState = this.patchHistoryMethod("replaceState");
        window.addEventListener("popstate", this.trackUrlChange);
        window.addEventListener("hashchange", this.trackUrlChange);
    }

    private patchHistoryMethod(method: "pushState" | "replaceState"): History["pushState"] {
        return (...args) => {
            const original = method === "pushState" ? this.originalPushState : this.originalReplaceState;
            const result = original?.apply(history, args);
            this.trackUrlChange();
            return result;
        };
    }

    private readonly trackUrlChange = (): void => {
        const nextUrl = href();

        if (!nextUrl || nextUrl === this.currentUrl) {
            return;
        }

        const previousUrl = this.currentUrl;
        this.currentUrl = nextUrl;
        this.trackPageView(previousUrl);
    };

    private trackPageView(previousUrl?: string): void {
        this.track("page_view", {}, previousUrl);
    }

    private destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;

        if (typeof document !== "undefined") {
            for (const eventName of DOM_EVENTS) {
                document.removeEventListener(eventName, this.handleDomEvent, true);
            }
        }

        if (typeof window !== "undefined") {
            window.removeEventListener("popstate", this.trackUrlChange);
            window.removeEventListener("hashchange", this.trackUrlChange);
        }

        if (typeof history !== "undefined") {
            if (this.originalPushState) history.pushState = this.originalPushState;
            if (this.originalReplaceState) history.replaceState = this.originalReplaceState;
        }

        if (active === this) {
            active = null;
        }
    }
}

interface DefaultInitOptions {
    projectId: string;
    endpoint: string;
    identity: Identity | null;
    debug: boolean;
    autoTrackPageViews: boolean;
    collectDomEvents: boolean;
    context: EventContext;
}

interface EventDraft {
    eventName: string;
    eventId: string;
    eventTime: string;
    context: EventContext;
    properties: EventProperties;
}

const SDK_NAME = "loop-ad_event_sdk";
const DEFAULT_ENDPOINT = "https://ingest.dev.loop-ad.org";
const DOM_SELECTOR = "[data-loopad-event]";
const DOM_EVENTS = ["click", "change", "submit"] as const;
const TEXT_LIMIT_BYTES = 160;

let active: Runtime | null = null;

function withDefaultInitOptions(options: InitOptions): DefaultInitOptions {
    const projectId = text(options?.projectId);

    if (!projectId) {
        throw new Error("LoopAdEventSDK requires a non-empty projectId.");
    }

    const context = cleanContext(options.context ?? {});
    if (!context.device) {
        context.device = detectDevice() ?? null;
    }

    return {
        projectId,
        endpoint: endpoint(options.endpoint),
        identity: identityFromInit(options),
        debug: options.debug ?? false,
        autoTrackPageViews: options.autoTrackPageViews ?? true,
        collectDomEvents: options.collectDomEvents ?? true,
        context
    };
}

function identityFromInit(options: InitOptions): Identity | null {
    if (options.identity) {
        return normalizeIdentity(options.identity);
    }

    return null;
}

function normalizeIdentity(identity: Identity): Identity {
    const userId = text(identity.userId);
    const sessionId = text(identity.sessionId);

    if (!userId || !sessionId) {
        throw new Error("LoopAdEventSDK requires non-empty userId and sessionId.");
    }

    return { userId, sessionId };
}

function cleanContext(context: EventContext): EventContext {
    return {
        channel: text(context.channel) ?? null,
        campaignId: text(context.campaignId) ?? null,
        ageGroup: text(context.ageGroup) ?? null,
        gender: text(context.gender) ?? null,
        device: text(context.device) ?? null,
        category: text(context.category) ?? null,
        productId: text(context.productId) ?? null,
        inventoryStatus: text(context.inventoryStatus) ?? null,
        price: numberOrNull(context.price),
        quantity: numberOrNull(context.quantity),
        revenue: numberOrNull(context.revenue),
        couponId: text(context.couponId) ?? null,
        orderId: text(context.orderId) ?? null,
        experimentId: text(context.experimentId) ?? null,
        variantId: text(context.variantId) ?? null,
        actionId: text(context.actionId) ?? null,
        mappingId: text(context.mappingId) ?? null,
        adId: text(context.adId) ?? null,
        creativeId: text(context.creativeId) ?? null,
        banditPolicyId: text(context.banditPolicyId) ?? null,
        banditArmId: text(context.banditArmId) ?? null,
        banditDecisionId: text(context.banditDecisionId) ?? null,
        rewardValue: numberOrNull(context.rewardValue)
    };
}

function endpoint(value: string | null | undefined): string {
    const candidate = text(value) ?? DEFAULT_ENDPOINT;

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            throw new Error("unsupported protocol");
        }
        return parsed.toString();
    } catch {
        throw new Error("LoopAdEventSDK endpoint must be an http(s) URL.");
    }
}

function fieldsFromElement(element: Element): TrackFields {
    const fields: Record<string, unknown> = {};

    for (const [key, attribute] of TEXT_ATTRIBUTES) {
        const value = attr(element, attribute);
        if (value) fields[key] = value;
    }

    for (const [key, attribute] of NUMBER_ATTRIBUTES) {
        const value = numberOrNull(attr(element, attribute));
        if (value !== null) fields[key] = value;
    }

    const properties = domProperties(element);
    if (Object.keys(properties).length > 0) {
        fields.properties = properties;
    }

    return fields as TrackFields;
}

function closestEventElement(target: EventTarget | null): Element | null {
    const element = isElement(target) ? target : null;
    return element?.closest(DOM_SELECTOR) ?? null;
}

function domListenEvent(element: Element): string {
    const explicit = attr(element, "data-loopad-listen");
    if (explicit) return explicit;

    const tag = element.tagName.toLowerCase();
    const type = attr(element, "type") ?? "text";

    if (tag === "form") return "submit";
    if (tag === "select") return "change";
    if (tag === "input" && ["checkbox", "radio"].includes(type)) return "change";
    return "click";
}

function domProperties(element: Element): EventProperties {
    const properties: EventProperties = {};

    // PostHog autocapture uses allowlisted attributes instead of form values.
    // We keep the same privacy shape with explicit data-loopad-prop-* only.
    for (const attributeName of attributeNames(element)) {
        if (!attributeName.startsWith("data-loopad-prop-")) {
            continue;
        }

        const propertyName = attributeName.slice("data-loopad-prop-".length).replace(/-/g, "_");
        if (!propertyName) {
            continue;
        }

        const value = attr(element, attributeName);
        if (value !== null) {
            properties[propertyName] = value;
        }
    }

    return properties;
}

function attributeNames(element: Element): string[] {
    // Mature browser SDKs carry old-browser fallbacks around DOM utilities.
    // getAttributeNames() is modern; attributes is the safe fallback.
    if (typeof element.getAttributeNames === "function") {
        return element.getAttributeNames();
    }

    return Array.from(element.attributes ?? []).map((attribute) => attribute.name);
}

function collectText(element: Element): string | undefined {
    // Autocapture SDKs avoid arbitrary visible text by default. Loop Ad only
    // collects text when the integrator explicitly opts in on the element.
    const label = attr(element, "data-loopad-label");
    const textValue =
        label ??
        (element.getAttribute("data-loopad-text") === "true"
            ? element.textContent?.trim().replace(/\s+/g, " ")
            : undefined);

    return textValue ? truncateUtf8(textValue, TEXT_LIMIT_BYTES) : undefined;
}

function elementProperties(element: Element): { [key: string]: EventPropertyValue } {
    const elementInfo: { [key: string]: EventPropertyValue } = {
        tag: element.tagName.toLowerCase()
    };
    const idValue = attr(element, "id");
    const loopadId = attr(element, "data-loopad-id");
    const label = attr(element, "data-loopad-label");
    const textValue = collectText(element);

    if (idValue) elementInfo.id = idValue;
    if (loopadId) elementInfo.loopad_id = loopadId;
    if (label) elementInfo.label = label;
    if (textValue) elementInfo.text = textValue;

    return elementInfo;
}

function page(previousUrl?: string): EventProperties {
    return {
        url: href(),
        path: typeof location === "undefined" ? "" : location.pathname,
        title: typeof document === "undefined" ? "" : document.title,
        referrer: typeof document === "undefined" ? "" : document.referrer,
        ...(previousUrl ? { previous_url: previousUrl } : {})
    };
}

function href(): string {
    return typeof location === "undefined" ? "" : location.href;
}

function eventTime(value: TrackFields["eventTime"]): string {
    // Accept Date, epoch millis, or caller-provided ISO-ish strings, mirroring
    // common analytics SDK input leniency while normalizing generated values.
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }

    const stringValue = text(value);
    return stringValue ?? new Date().toISOString();
}

function text(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }

    const normalized = String(value).trim();
    return normalized || undefined;
}

function money(value: unknown): number {
    const normalized = numberOrZero(value);
    return Math.round(normalized * 100) / 100;
}

function quantity(value: unknown): number {
    return Math.max(0, Math.trunc(numberOrZero(value)));
}

function numberOrZero(value: unknown): number {
    const normalized = numberOrNull(value);
    return normalized ?? 0;
}

function numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const normalized = typeof value === "number" ? value : Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

function isElement(value: unknown): value is Element {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Node).nodeType === 1 &&
        typeof (value as Element).getAttribute === "function"
    );
}

function id(prefix: string): string {
    // Prefer crypto.randomUUID(), with a non-crypto fallback for older test and
    // browser environments. Event IDs are for dedupe, not authentication.
    const value =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return `${prefix}_${value}`;
}

function attr(element: Element, name: string): string | null {
    return element.getAttribute(name)?.trim() || null;
}

function detectDevice(): string | undefined {
    if (typeof navigator === "undefined") {
        return undefined;
    }

    const ua = navigator.userAgent.toLowerCase();
    if (/ipad|tablet/.test(ua)) return "tablet";
    if (/mobi|iphone|android/.test(ua)) return "mobile";
    return "desktop";
}

function serialize(properties: EventProperties): string {
    try {
        return JSON.stringify(properties);
    } catch {
        return "{}";
    }
}

function truncateUtf8(value: string, maxBytes: number): string {
    // Limit by UTF-8 bytes and avoid splitting a multi-byte code point.
    const bytes = new TextEncoder().encode(value);
    if (bytes.length <= maxBytes) return value;

    let end = maxBytes;
    while (end > 0) {
        const byte = bytes[end];
        if (byte === undefined || (byte & 0b1100_0000) !== 0b1000_0000) break;
        end -= 1;
    }

    return new TextDecoder().decode(bytes.slice(0, end));
}

function warn(debug: boolean, message: string, ...details: unknown[]): void {
    if (debug) {
        console.warn(message, ...details);
    }
}

const TEXT_ATTRIBUTES = [
    ["channel", "data-loopad-channel"],
    ["campaignId", "data-loopad-campaign-id"],
    ["ageGroup", "data-loopad-age-group"],
    ["gender", "data-loopad-gender"],
    ["device", "data-loopad-device"],
    ["category", "data-loopad-category"],
    ["productId", "data-loopad-product-id"],
    ["inventoryStatus", "data-loopad-inventory-status"],
    ["couponId", "data-loopad-coupon-id"],
    ["orderId", "data-loopad-order-id"],
    ["experimentId", "data-loopad-experiment-id"],
    ["variantId", "data-loopad-variant-id"],
    ["actionId", "data-loopad-action-id"],
    ["mappingId", "data-loopad-mapping-id"],
    ["adId", "data-loopad-ad-id"],
    ["creativeId", "data-loopad-creative-id"],
    ["banditPolicyId", "data-loopad-bandit-policy-id"],
    ["banditArmId", "data-loopad-bandit-arm-id"],
    ["banditDecisionId", "data-loopad-bandit-decision-id"]
] as const;

const NUMBER_ATTRIBUTES = [
    ["price", "data-loopad-price"],
    ["quantity", "data-loopad-quantity"],
    ["revenue", "data-loopad-revenue"],
    ["rewardValue", "data-loopad-reward-value"]
] as const;
