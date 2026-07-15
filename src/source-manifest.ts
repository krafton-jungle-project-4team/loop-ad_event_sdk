export const LOOPAD_SOURCE_MANIFEST_VERSION = 1 as const;
export const LOOPAD_SOURCE_MANIFEST_META_NAME = "loopad-source-manifest";

export type LoopAdSourceReferenceKind = "call" | "dom";

export interface LoopAdSourceReference {
    file: string;
    line: number;
    column: number;
    kind: LoopAdSourceReferenceKind;
}

export interface LoopAdSourceManifest {
    version: typeof LOOPAD_SOURCE_MANIFEST_VERSION;
    buildId: string;
    generatedAt: string;
    events: Readonly<Record<string, readonly LoopAdSourceReference[]>>;
    externalEvents: readonly string[];
}

const MAX_MANIFEST_EVENTS = 500;
const MAX_REFERENCES_PER_EVENT = 100;
const MAX_TEXT_LENGTH = 500;
const SOURCE_REFERENCE_KINDS = new Set<LoopAdSourceReferenceKind>([
    "call",
    "dom"
]);

export function parseLoopAdSourceManifest(value: unknown): LoopAdSourceManifest {
    const manifest = record(value, "source manifest");
    if (manifest.version !== LOOPAD_SOURCE_MANIFEST_VERSION) {
        throw new Error(`source manifest version must be ${LOOPAD_SOURCE_MANIFEST_VERSION}`);
    }

    const eventsValue = record(manifest.events, "source manifest events");
    const entries = Object.entries(eventsValue);
    if (entries.length > MAX_MANIFEST_EVENTS) {
        throw new Error(`source manifest must contain at most ${MAX_MANIFEST_EVENTS} events`);
    }

    const events = Object.create(null) as Record<string, readonly LoopAdSourceReference[]>;
    for (const [eventName, referencesValue] of entries) {
        const normalizedEventName = requiredText(eventName, "source manifest event name", 100);
        if (!Array.isArray(referencesValue) || referencesValue.length > MAX_REFERENCES_PER_EVENT) {
            throw new Error(
                `source manifest event ${normalizedEventName} must contain at most ${MAX_REFERENCES_PER_EVENT} references`
            );
        }
        events[normalizedEventName] = referencesValue.map((reference, index) =>
            parseReference(reference, normalizedEventName, index)
        );
    }

    if (!Array.isArray(manifest.externalEvents)) {
        throw new Error("source manifest externalEvents must be an array");
    }
    const externalEvents = manifest.externalEvents.map((eventName, index) =>
        requiredText(eventName, `source manifest externalEvents[${index}]`, 100)
    );
    if (new Set(externalEvents).size !== externalEvents.length) {
        throw new Error("source manifest externalEvents must not contain duplicates");
    }

    const generatedAt = requiredText(manifest.generatedAt, "source manifest generatedAt");
    if (!Number.isFinite(Date.parse(generatedAt))) {
        throw new Error("source manifest generatedAt must be an ISO date-time");
    }

    return {
        version: LOOPAD_SOURCE_MANIFEST_VERSION,
        buildId: requiredText(manifest.buildId, "source manifest buildId", 200),
        generatedAt,
        events,
        externalEvents
    };
}

function parseReference(value: unknown, eventName: string, index: number): LoopAdSourceReference {
    const reference = record(value, `source manifest ${eventName}[${index}]`);
    const file = requiredText(reference.file, `source manifest ${eventName}[${index}].file`);
    if (file.startsWith("/") || file.includes("..") || /^[A-Za-z]:[\\/]/.test(file)) {
        throw new Error(`source manifest ${eventName}[${index}].file must be relative`);
    }

    const kind = reference.kind;
    if (typeof kind !== "string" || !SOURCE_REFERENCE_KINDS.has(kind as LoopAdSourceReferenceKind)) {
        throw new Error(`source manifest ${eventName}[${index}].kind is invalid`);
    }

    return {
        file,
        line: integer(reference.line, `source manifest ${eventName}[${index}].line`, 1),
        column: integer(reference.column, `source manifest ${eventName}[${index}].column`, 0),
        kind: kind as LoopAdSourceReferenceKind
    };
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string {
    if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
        throw new Error(`${label} must be a non-empty string up to ${maxLength} characters`);
    }
    return value;
}

function integer(value: unknown, label: string, minimum: number): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
        throw new Error(`${label} must be an integer greater than or equal to ${minimum}`);
    }
    return value;
}
