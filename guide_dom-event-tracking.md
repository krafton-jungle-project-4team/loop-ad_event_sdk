# DOM 이벤트 수집 가이드

이 문서는 HTML annotation으로 이벤트를 수집하는 방법을 설명합니다.

## 1. Tracking Plan에 이벤트를 등록합니다

DOM에서 보낼 event name과 properties를 Dashboard에 먼저 게시합니다.

```json
{
  "eventName": "product_selected",
  "propertiesSchema": {
    "type": "object",
    "properties": {
      "product_id": { "type": "string" },
      "position": { "type": "integer" },
      "featured": { "type": "boolean" },
      "labels": {
        "type": "array",
        "items": { "type": "string" }
      }
    },
    "required": ["product_id", "position"]
  }
}
```

## 2. JSON object attribute를 추가합니다

`data-loopad-event`에는 event name을, `data-loopad-properties`에는 JSON object를
넣습니다. HTML에서는 JSON key와 string value에 큰따옴표를 사용하고 attribute
전체를 작은따옴표로 감싸는 편이 안전합니다.

```html
<button
  data-loopad-event="product_selected"
  data-loopad-properties='{"product_id":"sku-1","position":3,"featured":true,"labels":["new"]}'
>
  Select
</button>
```

숫자와 boolean을 문자열로 바꾸지 마십시오. `"3"`은 `integer`가 아니고 `"true"`는
`boolean`이 아닙니다.

## 3. 필요하면 listener 종류를 지정합니다

기본 listener는 element에 따라 결정됩니다.

| element | 기본 event |
|---|---|
| `form` | `submit` |
| `select` | `change` |
| checkbox, radio input | `change` |
| 나머지 | `click` |

다른 browser event를 써야 하면 `data-loopad-listen`으로 명시합니다.

```html
<input
  data-loopad-event="search_changed"
  data-loopad-listen="change"
  data-loopad-properties='{"source":"header"}'
/>
```

## 4. element metadata를 제한적으로 추가합니다

SDK는 tag와 아래 opt-in metadata만 `element` 시스템 속성에 기록합니다.

```html
<button
  id="primary-action"
  data-loopad-id="action-1"
  data-loopad-label="Primary action"
  data-loopad-event="action_selected"
  data-loopad-properties='{"position":1}'
>
  Account-specific visible text
</button>
```

- `id`
- `data-loopad-id`
- `data-loopad-label`
- `data-loopad-text="true"`일 때의 visible text

사용자 입력값과 임의 DOM attribute는 수집하지 않습니다.

## 5. drop 사유를 확인합니다

개발 환경에서 `debug: true`로 초기화합니다.

```js
const sdk = await LoopAdEventSDK.init({
  connectionUrl: "https://dashboard.example/api/public/v1/sdk/connections/public_key",
  identity: {
    userId: "user-1",
    sessionId: "session-1"
  },
  debug: true
});
```

아래 조건이면 DOM event가 전송되지 않습니다.

- identity가 없음
- event가 게시된 Tracking Plan에 없음
- JSON 문법 오류 또는 root가 object가 아님
- 필수 key 누락, 미선언 key, 타입 오류
- JSON attribute가 UTF-8 32 KiB 초과
- 문자열 leaf가 신용카드 번호 또는 주민등록번호 형태

warning에는 attribute 원문이나 탐지된 민감 문자열이 포함되지 않습니다.
