/**
 * Tracking Plan으로 검증할 JSON 안전 이벤트 속성 값입니다.
 *
 * `null`, non-finite number, class instance처럼 현재 Tracking Plan subset이 표현하지
 * 못하는 값은 runtime 검증에서 거부합니다.
 */
export type EventPropertyValue =
    | string
    | number
    | boolean
    | EventPropertyValue[]
    | { [key: string]: EventPropertyValue };

/**
 * `track()`과 SDK context가 받는 범용 이벤트 속성입니다.
 */
export interface EventProperties {
    [key: string]: EventPropertyValue;
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
 * `track()`의 이벤트 envelope 옵션입니다. 이벤트 속성과 분리해서 전달합니다.
 */
export interface TrackOptions {
    eventId?: string;
    eventTime?: string | number | Date;
}

/**
 * SDK 시작 옵션입니다.
 *
 * connection 초기화는 Dashboard 응답의 Collector URL과 Tracking Plan snapshot을
 * 사용합니다.
 */
export interface InitOptions {
    connectionUrl: string;
    identity?: Identity | null;
    debug?: boolean | null;
    autoTrackPageViews?: boolean | null;
    collectDomEvents?: boolean | null;
    context?: EventProperties | null;
}

interface LoopAdEventPayload {
    project_id: string;
    write_key: string;
    schema_version: string;
    event_id: string;
    event_name: string;
    event_time: string;
    source: "browser_sdk";
    user_id: string;
    session_id: string;
    properties_json: string;
}

export interface LoopAdEventSdkClient {
    /**
     * 표준 이벤트나 custom event를 수집합니다.
     *
     * identity가 없으면 이벤트를 queue에 넣지 않고 drop합니다. 로그인 이전 활동이
     * 나중에 로그인한 사용자에게 붙는 것을 막기 위한 정책입니다.
     */
    track(eventName: string, properties?: EventProperties, options?: TrackOptions): void;
    /**
     * 로그인 identity와 선택적인 공유 context를 설정합니다.
     *
     * identity가 처음 준비되는 순간 page auto-tracking이 켜져 있으면 현재 페이지를
     * `page_view`로 1회 기록합니다.
     */
    setIdentity(identity: Identity, context?: EventProperties | null): void;
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
export async function init(options: InitOptions): Promise<LoopAdEventSdkClient> {
    const connectionUrl = requiredHttpUrl(options.connectionUrl, "connectionUrl");
    const connection = await loadConnection(connectionUrl);
    return startRuntime(withConnectionInitOptions(options, connection));
}

function startRuntime(initOptions: DefaultInitOptions): LoopAdEventSdkClient {

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
        track: (eventName: string, properties?: EventProperties, options?: TrackOptions) =>
            this.track(eventName, properties, options),
        setIdentity: (identity: Identity, context?: EventProperties | null) =>
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
        properties: EventProperties = {},
        options: TrackOptions = {},
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

        const identity = this.config.identity;

        if (!identity) {
            warn(this.config.debug, "LoopAdEventSDK dropped an event because identity is not set.");
            return;
        }

        if (!isPlainObject(properties)) {
            warn(this.config.debug, "LoopAdEventSDK dropped an event because properties must be a plain object.");
            return;
        }

        const userProperties = {
            ...this.config.baseContext,
            ...this.config.identityContext,
            ...properties
        } as EventProperties;
        const validationErrors = validateEventProperties(
            normalizedEventName,
            userProperties,
            this.config.events
        );
        if (validationErrors.length > 0) {
            warn(this.config.debug, "LoopAdEventSDK dropped an event that violates the Tracking Plan.", {
                eventName: normalizedEventName,
                reasons: validationErrors
            });
            return;
        }

        const draft = this.draft(
            normalizedEventName,
            userProperties,
            options,
            previousUrl,
            elementInfo
        );
        this.send(this.payload(draft, identity));
    }

    /**
     * identity와 transport를 적용하기 전 내부 event draft를 만듭니다.
     *
     * capture, payload shaping, sending 단계를 분리하기 위한 중간 표현입니다.
     */
    private draft(
        eventName: string,
        userProperties: EventProperties,
        options: TrackOptions,
        previousUrl?: string,
        elementInfo?: { [key: string]: EventPropertyValue }
    ): EventDraft {
        const pageInfo = page(previousUrl);
        const properties: EventProperties = {
            ...userProperties,
            page_path: text(pageInfo.path) ?? "",
            page: pageInfo,
            sdk: { name: SDK_NAME, version }
        };

        if (elementInfo) {
            properties.element = elementInfo;
        }

        return {
            eventName,
            eventId: text(options.eventId) ?? id("evt"),
            eventTime: eventTime(options.eventTime),
            properties
        };
    }

    /** 내부 draft를 ClickHouse 형태의 collector payload로 변환합니다. */
    private payload(draft: EventDraft, identity: Identity): LoopAdEventPayload {
        return {
            project_id: this.config.projectId,
            write_key: this.config.writeKey,
            schema_version: this.config.schemaVersion,
            event_id: draft.eventId,
            event_name: draft.eventName,
            event_time: draft.eventTime,
            source: SOURCE,
            user_id: identity.userId,
            session_id: identity.sessionId,
            properties_json: serialize(draft.properties)
        };
    }

    /** 설정된 Event Collector ingest endpoint로 이벤트 하나를 전송합니다. */
    private send(payload: LoopAdEventPayload): void {
        if (typeof fetch !== "function") {
            warn(this.config.debug, "LoopAdEventSDK cannot send events because fetch is unavailable.");
            return;
        }

        const body = JSON.stringify(payload);
        if (utf8ByteLength(body) > MAX_REQUEST_BODY_BYTES) {
            warn(this.config.debug, "LoopAdEventSDK dropped an event because the request body is too large.");
            return;
        }

        void fetch(this.config.collectorUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "omit",
            keepalive: true,
            body
        })
            .then((response) => {
                if (!response.ok) {
                    warn(this.config.debug, `LoopAdEventSDK event send failed with HTTP ${response.status}.`);
                }
            })
            .catch((error) => warn(this.config.debug, "LoopAdEventSDK event send failed.", error));
    }

    /**
     * 로그인 identity를 저장하고 선택적으로 공유 context를 갱신합니다.
     *
     * 첫 identity 전환 시 현재 페이지를 자동 기록하므로 public `pageView()` API가
     * 필요하지 않습니다.
     */
    private setIdentity(identity: Identity, context?: EventProperties | null): void {
        const hadIdentity = this.config.identity !== null;
        this.config.identity = normalizeIdentity(identity);
        this.config.identityContext = context ? copyPropertyObject(context) : {};

        if (!hadIdentity && this.config.autoTrackPageViews) {
            this.trackPageView();
        }
    }

    /** 로그아웃 이후 이벤트가 미래 사용자에게 붙지 않도록 identity를 제거합니다. */
    private clearIdentity(): void {
        this.config.identity = null;
        this.config.identityContext = {};
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

        const parsed = propertiesFromElement(element);
        if (!parsed.ok) {
            warn(this.config.debug, "LoopAdEventSDK dropped a DOM event with invalid data-loopad-properties.", {
                eventName,
                reason: parsed.reason
            });
            return;
        }
        const elementInfo = elementProperties(element);
        this.track(eventName, parsed.properties, {}, undefined, elementInfo);
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
        this.track("page_view", {}, {}, previousUrl);
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
    writeKey: string;
    identity: Identity | null;
    debug: boolean;
    autoTrackPageViews: boolean;
    collectDomEvents: boolean;
    baseContext: EventProperties;
    identityContext: EventProperties;
    collectorUrl: string;
    schemaVersion: string;
    events: ReadonlyMap<string, TrackingPlanEvent>;
}

interface EventDraft {
    eventName: string;
    eventId: string;
    eventTime: string;
    properties: EventProperties;
}

const SDK_NAME = "loop-ad_event_sdk";
const SOURCE = "browser_sdk";
const MAX_CONNECTION_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SCHEMA_DEPTH = 8;
const MAX_SCHEMA_NODES = 100;
const MAX_DOM_PROPERTIES_BYTES = 32 * 1024;
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const DOM_SELECTOR = "[data-loopad-event]";
const DOM_EVENTS = ["click", "change", "submit"] as const;
const TEXT_LIMIT_BYTES = 160;
const RESERVED_PROPERTY_NAMES = new Set(["page_path", "page", "sdk", "element"]);
const DANGEROUS_PROPERTY_NAMES = new Set(["__proto__", "prototype", "constructor"]);
const CREDIT_CARD_PATTERN = /^(?:(?:4[0-9]{12}(?:[0-9]{3})?)|(?:5[1-5][0-9]{14})|(?:6(?:011|5[0-9]{2})[0-9]{12})|(?:3[47][0-9]{13})|(?:3(?:0[0-5]|[68][0-9])[0-9]{11})|(?:(?:2131|1800|35[0-9]{3})[0-9]{11}))$/;
const SSN_PATTERN = /^\d{3}-?\d{2}-?\d{4}$/;

let active: Runtime | null = null;

type JsonSchemaType = "object" | "string" | "number" | "integer" | "boolean" | "array";

interface TrackingPlanSchema {
    type: JsonSchemaType;
    properties?: Readonly<Record<string, TrackingPlanSchema>>;
    required?: readonly string[];
    items?: TrackingPlanSchema;
}

interface TrackingPlanEvent {
    eventName: string;
    description?: string;
    propertiesSchema: TrackingPlanSchema;
}

interface SdkConnection {
    projectId: string;
    writeKey: string;
    collectorUrl: string;
    schemaVersion: string;
    schemaUrl: string;
    revision: number;
    cacheTtlSeconds: number;
    events: readonly TrackingPlanEvent[];
}

const connectionCache = new Map<string, { value: SdkConnection; expiresAt: number }>();

function withConnectionInitOptions(
    options: InitOptions,
    connection: SdkConnection
): DefaultInitOptions {
    return {
        projectId: connection.projectId,
        writeKey: connection.writeKey,
        identity: identityFromInit(options),
        debug: options.debug ?? false,
        autoTrackPageViews: options.autoTrackPageViews ?? true,
        collectDomEvents: options.collectDomEvents ?? true,
        baseContext: options.context ? copyPropertyObject(options.context) : {},
        identityContext: {},
        collectorUrl: connection.collectorUrl,
        schemaVersion: connection.schemaVersion,
        events: new Map(connection.events.map((event) => [event.eventName, event]))
    };
}

async function loadConnection(connectionUrl: string): Promise<SdkConnection> {
    const now = Date.now();
    const cached = connectionCache.get(connectionUrl);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    if (typeof fetch !== "function") {
        throw new Error("LoopAdEventSDK connection init failed because fetch is unavailable.");
    }

    let response: Response;
    try {
        response = await fetch(connectionUrl, {
            method: "GET",
            credentials: "omit",
            headers: { Accept: "application/json" }
        });
    } catch {
        throw new Error("LoopAdEventSDK connection init failed while fetching the connection.");
    }

    if (!response.ok) {
        throw new Error(`LoopAdEventSDK connection init failed with HTTP ${response.status}.`);
    }

    let rawConnection: unknown;
    try {
        rawConnection = await response.json();
    } catch {
        throw new Error("LoopAdEventSDK connection init failed because the response is not JSON.");
    }

    const connection = parseConnection(rawConnection);
    const ttlMs = Math.min(
        MAX_CONNECTION_CACHE_TTL_MS,
        Math.max(1000, connection.cacheTtlSeconds * 1000)
    );
    connectionCache.set(connectionUrl, { value: connection, expiresAt: now + ttlMs });
    return connection;
}

function parseConnection(value: unknown): SdkConnection {
    const record = objectRecord(value, "connection response");
    const eventsValue = record.events;
    if (!Array.isArray(eventsValue)) {
        throw new Error("LoopAdEventSDK connection init failed: events must be an array.");
    }

    const events = eventsValue.map((event, index) => parseTrackingPlanEvent(event, index));
    const eventNames = new Set<string>();
    for (const event of events) {
        if (eventNames.has(event.eventName)) {
            throw new Error(`LoopAdEventSDK connection init failed: duplicate event ${event.eventName}.`);
        }
        eventNames.add(event.eventName);
    }

    const revision = positiveInteger(record.revision, "revision");
    const cacheTtlSeconds = positiveNumber(record.cacheTtlSeconds, "cacheTtlSeconds");
    return {
        projectId: requiredString(record.projectId, "projectId"),
        writeKey: requiredString(record.writeKey, "writeKey"),
        collectorUrl: requiredHttpUrl(record.collectorUrl, "collectorUrl"),
        schemaVersion: requiredString(record.schemaVersion, "schemaVersion"),
        schemaUrl: requiredHttpUrl(record.schemaUrl, "schemaUrl"),
        revision,
        cacheTtlSeconds,
        events
    };
}

function parseTrackingPlanEvent(value: unknown, index: number): TrackingPlanEvent {
    const record = objectRecord(value, `events[${index}]`);
    const description = record.description;
    if (description !== undefined && typeof description !== "string") {
        throw new Error(`LoopAdEventSDK connection init failed: events[${index}].description must be a string.`);
    }
    const propertiesSchema = parseTrackingPlanSchema(
        record.propertiesSchema,
        `events[${index}].propertiesSchema`,
        { nodes: 0 },
        0
    );
    if (propertiesSchema.type !== "object") {
        throw new Error(
            `LoopAdEventSDK connection init failed: events[${index}].propertiesSchema must be an object.`
        );
    }
    return {
        eventName: requiredString(record.eventName, `events[${index}].eventName`),
        ...(description ? { description } : {}),
        propertiesSchema
    };
}

function parseTrackingPlanSchema(
    value: unknown,
    path: string,
    state: { nodes: number },
    depth: number
): TrackingPlanSchema {
    state.nodes += 1;
    if (state.nodes > MAX_SCHEMA_NODES) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path} exceeds ${MAX_SCHEMA_NODES} schema nodes.`);
    }
    if (depth > MAX_SCHEMA_DEPTH) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path} exceeds depth ${MAX_SCHEMA_DEPTH}.`);
    }

    const record = objectRecord(value, path);
    const allowedKeys = new Set(["type", "properties", "required", "items"]);
    const unsupportedKey = Object.keys(record).find((key) => !allowedKeys.has(key));
    if (unsupportedKey) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path}.${unsupportedKey} is unsupported.`);
    }

    const type = requiredString(record.type, `${path}.type`);
    if (!(["object", "string", "number", "integer", "boolean", "array"] as string[]).includes(type)) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path}.type ${type} is unsupported.`);
    }

    if (type === "object") {
        if (record.items !== undefined) {
            throw new Error(`LoopAdEventSDK connection init failed: ${path}.items is unsupported for objects.`);
        }
        const propertiesRecord = objectRecord(record.properties ?? {}, `${path}.properties`);
        const properties: Record<string, TrackingPlanSchema> = {};
        for (const [name, schema] of Object.entries(propertiesRecord)) {
            if (!name.trim() || name !== name.trim()) {
                throw new Error(`LoopAdEventSDK connection init failed: ${path} has an invalid property name.`);
            }
            if (DANGEROUS_PROPERTY_NAMES.has(name)) {
                throw new Error(`LoopAdEventSDK connection init failed: ${path}.properties.${name} is unsafe.`);
            }
            if (depth === 0 && RESERVED_PROPERTY_NAMES.has(name)) {
                throw new Error(`LoopAdEventSDK connection init failed: ${path}.properties.${name} is reserved.`);
            }
            properties[name] = parseTrackingPlanSchema(
                schema,
                `${path}.properties.${name}`,
                state,
                depth + 1
            );
        }

        const requiredValue = record.required ?? [];
        if (!Array.isArray(requiredValue) || requiredValue.some((name) => typeof name !== "string" || !name.trim())) {
            throw new Error(`LoopAdEventSDK connection init failed: ${path}.required must be a string array.`);
        }
        const required = requiredValue as string[];
        if (required.some((name) => !Object.prototype.hasOwnProperty.call(properties, name))) {
            throw new Error(`LoopAdEventSDK connection init failed: ${path}.required references an unknown property.`);
        }
        if (new Set(required).size !== required.length) {
            throw new Error(`LoopAdEventSDK connection init failed: ${path}.required contains duplicates.`);
        }
        return { type, properties, required };
    }

    if (type === "array") {
        if (record.properties !== undefined || record.required !== undefined) {
            throw new Error(`LoopAdEventSDK connection init failed: ${path} cannot define object fields.`);
        }
        if (record.items === undefined) {
            throw new Error(`LoopAdEventSDK connection init failed: ${path}.items is required for arrays.`);
        }
        return {
            type,
            items: parseTrackingPlanSchema(record.items, `${path}.items`, state, depth + 1)
        };
    }

    if (record.properties !== undefined || record.required !== undefined || record.items !== undefined) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path} cannot define nested fields.`);
    }
    return { type: type as JsonSchemaType };
}

function validateEventProperties(
    eventName: string,
    properties: EventProperties,
    events: ReadonlyMap<string, TrackingPlanEvent>
): string[] {
    const event = events.get(eventName);
    if (!event) return [`event ${eventName} is not registered`];
    return validateSchemaValue(properties, event.propertiesSchema, "properties", 0);
}

function validateSchemaValue(
    value: unknown,
    schema: TrackingPlanSchema,
    path: string,
    depth: number,
    stack: Set<object> = new Set()
): string[] {
    switch (schema.type) {
        case "object": {
            if (!isPlainObject(value)) {
                return [`${path} must be an object`];
            }
            if (stack.has(value)) {
                return [`${path} must not be circular`];
            }
            stack.add(value);
            const record = value;
            const errors: string[] = [];
            for (const name of Object.keys(record)) {
                if (depth === 0 && RESERVED_PROPERTY_NAMES.has(name)) {
                    errors.push(`${path}.${name} is reserved`);
                } else if (DANGEROUS_PROPERTY_NAMES.has(name)) {
                    errors.push(`${path}.${name} is unsafe`);
                } else if (!Object.prototype.hasOwnProperty.call(schema.properties ?? {}, name)) {
                    errors.push(`${path}.${name} is not declared`);
                }
            }
            for (const name of schema.required ?? []) {
                if (!Object.prototype.hasOwnProperty.call(record, name) || record[name] === undefined) {
                    errors.push(`${path}.${name} is required`);
                }
            }
            for (const [name, propertySchema] of Object.entries(schema.properties ?? {})) {
                if (Object.prototype.hasOwnProperty.call(record, name) && record[name] !== undefined) {
                    errors.push(
                        ...validateSchemaValue(
                            record[name],
                            propertySchema,
                            `${path}.${name}`,
                            depth + 1,
                            stack
                        )
                    );
                }
            }
            stack.delete(value);
            return errors;
        }
        case "array": {
            if (!Array.isArray(value)) return [`${path} must be an array`];
            if (stack.has(value)) return [`${path} must not be circular`];
            stack.add(value);
            const errors = value.flatMap((item, index) =>
                validateSchemaValue(
                    item,
                    schema.items as TrackingPlanSchema,
                    `${path}[${index}]`,
                    depth + 1,
                    stack
                )
            );
            stack.delete(value);
            return errors;
        }
        case "string":
            return typeof value === "string" ? [] : [`${path} must be a string`];
        case "number":
            return typeof value === "number" && Number.isFinite(value) ? [] : [`${path} must be a number`];
        case "integer":
            return typeof value === "number" && Number.isInteger(value) ? [] : [`${path} must be an integer`];
        case "boolean":
            return typeof value === "boolean" ? [] : [`${path} must be a boolean`];
    }
}

function objectRecord(value: unknown, path: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function requiredString(value: unknown, path: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path} must be a non-empty string.`);
    }
    return value.trim();
}

function positiveNumber(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path} must be a positive number.`);
    }
    return value;
}

function positiveInteger(value: unknown, path: string): number {
    const parsed = positiveNumber(value, path);
    if (!Number.isInteger(parsed)) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path} must be an integer.`);
    }
    return parsed;
}

function requiredHttpUrl(value: unknown, path: string): string {
    const candidate = requiredString(value, path);
    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        throw new Error(`LoopAdEventSDK connection init failed: ${path} must be an absolute URL.`);
    }
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || !parsed.host) {
        throw new Error(`LoopAdEventSDK connection init failed: ${path} must be an HTTP(S) URL.`);
    }
    return parsed.href;
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

function copyPropertyObject(value: unknown): EventProperties {
    if (!isPlainObject(value)) {
        throw new Error("LoopAdEventSDK context must be a plain object.");
    }
    return { ...value } as EventProperties;
}

type DomPropertiesResult =
    | { ok: true; properties: EventProperties }
    | { ok: false; reason: string };

// PostHog처럼 DOM property는 명시적으로 opt-in한 attribute만 읽습니다. Loop Ad는
// Tracking Plan의 JSON type을 보존하기 위해 하나의 JSON object attribute를 사용합니다.
// https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts
function propertiesFromElement(element: Element): DomPropertiesResult {
    const raw = element.getAttribute("data-loopad-properties");
    if (raw === null) {
        return { ok: true, properties: {} };
    }
    if (utf8ByteLength(raw) > MAX_DOM_PROPERTIES_BYTES) {
        return { ok: false, reason: `attribute exceeds ${MAX_DOM_PROPERTIES_BYTES} bytes` };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ok: false, reason: "attribute is not valid JSON" };
    }
    if (!isPlainObject(parsed)) {
        return { ok: false, reason: "attribute root must be an object" };
    }
    if (containsSensitiveDomValue(parsed)) {
        return { ok: false, reason: "attribute contains a sensitive-looking value" };
    }
    return { ok: true, properties: { ...parsed } as EventProperties };
}

function containsSensitiveDomValue(value: unknown): boolean {
    const pending = [value];
    while (pending.length > 0) {
        const current = pending.pop();
        if (typeof current === "string") {
            const compact = current.trim().replace(/[- ]/g, "");
            if (CREDIT_CARD_PATTERN.test(compact) || SSN_PATTERN.test(current.trim())) {
                return true;
            }
        } else if (Array.isArray(current)) {
            pending.push(...current);
        } else if (isPlainObject(current)) {
            pending.push(...Object.values(current));
        }
    }
    return false;
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
function eventTime(value: TrackOptions["eventTime"]): string {
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
// crypto.randomUUID를 쓰고, 지원하지 않는 환경에서만 fallback을 사용합니다.
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

function serialize(properties: EventProperties): string {
    return JSON.stringify(properties);
}

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
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
