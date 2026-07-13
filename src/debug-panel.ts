export type SdkDebugEventStatus = "ready" | "validated" | "dropped" | "sent" | "failed";

export interface SdkDebugPanelMeta {
    projectId: string;
    schemaVersion: string;
    revision: number;
    registeredEventCount: number;
}

export interface SdkDebugPanel {
    start(): void;
    record(
        status: SdkDebugEventStatus,
        eventName: string,
        message: string,
        reasons?: readonly string[]
    ): void;
    destroy(): void;
}

interface DebugRecord {
    status: SdkDebugEventStatus;
    eventName: string;
    message: string;
    reasons: readonly string[];
    timestamp: number;
}

const MAX_DEBUG_RECORDS = 50;
const MAX_REASON_LENGTH = 240;

export function createSdkDebugPanel(meta: SdkDebugPanelMeta): SdkDebugPanel {
    return new BrowserSdkDebugPanel(meta);
}

class BrowserSdkDebugPanel implements SdkDebugPanel {
    private readonly records: DebugRecord[] = [];
    private readonly counts: Record<SdkDebugEventStatus, number> = {
        ready: 0,
        validated: 0,
        dropped: 0,
        sent: 0,
        failed: 0
    };

    private host: HTMLElement | null = null;
    private shadow: ShadowRoot | null = null;
    private open = false;
    private waitingForDom = false;
    private destroyed = false;

    constructor(private readonly meta: SdkDebugPanelMeta) {}

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

    record(
        status: SdkDebugEventStatus,
        eventName: string,
        message: string,
        reasons: readonly string[] = []
    ): void {
        if (this.destroyed) return;

        this.counts[status] += 1;
        this.records.unshift({
            status,
            eventName: truncateDebugText(eventName),
            message: truncateDebugText(message),
            reasons: reasons.slice(0, 8).map(truncateDebugText),
            timestamp: Date.now()
        });
        if (this.records.length > MAX_DEBUG_RECORDS) {
            this.records.length = MAX_DEBUG_RECORDS;
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

        const problemCount = this.counts.dropped + this.counts.failed;
        const records = this.records.length
            ? this.records.map(renderRecord).join("")
            : '<p class="empty">No events recorded.</p>';

        this.shadow.innerHTML = `
            <style>
                :host { all: initial; }
                * { box-sizing: border-box; }
                button { font: inherit; }
                .launcher {
                    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
                    border: 0; border-radius: 999px; padding: 10px 14px;
                    color: #f8fafc; background: #0f172a; box-shadow: 0 8px 28px #02061755;
                    font: 600 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
                    cursor: pointer;
                }
                .badge { margin-left: 7px; color: #fecaca; }
                .panel {
                    position: fixed; right: 16px; bottom: 62px; z-index: 2147483647;
                    width: min(420px, calc(100vw - 32px)); max-height: min(620px, calc(100vh - 88px));
                    overflow: hidden; border: 1px solid #334155; border-radius: 12px;
                    color: #e2e8f0; background: #0f172af7; box-shadow: 0 18px 50px #02061788;
                    font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
                }
                .panel[hidden] { display: none; }
                header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #334155; }
                h2 { margin: 0; color: #f8fafc; font-size: 13px; }
                .icon-button, .clear { border: 1px solid #475569; border-radius: 6px; color: #cbd5e1; background: transparent; cursor: pointer; }
                .icon-button { width: 28px; height: 28px; }
                .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #334155; }
                .meta div { min-width: 0; }
                dt { color: #94a3b8; }
                dd { margin: 2px 0 0; overflow: hidden; color: #f8fafc; text-overflow: ellipsis; white-space: nowrap; }
                .counts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding: 10px 14px; border-bottom: 1px solid #334155; }
                .count { border-radius: 6px; padding: 6px; text-align: center; background: #1e293b; }
                .count strong { display: block; font-size: 15px; }
                .toolbar { display: flex; align-items: center; justify-content: space-between; padding: 9px 14px; }
                .toolbar span { color: #94a3b8; }
                .clear { padding: 4px 8px; font-size: 11px; }
                .records { max-height: 310px; overflow: auto; padding: 0 14px 14px; }
                .record { margin-top: 7px; border-left: 3px solid #64748b; border-radius: 6px; padding: 8px 9px; background: #1e293b; }
                .record.validated, .record.sent { border-color: #22c55e; }
                .record.dropped { border-color: #f59e0b; }
                .record.failed { border-color: #ef4444; }
                .record.ready { border-color: #38bdf8; }
                .row { display: flex; gap: 8px; align-items: baseline; }
                .status { color: #cbd5e1; text-transform: uppercase; }
                .name { min-width: 0; overflow-wrap: anywhere; color: #f8fafc; font-weight: 700; }
                time { margin-left: auto; color: #64748b; font-size: 10px; }
                .message { margin-top: 3px; color: #cbd5e1; }
                .reasons { margin: 5px 0 0; padding-left: 18px; color: #fca5a5; }
                .empty { margin: 12px 0; color: #64748b; text-align: center; }
            </style>
            <button class="launcher" id="loopad-debug-toggle" type="button" aria-expanded="${String(this.open)}" aria-controls="loopad-debug-panel">
                LoopAd SDK${problemCount > 0 ? `<span class="badge">${problemCount}</span>` : ""}
            </button>
            <section class="panel" id="loopad-debug-panel" aria-label="LoopAd SDK debug panel" ${this.open ? "" : "hidden"}>
                <header><h2>LoopAd SDK DevTools</h2><button class="icon-button" id="loopad-debug-close" type="button" aria-label="Close">×</button></header>
                <dl class="meta">
                    <div><dt>Project</dt><dd>${escapeHtml(this.meta.projectId)}</dd></div>
                    <div><dt>Schema</dt><dd>${escapeHtml(this.meta.schemaVersion)}</dd></div>
                    <div><dt>Revision</dt><dd>${this.meta.revision}</dd></div>
                    <div><dt>Registered events</dt><dd>${this.meta.registeredEventCount}</dd></div>
                </dl>
                <div class="counts">
                    ${renderCount("Validated", this.counts.validated)}
                    ${renderCount("Sent", this.counts.sent)}
                    ${renderCount("Dropped", this.counts.dropped)}
                    ${renderCount("Failed", this.counts.failed)}
                </div>
                <div class="toolbar"><span>Latest ${MAX_DEBUG_RECORDS} status records</span><button class="clear" id="loopad-debug-clear" type="button">Clear list</button></div>
                <div class="records">${records}</div>
            </section>
        `;

        this.shadow.querySelector("#loopad-debug-toggle")?.addEventListener("click", () => {
            this.open = !this.open;
            this.render();
        });
        this.shadow.querySelector("#loopad-debug-close")?.addEventListener("click", () => {
            this.open = false;
            this.render();
        });
        this.shadow.querySelector("#loopad-debug-clear")?.addEventListener("click", () => {
            this.records.length = 0;
            this.render();
        });
    }
}

function renderCount(label: string, count: number): string {
    return `<div class="count"><strong>${count}</strong>${label}</div>`;
}

function renderRecord(record: DebugRecord): string {
    const reasons = record.reasons.length
        ? `<ul class="reasons">${record.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>`
        : "";
    return `<article class="record ${record.status}" data-status="${record.status}">
        <div class="row"><span class="status">${record.status}</span><span class="name">${escapeHtml(record.eventName)}</span><time>${formatTime(record.timestamp)}</time></div>
        <div class="message">${escapeHtml(record.message)}</div>${reasons}
    </article>`;
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

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
