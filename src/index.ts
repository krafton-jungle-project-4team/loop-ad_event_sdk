/**
 * SDK가 허용하는 JSON 안전 custom property 값입니다.
 *
 * 일반 JavaScript에서는 이 범위를 벗어난 값도 들어올 수 있지만, 최종
 * properties 객체를 JSON으로 만들 수 없으면 `serialize()`가 `{}`로 대체합니다.
 */
export type EventPropertyValue =
    | string
    | number
    | boolean
    | null
    | EventPropertyValue[]
    | { [key: string]: EventPropertyValue };

/**
 * ClickHouse `properties_json`에 저장할 추가 이벤트 속성입니다.
 *
 * 분석에는 필요하지만 전용 top-level 컬럼이 없는 값을 여기에 넣습니다.
 */
export interface EventProperties {
    [key: string]: EventPropertyValue;
}

/**
 * ClickHouse `events` flat column으로 매핑되는 공통 이벤트 context입니다.
 *
 * `init({ context })`는 기본값을 제공하고, `setIdentity(identity, context)`는
 * 로그인 이후 공유 context를 갱신할 수 있으며, `track(name, fields)`는 단일 이벤트의
 * 값을 덮어쓸 수 있습니다.
 */
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

/**
 * host service가 전달하는 로그인 사용자 식별자입니다.
 *
 * SDK는 anonymous id를 만들지 않습니다. `userId`와 `sessionId`가
 * 모두 준비된 뒤에만 이벤트를 전송합니다.
 */
export interface Identity {
    userId: string;
    sessionId: string;
}

/**
 * `track()`이 받는 이벤트별 필드입니다.
 *
 * 이벤트명은 일반 문자열입니다. 문서에서는 `product_view` 같은 표준 이름을
 * 권장하지만, custom event name도 의도적으로 허용합니다.
 */
export interface TrackFields extends EventContext {
    eventId?: string | null;
    eventTime?: string | number | Date | null;
    properties?: EventProperties | null;
}

/**
 * SDK 시작 옵션입니다.
 *
 * Event Collector ingest domain은 `loop-ad_infra`의 `service-endpoints.md`에
 * 고정된 값이므로 SDK 옵션으로 덮어쓸 수 없습니다.
 */
export interface InitOptions {
    projectId: string;
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
    /**
     * 표준 이벤트나 custom event를 수집합니다.
     *
     * identity가 없으면 이벤트를 queue에 넣지 않고 drop합니다. 로그인 이전 활동이
     * 나중에 로그인한 사용자에게 붙는 것을 막기 위한 정책입니다.
     */
    track(eventName: string, fields?: TrackFields): void;
    /**
     * 로그인 identity와 선택적인 공유 context를 설정합니다.
     *
     * identity가 처음 준비되는 순간 page auto-tracking이 켜져 있으면 현재 페이지를
     * `page_view`로 1회 기록합니다.
     */
    setIdentity(identity: Identity, context?: EventContext | null): void;
    /**
     * 로그아웃 시 identity를 비웁니다.
     *
     * host service가 다시 `setIdentity()`를 호출하기 전까지 이후 이벤트는 drop됩니다.
     */
    clearIdentity(): void;
    /**
     * DOM listener와 history listener를 제거합니다.
     *
     * 테스트, hot reload, microfrontend unmount에서 정리 용도로 사용합니다.
     */
    destroy(): void;
}

/** 빌드 시점에 주입되는 SDK 패키지 버전입니다. */
export const version =
    typeof __SDK_VERSION__ === "string" ? __SDK_VERSION__ : "0.1.0";

/**
 * Loop Ad browser SDK를 시작합니다.
 *
 * `init()`은 옵션에 따라 DOM 수집 listener와 SPA page-view listener를 설치한 뒤
 * 작은 runtime client를 반환합니다. 이미 실행 중인 상태에서 다시 호출하면 기존
 * active client를 반환합니다.
 */
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

/**
 * SDK runtime 상태와 browser listener를 소유합니다.
 *
 * public client는 이 클래스에 위임하지만, `Runtime` 자체는 private으로 유지해서
 * 배포 API 표면을 작게 유지합니다.
 */
class Runtime {
    readonly client: LoopAdEventSdkClient = Object.freeze({
        track: (eventName: string, fields?: TrackFields) => this.track(eventName, fields),
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

    /** 설정된 listener를 설치하고 가능한 경우 초기 page view를 전송합니다. */
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

    /**
     * 이벤트 하나를 정규화하고 identity gate를 통과시킨 뒤 전송합니다.
     *
     * public `track()`, DOM autocapture, 내부 page-view tracking이 모두 사용하는
     * 중심 수집 경로입니다.
     */
    private track(
        eventName: string,
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

        // Segment/PostHog/Amplitude처럼 capture와 transport를 분리합니다.
        // 다만 Loop Ad는 로그인 활동만 기록하므로 identity 이전 이벤트는 의도적으로
        // drop합니다.
        const draft = this.draft(normalizedEventName, fields, previousUrl, elementInfo);
        const identity = this.config.identity;

        if (!identity) {
            warn(this.config.debug, "LoopAdEventSDK dropped an event because identity is not set.");
            return;
        }

        this.send(this.payload(draft, identity));
    }

    /**
     * identity와 transport를 적용하기 전 내부 event draft를 만듭니다.
     *
     * capture, payload shaping, sending 단계를 분리하기 위한 중간 표현입니다.
     */
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

    /** 내부 draft를 ClickHouse 형태의 collector payload로 변환합니다. */
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

    /** 고정 Event Collector ingest endpoint로 이벤트 하나를 전송합니다. */
    private send(payload: LoopAdEventPayload): void {
        if (typeof fetch !== "function") {
            warn(this.config.debug, "LoopAdEventSDK cannot send events because fetch is unavailable.");
            return;
        }

        void fetch(INGEST_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "omit",
            keepalive: true,
            body: JSON.stringify(payload)
        }).catch((error) => warn(this.config.debug, "LoopAdEventSDK event send failed.", error));
    }

    /**
     * 로그인 identity를 저장하고 선택적으로 공유 context를 갱신합니다.
     *
     * 첫 identity 전환 시 현재 페이지를 자동 기록하므로 public `pageView()` API가
     * 필요하지 않습니다.
     */
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

    /** 로그아웃 이후 이벤트가 미래 사용자에게 붙지 않도록 identity를 제거합니다. */
    private clearIdentity(): void {
        this.config.identity = null;
    }

    /** 이후 이벤트에 사용할 공유 context를 병합합니다. */
    private setContext(context: EventContext): void {
        this.config.context = cleanContext({
            ...this.config.context,
            ...context
        });
    }

    /** annotation이 붙은 요소를 수집하기 위해 document-level delegation을 등록합니다. */
    private listenToDom(): void {
        if (typeof document === "undefined") {
            return;
        }

        for (const eventName of DOM_EVENTS) {
            document.addEventListener(eventName, this.handleDomEvent, true);
        }
    }

    /** 위임된 DOM event를 SDK event로 변환합니다. */
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

    /** SPA URL 변경이 page view를 만들 수 있도록 History API를 patch합니다. */
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

    /** 원래 동작을 보존하면서 History API method 하나를 감쌉니다. */
    private patchHistoryMethod(method: "pushState" | "replaceState"): History["pushState"] {
        return (...args) => {
            const original = method === "pushState" ? this.originalPushState : this.originalReplaceState;
            const result = original?.apply(history, args);
            this.trackUrlChange();
            return result;
        };
    }

    /** 브라우저 URL이 실제로 바뀐 경우에만 page view를 기록합니다. */
    private readonly trackUrlChange = (): void => {
        const nextUrl = href();

        if (!nextUrl || nextUrl === this.currentUrl) {
            return;
        }

        const previousUrl = this.currentUrl;
        this.currentUrl = nextUrl;
        this.trackPageView(previousUrl);
    };

    /** 현재 페이지를 표준 `page_view` 이벤트로 수집합니다. */
    private trackPageView(previousUrl?: string): void {
        this.track("page_view", {}, previousUrl);
    }

    /** listener를 제거하고 patch한 browser API를 원복합니다. */
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
const INGEST_ENDPOINT = "https://ingest.dev.loop-ad.org";
const DOM_SELECTOR = "[data-loopad-event]";
const DOM_EVENTS = ["click", "change", "submit"] as const;
const TEXT_LIMIT_BYTES = 160;

let active: Runtime | null = null;

/**
 * 시작 옵션을 완성된 runtime config로 정규화합니다.
 *
 * ingest domain은 application runtime 설정이 아니라 infra contract이므로 endpoint
 * 옵션은 의도적으로 받지 않습니다.
 */
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
        identity: identityFromInit(options),
        debug: options.debug ?? false,
        autoTrackPageViews: options.autoTrackPageViews ?? true,
        collectDomEvents: options.collectDomEvents ?? true,
        context
    };
}

/** 시작 시 전달된 identity를 해석하고, 로그인 전이면 `null`을 반환합니다. */
function identityFromInit(options: InitOptions): Identity | null {
    if (options.identity) {
        return normalizeIdentity(options.identity);
    }

    return null;
}

// 참고: Amplitude는 identity/session 할당을 이벤트 payload에서 추론하지 않고
// 명시적인 SDK 작업으로 분리합니다.
// https://github.com/amplitude/Amplitude-TypeScript/blob/main/packages/analytics-core/src/core-client.ts
function normalizeIdentity(identity: Identity): Identity {
    const userId = text(identity.userId);
    const sessionId = text(identity.sessionId);

    if (!userId || !sessionId) {
        throw new Error("LoopAdEventSDK requires non-empty userId and sessionId.");
    }

    return { userId, sessionId };
}

// 참고: 성숙한 분석 SDK들은 payload shaping 전에 작은 context 객체를 정규화해서
// transport payload 생성을 예측 가능하게 유지합니다.
// https://github.com/amplitude/Amplitude-TypeScript/blob/main/packages/analytics-core/src/core-client.ts
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

// 참고: PostHog autocapture는 allowlist된 DOM metadata만 추출하고 기본적으로
// 민감한 form value를 피합니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
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

// 참고: PostHog autocapture는 후보 node마다 handler를 등록하지 않고 event target에서
// matching element까지 탐색합니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
function closestEventElement(target: EventTarget | null): Element | null {
    const element = isElement(target) ? target : null;
    return element?.closest(DOM_SELECTOR) ?? null;
}

// 참고: PostHog autocapture는 element 형태로 browser event type을 판단하고
// form/select control을 click-only element와 다르게 다룹니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
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

// 참고: PostHog autocapture는 임의 DOM state를 직렬화하지 않고 안전한 element
// attribute/property 목록을 명시적으로 유지합니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
function domProperties(element: Element): EventProperties {
    const properties: EventProperties = {};

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

// 참고: PostHog autocapture는 element metadata 수집 시 구형 browser guard를 둡니다.
// 이 함수도 modern API와 fallback 형태를 함께 둡니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
function attributeNames(element: Element): string[] {
    if (typeof element.getAttributeNames === "function") {
        return element.getAttributeNames();
    }

    return Array.from(element.attributes ?? []).map((attribute) => attribute.name);
}

// 참고: visible text에는 민감한 사용자 데이터가 섞일 수 있어 PostHog autocapture도
// text capture에 보수적입니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
function collectText(element: Element): string | undefined {
    const label = attr(element, "data-loopad-label");
    const textValue =
        label ??
        (element.getAttribute("data-loopad-text") === "true"
            ? element.textContent?.trim().replace(/\s+/g, " ")
            : undefined);

    return textValue ? truncateUtf8(textValue, TEXT_LIMIT_BYTES) : undefined;
}

// 참고: PostHog autocapture는 DOM node를 직접 직렬화하지 않고 작은 element 설명만
// 기록합니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
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

// 참고: PostHog와 Amplitude는 integrator가 직접 넘기도록 요구하지 않고 page event에
// page/location metadata를 붙입니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
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

// 참고: Amplitude의 event construction은 caller event option을 받으면서도
// SDK가 생성한 timestamp를 정규화합니다.
// https://github.com/amplitude/Amplitude-TypeScript/blob/main/packages/analytics-core/src/core-client.ts
function eventTime(value: TrackFields["eventTime"]): string {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return value.toISOString();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }

    const stringValue = text(value);
    return stringValue ?? new Date().toISOString();
}

// 참고: accounting.js는 숫자 처리 전에 사람이 입력한 값을 trim/coerce합니다.
// 이 helper도 payload shaping 전에 empty string을 안전하게 처리합니다.
// https://github.com/openexchangerates/accounting.js/blob/master/accounting.js
function text(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }

    const normalized = String(value).trim();
    return normalized || undefined;
}

// 참고: currency.js는 금액을 precision-normalized finite number로 다룹니다.
// SDK도 ClickHouse price/revenue 값을 숫자로 유지하고 cent 단위로 반올림합니다.
// https://github.com/scurker/currency.js/blob/main/src/currency.js
function money(value: unknown): number {
    const normalized = numberOrZero(value);
    return Math.round(normalized * 100) / 100;
}

// 참고: accounting.js/currency.js는 formatted money output에 NaN/Infinity가 새지 않게
// 방어합니다. quantity도 같은 finite-number guard 경로를 사용합니다.
// https://github.com/openexchangerates/accounting.js/blob/master/accounting.js
function quantity(value: unknown): number {
    return Math.max(0, Math.trunc(numberOrZero(value)));
}

// 참고: accounting.js는 unformat/toFixed 경로에서 잘못된 numeric input을 안전한
// fallback으로 정규화합니다. 이 함수도 payload field를 ClickHouse 친화적으로 유지합니다.
// https://github.com/openexchangerates/accounting.js/blob/master/accounting.js
function numberOrZero(value: unknown): number {
    const normalized = numberOrNull(value);
    return normalized ?? 0;
}

// 참고: currency.js는 precision 처리 전에 외부 값을 parse하고 invalid number를
// 거릅니다. 이 helper는 SDK의 numeric gate입니다.
// https://github.com/scurker/currency.js/blob/main/src/currency.js
function numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const normalized = typeof value === "number" ? value : Number(value);
    return Number.isFinite(normalized) ? normalized : null;
}

// 참고: PostHog autocapture는 DOM attribute를 읽기 전에 EventTarget/Element 형태를
// 방어적으로 확인합니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
function isElement(value: unknown): value is Element {
    return (
        typeof value === "object" &&
        value !== null &&
        (value as Node).nodeType === 1 &&
        typeof (value as Element).getAttribute === "function"
    );
}

// 참고: uuid v4는 crypto 기반 randomness를 우선합니다. 이 SDK도 가능하면
// crypto.randomUUID를 쓰고, test/legacy 환경에서만 fallback을 사용합니다.
// https://github.com/uuidjs/uuid/blob/main/src/v4.ts
function id(prefix: string): string {
    const value =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return `${prefix}_${value}`;
}

// 참고: PostHog autocapture는 event property에 넣기 전에 DOM attribute를 trim/filter합니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
function attr(element: Element, name: string): string | null {
    return element.getAttribute(name)?.trim() || null;
}

// 참고: 분석 SDK들은 user-agent 기반 device detection을 authoritative identity나
// targeting data가 아니라 best-effort fallback으로 다룹니다.
// https://github.com/amplitude/Amplitude-TypeScript/blob/main/packages/analytics-browser/src/browser-client.ts
function detectDevice(): string | undefined {
    if (typeof navigator === "undefined") {
        return undefined;
    }

    const ua = navigator.userAgent.toLowerCase();
    if (/ipad|tablet/.test(ua)) return "tablet";
    if (/mobi|iphone|android/.test(ua)) return "mobile";
    return "desktop";
}

// 참고: 성숙한 SDK transport는 잘못된 custom property 하나가 전체 capture path를
// 깨뜨리지 않도록 JSON serialization을 방어합니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/request-queue.ts
function serialize(properties: EventProperties): string {
    try {
        return JSON.stringify(properties);
    } catch {
        return "{}";
    }
}

// 참고: truncate-utf8-bytes는 byte limit을 적용할 때 multi-byte 문자를 중간에서
// 자르지 않도록 처리합니다.
// https://github.com/parshap/truncate-utf8-bytes/blob/master/index.js
function truncateUtf8(value: string, maxBytes: number): string {
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

/**
 * DOM autocapture에서 문자열 context로 읽을 `data-loopad-*` attribute 매핑입니다.
 *
 * 각 tuple은 `[TrackFields key, HTML attribute name]` 형태입니다.
 * `fieldsFromElement()`가 이 표를 순회해 명시적으로 붙은 attribute만 읽고,
 * 값이 비어 있지 않을 때만 event fields에 복사합니다.
 */
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

/**
 * DOM autocapture에서 숫자로 해석할 `data-loopad-*` attribute 매핑입니다.
 *
 * 숫자 field는 `numberOrNull()`을 통과한 finite number만 event fields에 들어갑니다.
 * 이후 payload 생성 시 `price`와 `revenue`는 `money()`로, `quantity`는 `quantity()`로
 * 다시 정규화되어 ClickHouse에 안전한 숫자로 전송됩니다.
 */
const NUMBER_ATTRIBUTES = [
    ["price", "data-loopad-price"],
    ["quantity", "data-loopad-quantity"],
    ["revenue", "data-loopad-revenue"],
    ["rewardValue", "data-loopad-reward-value"]
] as const;
