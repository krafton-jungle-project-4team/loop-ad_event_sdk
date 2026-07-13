export type SdkDebugConnectionStatus = "connecting" | "connected" | "failed";
export type SdkDebugValidationStatus = "passed" | "blocked";
export type SdkDebugRequestStatus = "pending" | "sent" | "blocked" | "failed";

export interface SdkDebugSchema {
    type: "object" | "string" | "number" | "integer" | "boolean" | "array";
    properties?: Readonly<Record<string, SdkDebugSchema>>;
    required?: readonly string[];
    items?: SdkDebugSchema;
}

export interface SdkDebugEventSchema {
    eventName: string;
    description?: string;
    propertiesSchema: SdkDebugSchema;
}

export interface SdkDebugPanelInit {
    sdkVersion: string;
    connectionUrl: string;
    identityReady: boolean;
}

export interface SdkDebugConnectionMeta {
    projectId: string;
    collectorUrl: string;
    schemaUrl: string;
    schemaVersion: string;
    revision: number;
    events: readonly SdkDebugEventSchema[];
}

export interface SdkDebugRequestRecord {
    requestId?: string;
    status: SdkDebugRequestStatus;
    eventName: string;
    message: string;
    httpStatus?: number;
    bodyBytes?: number;
}

export interface SdkDebugPanel {
    start(): void;
    setConnection(meta: SdkDebugConnectionMeta): void;
    setConnectionError(message: string): void;
    setIdentityReady(ready: boolean): void;
    recordValidation(
        status: SdkDebugValidationStatus,
        eventName: string,
        message: string,
        reasons?: readonly string[]
    ): void;
    recordRequest(record: SdkDebugRequestRecord): void;
    destroy(): void;
}

interface ConnectionState {
    status: SdkDebugConnectionStatus;
    message: string;
    connectedAt?: number;
    meta?: SdkDebugConnectionMeta;
}

interface ValidationRecord {
    status: SdkDebugValidationStatus;
    eventName: string;
    message: string;
    reasons: readonly string[];
    timestamp: number;
}

interface RequestRecord extends Required<Pick<SdkDebugRequestRecord, "requestId">> {
    status: SdkDebugRequestStatus;
    eventName: string;
    message: string;
    httpStatus?: number;
    bodyBytes?: number;
    timestamp: number;
    updatedAt: number;
}

type DebugTab = "overview" | "schema" | "validation" | "requests";

const MAX_DEBUG_RECORDS = 50;
const MAX_REASON_LENGTH = 240;
const STORAGE_KEY = "loopad-sdk-devtools-state-v2";

export function createSdkDebugPanel(init: SdkDebugPanelInit): SdkDebugPanel {
    return new BrowserSdkDebugPanel(init);
}

class BrowserSdkDebugPanel implements SdkDebugPanel {
    private readonly validations: ValidationRecord[] = [];
    private readonly requests: RequestRecord[] = [];
    private connection: ConnectionState = {
        status: "connecting",
        message: "Loading Connection and Tracking Plan…"
    };
    private identityReady: boolean;
    private host: HTMLElement | null = null;
    private shadow: ShadowRoot | null = null;
    private open = false;
    private activeTab: DebugTab = "overview";
    private waitingForDom = false;
    private destroyed = false;
    private recordSequence = 0;

    constructor(private readonly init: SdkDebugPanelInit) {
        this.identityReady = init.identityReady;
        const state = loadPanelState();
        this.open = state.open;
        this.activeTab = state.activeTab;
    }

    start(): void {
        if (this.destroyed || typeof document === "undefined") return;

        if (!document.body) {
            if (!this.waitingForDom) {
                this.waitingForDom = true;
                document.addEventListener("DOMContentLoaded", this.mount, { once: true });
            }
            return;
        }

        this.mount();
    }

    setConnection(meta: SdkDebugConnectionMeta): void {
        if (this.destroyed) return;
        this.connection = {
            status: "connected",
            message: "Connection and Tracking Plan loaded.",
            connectedAt: Date.now(),
            meta
        };
        this.render();
    }

    setConnectionError(message: string): void {
        if (this.destroyed) return;
        this.connection = {
            status: "failed",
            message: truncateDebugText(message)
        };
        this.render();
    }

    setIdentityReady(ready: boolean): void {
        if (this.destroyed || this.identityReady === ready) return;
        this.identityReady = ready;
        this.render();
    }

    recordValidation(
        status: SdkDebugValidationStatus,
        eventName: string,
        message: string,
        reasons: readonly string[] = []
    ): void {
        if (this.destroyed) return;

        this.validations.unshift({
            status,
            eventName: truncateDebugText(eventName),
            message: truncateDebugText(message),
            reasons: reasons.slice(0, 8).map(truncateDebugText),
            timestamp: Date.now()
        });
        if (this.validations.length > MAX_DEBUG_RECORDS) {
            this.validations.length = MAX_DEBUG_RECORDS;
        }
        this.render();
    }

    recordRequest(record: SdkDebugRequestRecord): void {
        if (this.destroyed) return;

        const requestId = truncateDebugText(record.requestId ?? this.nextRecordId());
        const existing = this.requests.find((candidate) => candidate.requestId === requestId);
        const now = Date.now();
        if (existing) {
            existing.status = record.status;
            existing.message = truncateDebugText(record.message);
            existing.updatedAt = now;
            if (record.httpStatus !== undefined) existing.httpStatus = record.httpStatus;
            if (record.bodyBytes !== undefined) existing.bodyBytes = record.bodyBytes;
        } else {
            this.requests.unshift({
                requestId,
                status: record.status,
                eventName: truncateDebugText(record.eventName),
                message: truncateDebugText(record.message),
                ...(record.httpStatus === undefined ? {} : { httpStatus: record.httpStatus }),
                ...(record.bodyBytes === undefined ? {} : { bodyBytes: record.bodyBytes }),
                timestamp: now,
                updatedAt: now
            });
            if (this.requests.length > MAX_DEBUG_RECORDS) {
                this.requests.length = MAX_DEBUG_RECORDS;
            }
        }
        this.render();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        if (this.waitingForDom && typeof document !== "undefined") {
            document.removeEventListener("DOMContentLoaded", this.mount);
        }
        this.host?.remove();
        this.host = null;
        this.shadow = null;
    }

    private readonly mount = (): void => {
        this.waitingForDom = false;
        if (
            this.destroyed ||
            this.host ||
            typeof document === "undefined" ||
            !document.body ||
            typeof document.createElement !== "function"
        ) {
            return;
        }

        const host = document.createElement("div");
        if (typeof host.attachShadow !== "function") return;

        host.id = "loopad-sdk-devtools";
        this.host = host;
        this.shadow = host.attachShadow({ mode: "open" });
        document.body.appendChild(host);
        this.render();
    };

    private render(): void {
        if (!this.shadow) return;

        const validationProblems = this.validations.filter((record) => record.status === "blocked").length;
        const requestProblems = this.requests.filter(
            (record) => record.status === "blocked" || record.status === "failed"
        ).length;
        const problemCount = requestProblems + (this.connection.status === "failed" ? 1 : 0);
        const hasProblems = problemCount > 0;

        this.shadow.innerHTML = `
            <style>${styles}</style>
            <button
                class="launcher ${hasProblems ? "has-problems" : ""}"
                id="loopad-debug-toggle"
                type="button"
                aria-label="LoopAd SDK 열기${hasProblems ? `, 문제 ${problemCount}개` : ""}"
                aria-expanded="${String(this.open)}"
                aria-controls="loopad-debug-panel"
                data-has-issues="${String(hasProblems)}"
            >
                ${launcherIcon}
                <span class="launcher-label">LoopAd</span>
                ${hasProblems ? `<span class="launcher-alert" aria-hidden="true">!</span>` : ""}
            </button>
            <section
                class="panel"
                id="loopad-debug-panel"
                aria-label="LoopAd SDK DevTools"
                ${this.open ? "" : "hidden"}
            >
                ${this.renderHeader(problemCount)}
                ${this.renderTabs(validationProblems, requestProblems)}
                <main class="content">
                    ${this.renderOverview()}
                    ${this.renderSchema()}
                    ${this.renderValidation()}
                    ${this.renderRequests()}
                </main>
                <footer>
                    <span>LoopAd Event SDK</span>
                    <span>v${escapeHtml(this.init.sdkVersion)}</span>
                </footer>
            </section>
        `;

        this.bindEvents();
    }

    private renderHeader(problemCount: number): string {
        const health = problemCount > 0 || this.connection.status === "failed" ? `문제 ${problemCount}` : "정상";
        return `<header>
            <div class="brand">
                <span class="brand-mark">${launcherIcon}</span>
                <h2>LoopAd SDK</h2>
                <span class="header-status ${problemCount > 0 ? "warning" : ""}">${escapeHtml(health)}</span>
            </div>
            <button class="icon-button" id="loopad-debug-close" type="button" aria-label="닫기">${closeIcon}</button>
        </header>`;
    }

    private renderTabs(validationProblems: number, requestProblems: number): string {
        return `<nav class="tabs" role="tablist" aria-label="SDK 디버그 메뉴">
            ${renderTab("overview", "개요", 0, this.activeTab)}
            ${renderTab("schema", "스키마", 0, this.activeTab)}
            ${renderTab("validation", "검증", validationProblems, this.activeTab)}
            ${renderTab("requests", "요청", requestProblems, this.activeTab)}
        </nav>`;
    }

    private renderOverview(): string {
        const meta = this.connection.meta;
        const statusLabel = connectionStatusLabel(this.connection.status);
        const overallStatus = this.connection.status;
        const sentCount = this.requests.filter((record) => record.status === "sent").length;
        const blockedCount = this.requests.filter(
            (record) => record.status === "blocked" || record.status === "failed"
        ).length;

        return `<section
            class="tab-panel"
            id="loopad-tab-overview"
            role="tabpanel"
            aria-labelledby="loopad-tab-button-overview"
            ${this.activeTab === "overview" ? "" : "hidden"}
        >
            <div class="health-card ${overallStatus}">
                <span class="health-icon">${statusIcon(overallStatus)}</span>
                <strong>${escapeHtml(statusLabel)}</strong>
                ${this.connection.status === "failed" ? `<code class="connection-error">${escapeHtml(this.connection.message)}</code>` : ""}
            </div>
            <div class="metric-grid">
                ${renderMetric("이벤트", meta?.events.length ?? 0, "등록")}
                ${renderMetric("검증", this.validations.filter((record) => record.status === "passed").length, "통과")}
                ${renderMetric("요청", sentCount, "전송")}
                ${renderMetric("문제", blockedCount, blockedCount > 0 ? "확인" : "없음")}
            </div>
            <section class="section-card">
                <div class="section-title"><h3>연결</h3><span class="live-dot ${this.connection.status}"></span></div>
                <dl class="detail-grid">
                    ${renderDetail("프로젝트", meta?.projectId ?? "—")}
                    ${renderDetail("Identity", this.identityReady ? "준비" : "없음", this.identityReady ? "good" : "warn")}
                    ${renderDetail("Connection URL", this.init.connectionUrl, "wide code")}
                    ${renderDetail("Collector URL", meta?.collectorUrl ?? "—", "wide code")}
                </dl>
            </section>
            <section class="section-card">
                <div class="section-title"><h3>Tracking Plan</h3>${meta ? '<span class="verified">확인됨</span>' : ""}</div>
                <dl class="detail-grid">
                    ${renderDetail("스키마 버전", meta?.schemaVersion ?? "—", "code")}
                    ${renderDetail("리비전", meta ? String(meta.revision) : "—")}
                    ${renderDetail("등록 이벤트", meta ? String(meta.events.length) : "—")}
                    ${renderDetail("로드 시각", this.connection.connectedAt ? formatTime(this.connection.connectedAt) : "—")}
                    ${renderDetail("Schema URL", meta?.schemaUrl ?? "—", "wide code")}
                </dl>
            </section>
        </section>`;
    }

    private renderSchema(): string {
        const meta = this.connection.meta;
        const schemas = meta?.events.length
            ? meta.events.map(renderEventSchema).join("")
            : renderEmpty("스키마 없음");

        return `<section
            class="tab-panel"
            id="loopad-tab-schema"
            role="tabpanel"
            aria-labelledby="loopad-tab-button-schema"
            ${this.activeTab === "schema" ? "" : "hidden"}
        >
            <div class="summary-strip">
                <span><strong>${meta?.events.length ?? 0}</strong> 이벤트</span>
                <span><strong>${escapeHtml(meta?.schemaVersion ?? "—")}</strong> 버전</span>
                <span><strong>${meta?.revision ?? "—"}</strong> 리비전</span>
            </div>
            <section class="section-card flush schema-card">
                <div class="section-title padded"><h3>이벤트 스키마</h3><span>필드 · 타입 · 필수값</span></div>
                <div class="schema-list">${schemas}</div>
            </section>
        </section>`;
    }

    private renderValidation(): string {
        const passedCount = this.validations.filter((record) => record.status === "passed").length;
        const blockedCount = this.validations.length - passedCount;
        const blocked = this.validations.filter((record) => record.status === "blocked");
        const history = blocked.length
            ? blocked.map(renderValidationRecord).join("")
            : renderEmpty("수정 필요 없음");

        return `<section
            class="tab-panel"
            id="loopad-tab-validation"
            role="tabpanel"
            aria-labelledby="loopad-tab-button-validation"
            ${this.activeTab === "validation" ? "" : "hidden"}
        >
            <div class="summary-strip">
                <span><i class="dot passed"></i><strong>${passedCount}</strong> 통과</span>
                <span><i class="dot blocked"></i><strong>${blockedCount}</strong> 수정 필요</span>
                <span class="privacy-note">속성값 미기록</span>
            </div>
            <section class="section-card flush history-card">
                <div class="section-title padded">
                    <h3>수정 항목</h3>
                    <button class="text-button" id="loopad-debug-clear-validations" type="button">지우기</button>
                </div>
                <div class="record-list">${history}</div>
            </section>
        </section>`;
    }

    private renderRequests(): string {
        const pendingCount = this.requests.filter((record) => record.status === "pending").length;
        const sentCount = this.requests.filter((record) => record.status === "sent").length;
        const problemCount = this.requests.filter(
            (record) => record.status === "blocked" || record.status === "failed"
        ).length;
        const records = this.requests.length
            ? this.requests.map(renderRequestRecord).join("")
            : renderEmpty("요청 기록 없음");

        return `<section
            class="tab-panel"
            id="loopad-tab-requests"
            role="tabpanel"
            aria-labelledby="loopad-tab-button-requests"
            ${this.activeTab === "requests" ? "" : "hidden"}
        >
            <div class="summary-strip">
                <span><i class="dot pending"></i><strong>${pendingCount}</strong> 전송 중</span>
                <span><i class="dot sent"></i><strong>${sentCount}</strong> 완료</span>
                <span class="${problemCount > 0 ? "problem-summary" : ""}"><i class="dot failed"></i><strong>${problemCount}</strong> 문제</span>
            </div>
            <section class="section-card flush request-card">
                <div class="section-title padded">
                    <div><h3>요청 로그</h3><p>최근 ${MAX_DEBUG_RECORDS}건</p></div>
                    <button class="text-button" id="loopad-debug-clear-requests" type="button">지우기</button>
                </div>
                <div class="record-list requests">${records}</div>
            </section>
        </section>`;
    }

    private bindEvents(): void {
        this.shadow?.querySelector("#loopad-debug-toggle")?.addEventListener("click", () => {
            this.open = !this.open;
            this.saveState();
            this.render();
        });
        this.shadow?.querySelector("#loopad-debug-close")?.addEventListener("click", () => {
            this.open = false;
            this.saveState();
            this.render();
        });
        this.shadow?.querySelectorAll<HTMLElement>("[data-tab]").forEach((tab) => {
            tab.addEventListener("click", () => {
                const nextTab = tab.dataset.tab;
                if (isDebugTab(nextTab)) {
                    this.activeTab = nextTab;
                    this.saveState();
                    this.render();
                }
            });
        });
        this.shadow?.querySelector("#loopad-debug-clear-validations")?.addEventListener("click", () => {
            this.validations.length = 0;
            this.render();
        });
        this.shadow?.querySelector("#loopad-debug-clear-requests")?.addEventListener("click", () => {
            this.requests.length = 0;
            this.render();
        });
    }

    private saveState(): void {
        savePanelState({ open: this.open, activeTab: this.activeTab });
    }

    private nextRecordId(): string {
        this.recordSequence += 1;
        return `local-${this.recordSequence}`;
    }
}

function renderTab(tab: DebugTab, label: string, problemCount: number, activeTab: DebugTab): string {
    const selected = tab === activeTab;
    return `<button
        class="tab ${selected ? "active" : ""}"
        id="loopad-tab-button-${tab}"
        type="button"
        role="tab"
        aria-selected="${String(selected)}"
        aria-controls="loopad-tab-${tab}"
        tabindex="${selected ? "0" : "-1"}"
        data-tab="${tab}"
    >${label}${problemCount > 0 ? `<span class="tab-warning" aria-label="문제 ${problemCount}개">${warningIcon}${problemCount}</span>` : ""}</button>`;
}

function renderMetric(label: string, value: number, caption: string): string {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(caption)}</small></div>`;
}

function renderDetail(label: string, value: string, className = ""): string {
    return `<div class="detail ${className}"><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`;
}

function renderValidationRecord(record: ValidationRecord): string {
    const actions = validationActions(record);
    return `<article class="record validation-record ${record.status}" data-validation-status="${record.status}">
        <span class="record-icon">${statusIcon(record.status)}</span>
        <div class="record-body">
            <div class="record-heading"><strong>${escapeHtml(record.eventName)}</strong><time>${formatTime(record.timestamp)}</time></div>
            <ul class="reasons">${actions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ul>
        </div>
    </article>`;
}

function renderRequestRecord(record: RequestRecord): string {
    const metadata = [
        record.httpStatus === undefined ? "" : `HTTP ${record.httpStatus}`,
        record.bodyBytes === undefined ? "" : formatBytes(record.bodyBytes),
        `#${shortRequestId(record.requestId)}`
    ].filter(Boolean);
    return `<article class="record request-record ${record.status}" data-request-status="${record.status}">
        <span class="record-icon">${statusIcon(record.status)}</span>
        <div class="record-body">
            <div class="record-heading"><strong>${escapeHtml(record.eventName)}</strong><span class="request-status">${requestStatusLabel(record.status)}</span><time>${formatTime(record.updatedAt)}</time></div>
            <div class="request-meta"><span class="request-method">POST</span>${metadata.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        </div>
    </article>`;
}

function renderEventSchema(event: SdkDebugEventSchema): string {
    const rows = schemaRows(event.propertiesSchema);
    return `<details class="schema-event">
        <summary>
            <span class="schema-chevron">${chevronIcon}</span>
            <span class="schema-name">${escapeHtml(event.eventName)}</span>
            <span class="schema-count">필드 ${rows.length}</span>
        </summary>
        <div class="schema-body">
            ${event.description ? `<p class="schema-description">${escapeHtml(event.description)}</p>` : ""}
            ${rows.length ? `<div class="schema-table">${rows.map(renderSchemaRow).join("")}</div>` : '<p class="schema-empty">사용자 속성 없음</p>'}
        </div>
    </details>`;
}

interface SchemaRow {
    path: string;
    type: string;
    required: boolean;
    depth: number;
}

function schemaRows(schema: SdkDebugSchema): SchemaRow[] {
    const rows: SchemaRow[] = [];
    appendSchemaRows(rows, schema, "", 0, false);
    return rows;
}

function appendSchemaRows(
    rows: SchemaRow[],
    schema: SdkDebugSchema,
    parentPath: string,
    depth: number,
    parentRequired: boolean
): void {
    if (schema.type === "object") {
        const required = new Set(schema.required ?? []);
        for (const [name, property] of Object.entries(schema.properties ?? {})) {
            const path = parentPath ? `${parentPath}.${name}` : name;
            const isRequired = required.has(name);
            rows.push({ path, type: schemaType(property), required: isRequired, depth });
            appendSchemaRows(rows, property, path, depth + 1, isRequired);
        }
        return;
    }

    if (schema.type === "array" && schema.items && (schema.items.type === "object" || schema.items.type === "array")) {
        appendSchemaRows(rows, schema.items, `${parentPath}[]`, depth, parentRequired);
    }
}

function renderSchemaRow(row: SchemaRow): string {
    return `<div class="schema-row" style="--depth:${Math.min(row.depth, 6)}">
        <code>${escapeHtml(row.path)}</code>
        <span class="type-badge">${escapeHtml(row.type)}</span>
        <span class="required-badge ${row.required ? "required" : "optional"}">${row.required ? "필수" : "선택"}</span>
    </div>`;
}

function schemaType(schema: SdkDebugSchema): string {
    return schema.type === "array" ? `${schema.items?.type ?? "unknown"}[]` : schema.type;
}

function renderEmpty(title: string): string {
    return `<div class="empty-state">${emptyIcon}<strong>${escapeHtml(title)}</strong></div>`;
}

function connectionStatusLabel(status: SdkDebugConnectionStatus): string {
    if (status === "connected") return "연결됨";
    if (status === "failed") return "연결 실패";
    return "연결 중";
}

function requestStatusLabel(status: SdkDebugRequestStatus): string {
    if (status === "sent") return "완료";
    if (status === "pending") return "전송 중";
    if (status === "blocked") return "차단";
    return "실패";
}

function validationActions(record: ValidationRecord): string[] {
    const reasons = record.reasons.length ? record.reasons : [record.message];
    return reasons.map(validationAction);
}

function validationAction(reason: string): string {
    const patterns: ReadonlyArray<[RegExp, (match: RegExpMatchArray) => string]> = [
        [/^event (.+) is not registered$/, (match) => `이벤트 등록 · ${match[1]}`],
        [/^(.+) is required$/, (match) => `필수값 추가 · ${match[1]}`],
        [/^(.+) is not declared$/, (match) => `필드 선언 또는 제거 · ${match[1]}`],
        [/^(.+) is reserved$/, (match) => `예약 필드 제거 · ${match[1]}`],
        [/^(.+) is unsafe$/, (match) => `금지 필드 제거 · ${match[1]}`],
        [/^(.+) must be an object$/, (match) => `타입 수정 · ${match[1]} → object`],
        [/^(.+) must be an array$/, (match) => `타입 수정 · ${match[1]} → array`],
        [/^(.+) must be a string$/, (match) => `타입 수정 · ${match[1]} → string`],
        [/^(.+) must be a number$/, (match) => `타입 수정 · ${match[1]} → number`],
        [/^(.+) must be an integer$/, (match) => `타입 수정 · ${match[1]} → integer`],
        [/^(.+) must be a boolean$/, (match) => `타입 수정 · ${match[1]} → boolean`],
        [/^(.+) must not be circular$/, (match) => `순환 참조 제거 · ${match[1]}`],
        [/^Identity is not set\.$/, () => "Identity 설정"],
        [/^Properties must be a plain object\.$/, () => "속성 타입 수정 · object"],
        [/^data-loopad-event is missing\.$/, () => "data-loopad-event 추가"],
        [/^data-loopad-properties is invalid\.$/, () => "data-loopad-properties 수정"],
        [/^attribute exceeds (.+) bytes$/, (match) => `JSON 크기 축소 · ${match[1]} bytes 이하`],
        [/^attribute is not valid JSON$/, () => "JSON 문법 수정"],
        [/^attribute root must be an object$/, () => "JSON 최상위 타입 수정 · object"],
        [/^attribute contains a sensitive-looking value$/, () => "민감정보 제거"]
    ];

    for (const [pattern, format] of patterns) {
        const match = reason.match(pattern);
        if (match) return format(match);
    }
    return reason.replace(/\.$/, "");
}

function statusIcon(status: string): string {
    if (status === "connected" || status === "passed" || status === "sent") return checkIcon;
    if (status === "connecting" || status === "pending") return pendingIcon;
    return warningIcon;
}

function shortRequestId(requestId: string): string {
    return requestId.length <= 10 ? requestId : requestId.slice(-10);
}

function formatBytes(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });
}

function truncateDebugText(value: string): string {
    return value.length <= MAX_REASON_LENGTH ? value : `${value.slice(0, MAX_REASON_LENGTH - 1)}…`;
}

function isDebugTab(value: string | undefined): value is DebugTab {
    return value === "overview" || value === "schema" || value === "validation" || value === "requests";
}

function loadPanelState(): { open: boolean; activeTab: DebugTab } {
    try {
        const storage = browserStorage();
        if (!storage) return { open: false, activeTab: "overview" };
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return { open: false, activeTab: "overview" };
        const parsed = JSON.parse(raw) as { open?: unknown; activeTab?: unknown };
        return {
            open: parsed.open === true,
            activeTab: typeof parsed.activeTab === "string" && isDebugTab(parsed.activeTab) ? parsed.activeTab : "overview"
        };
    } catch {
        return { open: false, activeTab: "overview" };
    }
}

function savePanelState(state: { open: boolean; activeTab: DebugTab }): void {
    try {
        browserStorage()?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Storage can be disabled by the browser or blocked in an embedded context.
    }
}

function browserStorage(): Storage | null {
    if (typeof window === "undefined" || !("localStorage" in window)) return null;
    return window.localStorage;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

const launcherIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 7.5h9v9h-9z"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>`;
const closeIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>`;
const checkIcon = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10 3 3 7-7"/></svg>`;
const pendingIcon = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 5v5l3 2"/><circle cx="10" cy="10" r="7"/></svg>`;
const warningIcon = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.8 16h14.4L10 3Z"/><path d="M10 7v4M10 14h.01"/></svg>`;
const chevronIcon = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 8 3 3 3-3"/></svg>`;
const emptyIcon = `<svg class="empty-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5zM8 9h8M8 13h5"/></svg>`;

const styles = `
    :host { all: initial; color-scheme: dark; }
    * { box-sizing: border-box; }
    button { font: inherit; }
    svg { display: block; width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .launcher {
        position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
        display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 14px;
        border: 1px solid #334155; border-radius: 12px; color: #e2e8f0;
        background: linear-gradient(180deg, #172033, #0f172a); box-shadow: 0 12px 35px #02061773, inset 0 1px #ffffff0d;
        font: 600 12px/1 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer; transition: transform .15s ease, border-color .15s ease, box-shadow .15s ease;
    }
    .launcher:hover { transform: translateY(-1px); border-color: #64748b; box-shadow: 0 15px 38px #0206178c, inset 0 1px #ffffff12; }
    .launcher:focus-visible, button:focus-visible { outline: 2px solid #60a5fa; outline-offset: 2px; }
    .launcher > svg { width: 18px; height: 18px; color: #60a5fa; }
    .launcher.has-problems { border-color: #f59e0b80; }
    .launcher-alert {
        display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px;
        border-radius: 999px; color: #0f172a; background: #fbbf24; font-size: 11px; font-weight: 800;
    }
    .panel {
        position: fixed; right: 18px; bottom: 70px; z-index: 2147483647;
        width: min(620px, calc(100vw - 36px)); height: min(700px, calc(100vh - 98px));
        overflow: hidden; border: 1px solid #334155; border-radius: 16px; color: #cbd5e1;
        background: #0b1120f7; box-shadow: 0 28px 80px #020617b3, inset 0 1px #ffffff0d;
        backdrop-filter: blur(18px); font: 12px/1.5 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .panel[hidden], .tab-panel[hidden] { display: none; }
    header { height: 64px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid #1e293b; }
    .brand { display: flex; align-items: center; gap: 11px; }
    .brand-mark { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid #1d4ed880; border-radius: 9px; color: #60a5fa; background: #17255480; }
    .brand-mark svg { width: 17px; height: 17px; }
    h2, h3, p { margin: 0; }
    h2 { color: #f8fafc; font-size: 14px; line-height: 1.2; letter-spacing: -.01em; }
    .brand p { margin-top: 3px; color: #64748b; font-size: 10px; }
    .icon-button { display: grid; place-items: center; width: 30px; height: 30px; border: 0; border-radius: 7px; color: #64748b; background: transparent; cursor: pointer; }
    .icon-button:hover { color: #e2e8f0; background: #1e293b; }
    .icon-button svg { width: 17px; height: 17px; }
    .tabs { display: flex; height: 44px; padding: 0 14px; gap: 4px; border-bottom: 1px solid #1e293b; background: #0f172a80; }
    .tab { position: relative; display: flex; align-items: center; gap: 7px; padding: 0 12px; border: 0; color: #64748b; background: transparent; font-weight: 600; cursor: pointer; }
    .tab:hover { color: #cbd5e1; }
    .tab.active { color: #f8fafc; }
    .tab.active::after { content: ""; position: absolute; right: 10px; bottom: -1px; left: 10px; height: 2px; border-radius: 2px 2px 0 0; background: #3b82f6; }
    .tab-warning { display: inline-flex; align-items: center; gap: 3px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; color: #fbbf24; background: #78350f66; font-size: 10px; }
    .tab-warning svg { width: 11px; height: 11px; }
    .content { height: calc(100% - 136px); overflow: auto; scrollbar-color: #334155 transparent; }
    .tab-panel { min-height: 100%; padding: 16px; }
    footer { height: 28px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; border-top: 1px solid #1e293b; color: #475569; font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .health-card { display: flex; align-items: center; gap: 12px; min-height: 70px; padding: 14px; border: 1px solid #1e3a5f; border-radius: 12px; background: linear-gradient(135deg, #0c4a6e33, #17255426); }
    .health-card.warning, .health-card.failed { border-color: #92400e80; background: linear-gradient(135deg, #78350f33, #451a0326); }
    .health-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 999px; color: #38bdf8; background: #0c4a6e66; }
    .health-card.warning .health-icon, .health-card.failed .health-icon { color: #fbbf24; background: #78350f66; }
    .health-icon svg { width: 18px; height: 18px; }
    .health-copy { min-width: 0; display: flex; flex: 1; flex-direction: column; }
    .health-copy strong { color: #f8fafc; font-size: 13px; }
    .health-copy span { margin-top: 2px; overflow: hidden; color: #94a3b8; text-overflow: ellipsis; white-space: nowrap; }
    .status-pill, .verified { padding: 3px 7px; border: 1px solid #0e749080; border-radius: 999px; color: #67e8f9; background: #164e6355; font-size: 9px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .status-pill.failed { border-color: #b4530980; color: #fbbf24; background: #78350f55; }
    .status-pill.connecting { border-color: #475569; color: #94a3b8; background: #1e293b; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
    .metric { min-width: 0; padding: 11px 12px; border: 1px solid #1e293b; border-radius: 10px; background: #11182780; }
    .metric > span { display: block; color: #64748b; font-size: 10px; }
    .metric strong { display: block; margin-top: 5px; color: #f8fafc; font: 700 18px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .metric small { display: block; margin-top: 5px; color: #475569; font-size: 9px; }
    .section-card { margin-top: 12px; overflow: hidden; border: 1px solid #1e293b; border-radius: 12px; background: #11182766; }
    .section-card.flush { margin-top: 12px; }
    .section-title { display: flex; align-items: center; justify-content: space-between; min-height: 40px; padding: 0 13px; border-bottom: 1px solid #1e293b; }
    .section-title.padded { min-height: 46px; }
    .section-title h3 { color: #e2e8f0; font-size: 11px; font-weight: 700; }
    .section-title > span, .section-title p { color: #64748b; font-size: 9px; }
    .section-title p { margin-top: 2px; }
    .live-dot { width: 7px; height: 7px; border-radius: 999px; background: #38bdf8; box-shadow: 0 0 0 3px #0c4a6e80; }
    .live-dot.failed { background: #f59e0b; box-shadow: 0 0 0 3px #78350f80; }
    .live-dot.connecting { background: #64748b; box-shadow: 0 0 0 3px #1e293b; }
    .verified { border-color: #16653480; color: #86efac; background: #14532d55; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; margin: 0; }
    .detail { min-width: 0; padding: 10px 13px; border-top: 1px solid #1e293b80; }
    .detail:nth-child(-n + 2) { border-top: 0; }
    .detail.wide { grid-column: 1 / -1; }
    .detail dt { color: #64748b; font-size: 9px; }
    .detail dd { margin: 3px 0 0; overflow: hidden; color: #cbd5e1; text-overflow: ellipsis; white-space: nowrap; }
    .detail.code dd { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
    .detail.good dd { color: #86efac; }
    .detail.warn dd { color: #fbbf24; }
    .summary-strip { display: flex; align-items: center; gap: 16px; min-height: 38px; padding: 0 4px; color: #94a3b8; font-size: 10px; }
    .summary-strip > span { display: flex; align-items: center; gap: 5px; }
    .summary-strip strong { color: #e2e8f0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .summary-strip .privacy-note { margin-left: auto; color: #475569; }
    .summary-strip .problem-summary { color: #fbbf24; }
    .dot { width: 6px; height: 6px; border-radius: 999px; background: #64748b; }
    .dot.passed, .dot.sent { background: #22c55e; }
    .dot.blocked, .dot.failed { background: #f59e0b; }
    .dot.pending { background: #38bdf8; }
    .schema-list { max-height: 250px; overflow: auto; }
    .schema-event { border-top: 1px solid #1e293b; }
    .schema-event:first-child { border-top: 0; }
    .schema-event summary { display: flex; align-items: center; min-height: 42px; padding: 0 12px; color: #cbd5e1; cursor: pointer; list-style: none; }
    .schema-event summary::-webkit-details-marker { display: none; }
    .schema-chevron { color: #475569; transition: transform .12s ease; }
    .schema-chevron svg { width: 15px; height: 15px; }
    .schema-event[open] .schema-chevron { transform: rotate(180deg); }
    .schema-name { margin-left: 6px; color: #e2e8f0; font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .schema-count { margin-left: auto; color: #475569; font-size: 9px; }
    .schema-body { padding: 0 12px 12px 33px; }
    .schema-description { margin-bottom: 9px; color: #64748b; font-size: 10px; }
    .schema-table { overflow: hidden; border: 1px solid #1e293b; border-radius: 8px; }
    .schema-row { display: grid; grid-template-columns: minmax(0, 1fr) 84px 60px; align-items: center; min-height: 30px; gap: 7px; padding: 0 8px 0 calc(8px + var(--depth) * 11px); border-top: 1px solid #1e293b80; }
    .schema-row:first-child { border-top: 0; }
    .schema-row code { overflow: hidden; color: #cbd5e1; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
    .type-badge { color: #7dd3fc; font: 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .required-badge { color: #475569; font-size: 8px; text-align: right; }
    .required-badge.required { color: #fda4af; }
    .schema-empty { padding: 9px; border: 1px dashed #1e293b; border-radius: 7px; color: #475569; font-size: 9px; text-align: center; }
    .history-card, .request-card { min-height: 200px; }
    .text-button { padding: 4px 7px; border: 0; border-radius: 5px; color: #64748b; background: transparent; font-size: 9px; cursor: pointer; }
    .text-button:hover { color: #cbd5e1; background: #1e293b; }
    .record-list { max-height: 250px; overflow: auto; }
    .record { display: flex; gap: 10px; padding: 11px 12px; border-top: 1px solid #1e293b; }
    .record:first-child { border-top: 0; }
    .record-icon { display: grid; place-items: center; flex: 0 0 auto; width: 23px; height: 23px; border-radius: 999px; color: #86efac; background: #14532d55; }
    .record.blocked .record-icon, .record.failed .record-icon { color: #fbbf24; background: #78350f55; }
    .record.pending .record-icon { color: #7dd3fc; background: #0c4a6e55; }
    .record-icon svg { width: 13px; height: 13px; }
    .record-body { min-width: 0; flex: 1; }
    .record-heading { display: flex; align-items: center; gap: 8px; }
    .record-heading strong { min-width: 0; overflow: hidden; color: #e2e8f0; font: 600 10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; text-overflow: ellipsis; white-space: nowrap; }
    .record-heading time { margin-left: auto; color: #475569; font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .record-body > p { margin-top: 4px; color: #64748b; font-size: 9px; }
    .reasons { margin: 6px 0 0; padding: 7px 9px 7px 23px; border-radius: 6px; color: #fca5a5; background: #450a0a45; font: 9px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .reasons li { overflow-wrap: anywhere; }
    .request-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 7px; }
    .request-meta span { padding: 2px 5px; border-radius: 4px; color: #64748b; background: #1e293b; font: 8px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .request-meta .request-method { color: #7dd3fc; background: #0c4a6e66; font-weight: 700; }
    .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 150px; padding: 22px; color: #475569; text-align: center; }
    .empty-icon { width: 25px; height: 25px; margin-bottom: 9px; }
    .empty-state strong { color: #94a3b8; font-size: 10px; }
    .empty-state span { margin-top: 4px; font-size: 9px; }
    @media (max-width: 520px) {
        .launcher { right: 12px; bottom: 12px; }
        .panel { right: 8px; bottom: 62px; width: calc(100vw - 16px); height: calc(100vh - 76px); border-radius: 13px; }
        .metric-grid { grid-template-columns: 1fr 1fr; }
        .summary-strip .privacy-note { display: none; }
        .schema-row { grid-template-columns: minmax(0, 1fr) 66px 52px; }
    }

    /* VS Code Light */
    :host { color-scheme: light; }
    .launcher {
        height: 36px; padding: 0 11px; border-color: #c8c8c8; border-radius: 4px;
        color: #333333; background: #ffffff; box-shadow: 0 3px 10px #00000024;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .launcher:hover { transform: none; border-color: #007acc; background: #f3f3f3; box-shadow: 0 3px 10px #00000024; }
    .launcher:focus-visible, button:focus-visible { outline-color: #007acc; }
    .launcher > svg { width: 16px; height: 16px; color: #007acc; }
    .launcher.has-problems { border-color: #bf8803; }
    .launcher-alert { min-width: 16px; height: 16px; color: #ffffff; background: #bf8803; font-size: 10px; }
    .panel {
        width: min(660px, calc(100vw - 36px)); height: min(680px, calc(100vh - 98px));
        border-color: #c8c8c8; border-radius: 6px; color: #333333; background: #ffffff;
        box-shadow: 0 8px 30px #0000002e; backdrop-filter: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header { height: 48px; padding: 0 12px; border-bottom-color: #d4d4d4; background: #f3f3f3; }
    .brand { gap: 8px; }
    .brand-mark { width: 26px; height: 26px; border: 0; border-radius: 3px; color: #ffffff; background: #007acc; }
    .brand-mark svg { width: 15px; height: 15px; }
    h2 { color: #1f1f1f; font-size: 13px; font-weight: 600; }
    .header-status { padding: 2px 6px; border: 1px solid #89d185; border-radius: 2px; color: #2d662d; background: #f0fff0; font-size: 10px; }
    .header-status.warning { border-color: #d7ba7d; color: #7a5901; background: #fff8df; }
    .icon-button { color: #616161; border-radius: 3px; }
    .icon-button:hover { color: #1f1f1f; background: #e5e5e5; }
    .tabs { height: 38px; padding: 0 8px; gap: 0; border-bottom-color: #d4d4d4; background: #ffffff; }
    .tab { gap: 5px; padding: 0 14px; color: #616161; font-size: 11px; font-weight: 400; }
    .tab:hover { color: #1f1f1f; background: #f3f3f3; }
    .tab.active { color: #1f1f1f; font-weight: 600; }
    .tab.active::after { right: 10px; left: 10px; background: #007acc; }
    .tab-warning { min-width: 16px; height: 16px; color: #7a5901; background: #fff1c2; }
    .tab-warning svg { width: 10px; height: 10px; }
    .content { height: calc(100% - 110px); scrollbar-color: #c8c8c8 transparent; background: #ffffff; }
    .tab-panel { padding: 12px; }
    footer { height: 24px; padding: 0 10px; border-top: 0; color: #ffffff; background: #007acc; }
    .health-card {
        min-height: 44px; gap: 8px; padding: 8px 10px; border-color: #89d185; border-radius: 3px;
        border-left: 3px solid #388a34; background: #f7fff7;
    }
    .health-card.failed { border-color: #e0a1a3; border-left-color: #d13438; background: #fff7f7; }
    .health-card.connecting { border-color: #b5cea8; border-left-color: #007acc; background: #f7fbff; }
    .health-icon { width: 24px; height: 24px; color: #388a34; background: transparent; }
    .health-card.failed .health-icon { color: #d13438; background: transparent; }
    .health-card.connecting .health-icon { color: #007acc; background: transparent; }
    .health-icon svg { width: 16px; height: 16px; }
    .health-card strong { color: #1f1f1f; font-size: 12px; }
    .connection-error { min-width: 0; margin-left: auto; overflow: hidden; color: #a1260d; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .metric-grid { gap: 6px; margin: 8px 0; }
    .metric { padding: 8px 9px; border-color: #d4d4d4; border-radius: 3px; background: #fafafa; }
    .metric > span { color: #616161; font-size: 10px; }
    .metric strong { margin-top: 3px; color: #1f1f1f; font-size: 16px; }
    .metric small { margin-top: 3px; color: #808080; font-size: 10px; }
    .section-card { margin-top: 8px; border-color: #d4d4d4; border-radius: 3px; background: #ffffff; }
    .section-card.flush { margin-top: 8px; }
    .section-title { min-height: 34px; padding: 0 10px; border-bottom-color: #d4d4d4; background: #f8f8f8; }
    .section-title.padded { min-height: 38px; }
    .section-title h3 { color: #1f1f1f; font-size: 11px; }
    .section-title > span, .section-title p { color: #808080; font-size: 10px; }
    .live-dot { width: 6px; height: 6px; background: #388a34; box-shadow: none; }
    .live-dot.failed { background: #d13438; box-shadow: none; }
    .live-dot.connecting { background: #007acc; box-shadow: none; }
    .verified { border-color: #89d185; border-radius: 2px; color: #2d662d; background: #f0fff0; text-transform: none; }
    .detail { padding: 8px 10px; border-top-color: #eeeeee; }
    .detail dt { color: #808080; font-size: 10px; }
    .detail dd { color: #333333; font-size: 11px; }
    .detail.good dd { color: #388a34; }
    .detail.warn dd { color: #bf8803; }
    .summary-strip { min-height: 32px; padding: 0 2px; color: #616161; font-size: 11px; }
    .summary-strip strong { color: #1f1f1f; }
    .summary-strip .privacy-note { color: #808080; }
    .summary-strip .problem-summary { color: #a1260d; }
    .dot { background: #808080; }
    .dot.passed, .dot.sent { background: #388a34; }
    .dot.blocked, .dot.failed { background: #d13438; }
    .dot.pending { background: #007acc; }
    .schema-card { margin-top: 0; }
    .schema-list { max-height: 555px; }
    .schema-event { border-top-color: #eeeeee; }
    .schema-event summary { min-height: 36px; padding: 0 10px; color: #333333; }
    .schema-event summary:hover { background: #f3f3f3; }
    .schema-chevron { color: #616161; }
    .schema-name { color: #1f1f1f; font-size: 11px; }
    .schema-count { color: #808080; font-size: 10px; }
    .schema-body { padding: 0 10px 10px 30px; }
    .schema-description { color: #616161; }
    .schema-table { border-color: #d4d4d4; border-radius: 2px; }
    .schema-row { border-top-color: #eeeeee; }
    .schema-row code { color: #333333; font-size: 10px; }
    .type-badge { color: #0451a5; font-size: 10px; }
    .required-badge { color: #808080; font-size: 9px; }
    .required-badge.required { color: #a1260d; }
    .schema-empty { border-color: #d4d4d4; color: #808080; }
    .history-card, .request-card { min-height: 180px; }
    .text-button { color: #616161; border-radius: 2px; }
    .text-button:hover { color: #1f1f1f; background: #e5e5e5; }
    .record-list { max-height: 530px; }
    .record { gap: 8px; padding: 9px 10px; border-top-color: #eeeeee; }
    .record:hover { background: #f8f8f8; }
    .record-icon { width: 20px; height: 20px; color: #388a34; background: transparent; }
    .record.blocked .record-icon, .record.failed .record-icon { color: #d13438; background: transparent; }
    .record.pending .record-icon { color: #007acc; background: transparent; }
    .record-icon svg { width: 13px; height: 13px; }
    .record-heading strong { color: #1f1f1f; font-size: 11px; }
    .record-heading time { color: #808080; font-size: 9px; }
    .request-status { padding: 1px 5px; border-radius: 2px; color: #616161; background: #eeeeee; font-size: 8px; }
    .record.failed .request-status, .record.blocked .request-status { color: #a1260d; background: #fde7e9; }
    .record.sent .request-status { color: #2d662d; background: #e7f4e4; }
    .reasons { margin-top: 5px; padding: 6px 8px 6px 22px; border-radius: 2px; color: #a1260d; background: #fff4f4; font-size: 10px; }
    .request-meta { margin-top: 5px; }
    .request-meta span { color: #616161; background: #eeeeee; font-size: 9px; }
    .request-meta .request-method { color: #ffffff; background: #007acc; }
    .empty-state { color: #808080; }
    .empty-state strong { color: #616161; font-size: 11px; }
`;
