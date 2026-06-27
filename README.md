# loop-ad_event_sdk

Loop Ad Event SDK는 고객사 웹사이트 또는 데모 쇼핑몰 프론트엔드에서 사용자 행동
이벤트를 수집해 Event Collector ingest endpoint로 보내는 브라우저 SDK입니다.

이 SDK는 서버, Kafka, ClickHouse, Redis, AWS secret을 직접 다루지 않습니다.
브라우저에서 ClickHouse `events` 테이블에 맞는 JSON payload를 만들고,
`https://ingest.dev.loop-ad.org`로 전송하는 것만 담당합니다.

## 참고한 계약

- `loop-ad_infra/docs/app-repository-guide.md`: 앱 repo는 인프라를 직접 만들지
  않고 정해진 contract를 따른다.
- `loop-ad_infra/docs/service-endpoints.md`: Event ingest public endpoint는
  `https://ingest.dev.loop-ad.org`를 고정 contract로 사용한다.
- ClickHouse `events` 테이블: 사용자 행동 로그와 추천/광고 reward 계산의 원천
  이벤트를 저장한다.

## 설치와 검증

```bash
npm install
npm run verify
```

빌드 결과:

```text
dist/index.mjs
dist/index.cjs
dist/loop-ad-event-sdk.iife.js
dist/types/index.d.ts
```

## ESM 사용

```ts
import { init } from "loop-ad_event_sdk";

const sdk = init({
  projectId: "demo-shoppingmall",
  context: {
    channel: "demo",
    device: "mobile"
  }
});

sdk.identify("user-123");

sdk.track("product_view", {
  category: "Home/Eco-Friendly",
  productId: "GGOEGCBD142299",
  inventoryStatus: "in_stock",
  price: 12900
});
```

## script tag 사용

```html
<script src="https://cdn.example.com/loop-ad-event-sdk.iife.js"></script>
<script>
  const sdk = LoopAdEventSDK.init({
    projectId: "demo-shoppingmall"
  });

  sdk.track("checkout_start", {
    quantity: 2
  });
</script>
```

## 표준 이벤트명

ClickHouse 분석과 추천 서버의 퍼널 분석을 위해 아래 이름을 우선 사용합니다.

```text
page_view
product_view
add_to_cart
checkout_start
purchase
ad_impression
ad_click
coupon_issued
coupon_used
```

## DOM attribute 수집

마크업에 `data-loopad-event`를 붙이면 SDK가 document event delegation으로
수집합니다.

```html
<button
  data-loopad-event="add_to_cart"
  data-loopad-product-id="GGOEGCBD142299"
  data-loopad-category="Home/Eco-Friendly"
  data-loopad-price="12900"
  data-loopad-quantity="1"
>
  Add to cart
</button>
```

지원 attribute 예시:

```text
data-loopad-channel
data-loopad-campaign-id
data-loopad-age-group
data-loopad-gender
data-loopad-device
data-loopad-category
data-loopad-product-id
data-loopad-inventory-status
data-loopad-price
data-loopad-quantity
data-loopad-revenue
data-loopad-coupon-id
data-loopad-order-id
data-loopad-experiment-id
data-loopad-variant-id
data-loopad-action-id
data-loopad-mapping-id
data-loopad-ad-id
data-loopad-creative-id
data-loopad-bandit-policy-id
data-loopad-bandit-arm-id
data-loopad-bandit-decision-id
data-loopad-reward-value
```

추가 속성은 `data-loopad-prop-*`로 보낼 수 있습니다.

```html
<button
  data-loopad-event="coupon_issued"
  data-loopad-coupon-id="WELCOME10"
  data-loopad-prop-slot="main_banner"
>
  Issue coupon
</button>
```

## Payload 형식

SDK는 Event Collector로 아래처럼 ClickHouse `events` 컬럼에 맞춘 flat JSON을
전송합니다.

```json
{
  "project_id": "demo-shoppingmall",
  "event_id": "evt_...",
  "user_id": "user-123",
  "session_id": "sess_...",
  "event_time": "2026-06-27T10:00:00.000Z",
  "event_name": "product_view",
  "channel": "demo",
  "campaign_id": "",
  "age_group": "",
  "gender": "",
  "device": "mobile",
  "category": "Home/Eco-Friendly",
  "product_id": "GGOEGCBD142299",
  "inventory_status": "in_stock",
  "price": 12900,
  "quantity": 0,
  "revenue": 0,
  "coupon_id": "",
  "order_id": "",
  "experiment_id": "",
  "variant_id": "",
  "action_id": "",
  "mapping_id": "",
  "ad_id": "",
  "creative_id": "",
  "bandit_policy_id": "",
  "bandit_arm_id": "",
  "bandit_decision_id": "",
  "reward_value": 0,
  "properties_json": "{\"page\":...,\"sdk\":...}"
}
```

## 개인정보와 보안

- SDK는 input, textarea, select 값을 자동으로 읽지 않습니다.
- 버튼 텍스트도 기본 수집하지 않습니다.
- visible text가 꼭 필요하면 `data-loopad-text="true"` 또는
  `data-loopad-label`을 명시합니다.
- secret, DB credential, API key는 브라우저 SDK 옵션에 넣지 않습니다.

운영 적용 전에는 고객사 서비스의 동의 화면, 개인정보 처리방침, 보관 기간,
국가별 규제 요구사항을 별도로 검토해야 합니다.

## 개발 문서

- [코드 구조 튜토리얼](docs/code-structure-tutorial.md)
