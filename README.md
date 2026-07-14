# Loop Ad Event SDK

브라우저에서 임의의 제품 도메인 이벤트를 수집하는 Tracking Plan 기반 SDK입니다.
SDK는 특정 이벤트명이나 속성명을 내장하지 않습니다. Dashboard에 게시된 connection
snapshot을 읽고 이벤트명과 JSON 속성을 런타임에 검증합니다.

## 설치

```text
@krafton-jungle-project-4team:registry=https://npm.pkg.github.com
```

```bash
npm install @krafton-jungle-project-4team/loop-ad_event_sdk
```

script tag가 필요하면 GitHub Pages의 IIFE bundle을 사용할 수 있습니다.

```html
<script src="https://krafton-jungle-project-4team.github.io/loop-ad_event_sdk/loop-ad-event-sdk.iife.js"></script>
```

## 초기화

`init()`은 Dashboard가 발급한 공개 connection URL만 받습니다. connection 조회 또는
계약 검증이 실패하면 Promise가 reject됩니다.

```js
import { init } from "@krafton-jungle-project-4team/loop-ad_event_sdk";

const sdk = await init({
  connectionUrl:
    "https://dashboard.api.dev.loop-ad.org/api/public/v1/sdk/connections/public_sdk_key",
  identity: {
    userId: currentUser.id,
    sessionId: currentSession.id
  },
  context: {
    application_version: "2026.07"
  },
  debug: import.meta.env.DEV
});
```

identity를 나중에 알게 되는 앱은 로그인 또는 세션 복구 후 설정합니다.

```js
sdk.setIdentity(
  {
    userId: currentUser.id,
    sessionId: currentSession.id
  },
  {
    application_version: "2026.07"
  }
);
```

로그아웃할 때는 `clearIdentity()`를 호출합니다. identity가 없는 동안 발생한 이벤트는
queue에 보관하지 않고 버립니다.

```js
sdk.clearIdentity();
```

## 이벤트 전송

두 번째 인자는 Tracking Plan으로 검증할 JSON 속성이고 세 번째 인자는 이벤트 envelope
옵션입니다. 속성의 문자열, 유한한 숫자, boolean, 배열, 중첩 객체 타입은 그대로
보존됩니다.

```js
sdk.track(
  "checkout_completed",
  {
    order_id: "order-123",
    amount: 129000.5,
    quantity: 2,
    refundable: true,
    tags: ["mobile", "new"],
    item: {
      sku: "sku-1",
      count: 2
    }
  },
  {
    eventId: "evt_123",
    eventTime: new Date()
  }
);
```

### Client API

| method | 설명 |
|---|---|
| `track(eventName, properties?, options?)` | 등록된 이벤트를 검증하고 전송합니다. |
| `setIdentity(identity, context?)` | `{ userId, sessionId }`와 선택적인 공유 속성을 설정합니다. |
| `clearIdentity()` | identity와 identity context를 제거합니다. |
| `destroy()` | DOM 및 History API listener를 제거합니다. |

### InitOptions

| option | 필수 | 기본값 | 설명 |
|---|---:|---|---|
| `connectionUrl` | yes | 없음 | Dashboard 공개 SDK connection URL |
| `identity` | no | `null` | `{ userId, sessionId }` |
| `context` | no | `{}` | 모든 이벤트 속성과 병합할 범용 JSON 객체 |
| `debug` | no | `false` | 콘솔 로그와 우측 하단 SDK DevTools 활성화 |
| `autoTrackPageViews` | no | `true` | 최초 identity 설정과 SPA URL 변경 시 `page_view` 전송 |
| `collectDomEvents` | no | `true` | annotation된 DOM event 수집 |

context도 이벤트 속성입니다. context의 각 key는 이를 사용하는 모든 이벤트 schema에
선언되어야 합니다. 병합 순서는 init context, identity context, `track()` properties
순서이며 뒤의 값이 앞의 값을 덮어씁니다.

## Tracking Plan 검증

지원하는 schema subset은 `object`, `string`, `number`, `integer`, `boolean`, `array`,
`properties`, `required`, `items`입니다.

```json
{
  "eventName": "checkout_completed",
  "description": "결제가 끝난 시점",
  "propertiesSchema": {
    "type": "object",
    "properties": {
      "order_id": { "type": "string" },
      "amount": { "type": "number" },
      "item": {
        "type": "object",
        "properties": {
          "sku": { "type": "string" },
          "count": { "type": "integer" }
        },
        "required": ["sku", "count"]
      }
    },
    "required": ["order_id", "amount", "item"]
  }
}
```

객체는 모든 depth에서 폐쇄형입니다. schema에 없는 key, 미등록 이벤트, 필수 key
누락, 잘못된 타입, `null`, `NaN`, 순환 참조는 전송 전에 거부됩니다. schema 자체도
최대 depth 8, 최대 node 100으로 제한합니다.

`page_path`, `page`, `sdk`, `element`는 SDK가 추가하는 최상위 시스템 속성이므로
Tracking Plan이나 호출자 속성에서 사용할 수 없습니다. `__proto__`, `prototype`,
`constructor`는 모든 depth에서 거부됩니다.

connection 응답에 포함된 `events` snapshot이 검증 기준입니다. SDK는 별도 schema
요청을 하지 않으며 connection URL별로 최대 5분 동안 유효한 응답을 메모리에
cache합니다.

## 디버그

`debug: true`: 콘솔 로그, 우측 하단 `LoopAd SDK` 버튼

| 탭 | 확인할 수 있는 정보 |
|---|---|
| 개요 | Connection, identity, project, Collector, schema version, revision |
| 스키마 | 이벤트별 필드, 타입, 필수 여부 |
| 검증 | 차단 이벤트, 수정 항목 |
| 요청 | 최근 50개 전송 상태, HTTP status, 요청 크기 |

- Connection 실패: 개요 탭에 실패 사유
- 검증·요청 문제: 탭과 버튼에 경고 배지
- UI 상태: `localStorage`
- 기록 제외: event property 값, Collector payload, identity 값
- 패널 제거: `destroy()`

## DOM event

DOM 속성은 `data-loopad-properties` 하나만 사용합니다. 값은 JSON object여야 하며
Tracking Plan과 같은 타입 검증을 거칩니다.

```html
<button
  data-loopad-event="product_selected"
  data-loopad-properties='{"product_id":"sku-1","position":3,"featured":true,"labels":["new"]}'
>
  Select
</button>
```

SDK는 `data-loopad-properties` 외의 event property attribute를 읽지 않습니다.
자세한 적용 방법은
[DOM 이벤트 수집 가이드](guide_dom-event-tracking.md)를 참고합니다.

## 자동 속성

검증을 통과한 호출자 속성 뒤에 SDK가 아래 시스템 정보를 붙입니다.

- `page_path`: 현재 URL path
- `page`: URL, path, title, referrer, 이전 URL
- `sdk`: SDK 이름과 버전
- `element`: DOM event가 발생한 element의 제한된 metadata

Collector envelope의 `project_id`, `write_key`, `collectorUrl`은 connection 응답에서
가져옵니다. connection의 `schemaVersion`은 Tracking Plan 형식에 사용하며, 이벤트
envelope의 `schema_version`은 Collector 계약인 `hotel_rec_promo.v1`을 사용합니다.
SDK source는 `browser_sdk`입니다.

## 제한과 보안

- DOM JSON attribute: UTF-8 32 KiB 이하
- Collector request body: UTF-8 256 KiB 이하
- DOM 문자열 값이 신용카드 번호 또는 주민등록번호 형태로 보이면 event drop
- DOM visible text는 기본 수집하지 않으며 `data-loopad-label` 또는
  `data-loopad-text="true"`로 명시한 경우에만 최대 160 bytes 수집
- debug warning에는 DOM 원문을 포함하지 않음

## 개발

```bash
npm install
npm run verify
```

빌드 결과는 `dist/index.mjs`, `dist/index.cjs`,
`dist/loop-ad-event-sdk.iife.js`, `dist/types/index.d.ts`입니다.
