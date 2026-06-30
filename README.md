# loop-ad_event_sdk

Loop Ad Event SDK는 고객사 웹사이트 또는 데모 쇼핑몰 프론트엔드에서 사용자 행동
이벤트를 수집해 Event Collector public API endpoint로 보내는 브라우저 SDK입니다.

SDK는 앱 시작 시 바로 붙일 수 있지만 `userId`와 `sessionId`가 준비되기 전에는
Event Collector로 전송하지 않습니다. 로그인 이전 활동은 메모리에 보관하지 않고
drop하며, `setIdentity()`가 처음 identity를 설정하면 현재 페이지를 자동으로
`page_view` 기록합니다.

## 참고한 계약

- `loop-ad_infra/docs/app-repository-guide.md`: 앱 repo는 인프라를 직접 만들지
  않고 정해진 contract를 따르며, Event Collector public endpoint는 Public API
  Domains 계약에 따라 `https://event.api.dev.loop-ad.org`를 고정 사용한다.
- ClickHouse `events` 테이블: 사용자 행동 로그와 추천/광고 reward 계산의 원천
  이벤트를 저장한다.

## 참고한 SDK 패턴

SDK 구성은 Segment Analytics Next, PostHog JS, Amplitude Browser SDK의 공통
구조를 참고했습니다.

- Segment Analytics Next: public API, identity store, queue, page lifecycle을
  분리하는 방식을 참고한다.
- PostHog JS: document-level autocapture와 안전한 속성 수집 방식을 참고한다.
- Amplitude Browser SDK: identity/session setter와 default tracking 경계를
  참고한다.

자세한 비교 분석은 루트의 [수집 SDK 분석 시리즈](resources_collection-sdk-analysis-series.md)에
따로 정리할 예정입니다.

## 사용 방식

SDK는 두 가지 방식으로 붙일 수 있습니다.

- npm package: 앱 번들러에서 `import { init } ...` 형태로 사용합니다.
- script tag: 빌드된 IIFE bundle을 `<script src="...">`로 직접 불러옵니다.

script tag 방식은 Shopify 앱, CMS, 정적 HTML, 외부 고객사 페이지처럼 npm build
pipeline에 SDK를 직접 넣기 어려운 경우를 위한 경로입니다.

## 설치와 배포

이 패키지는 GitHub Packages npm registry에
`@krafton-jungle-project-4team/loop-ad_event_sdk` 이름으로 배포합니다. PR이
`main`에 merge되면 GitHub Actions가 KST 날짜와 workflow run number를 조합해
`0.1.YYYYMMDD-run.N.A` 형식의 버전을 만들고 publish합니다.

같은 workflow가 browser IIFE bundle도 GitHub Pages로 배포합니다. public repo에서
Pages 배포가 한 번 성공하면 아래 URL을 script tag에서 바로 사용할 수 있습니다.

```text
https://krafton-jungle-project-4team.github.io/loop-ad_event_sdk/loop-ad-event-sdk.iife.js
```

설치하는 프로젝트의 `.npmrc`에 GitHub Packages registry를 추가합니다.

```text
@krafton-jungle-project-4team:registry=https://npm.pkg.github.com
```

그 다음 패키지를 설치합니다.

```bash
npm install @krafton-jungle-project-4team/loop-ad_event_sdk
```

로컬 또는 데모에서 browser bundle을 직접 만들 때는 아래 명령을 사용합니다.

```bash
npm install
npm run build
```

생성되는 산출물:

```text
dist/index.mjs
dist/index.cjs
dist/loop-ad-event-sdk.iife.js
dist/types/index.d.ts
```

`dist/`는 빌드 산출물이므로 git에는 커밋하지 않습니다.

## 권장 사용

앱 부팅 시 SDK를 먼저 시작합니다. 이 시점에는 로그인 사용자 정보가 없어도 됩니다.

```js
import { init } from "@krafton-jungle-project-4team/loop-ad_event_sdk";

const sdk = init({
  projectId: "demo-shoppingmall",
  context: {
    channel: "demo",
    device: "mobile"
  }
});
```

인증 상태가 준비되면 앱의 auth/session layer가 identity를 주입합니다.

```js
const user = await fetchMe();

if (user) {
  sdk.setIdentity({
    userId: user.id,
    sessionId: user.session.id
  });
}
```

로그인/회원가입 성공 콜백에서도 같은 방식으로 호출합니다.

```js
async function onSignupSuccess(result) {
  sdk.setIdentity({
    userId: result.user.id,
    sessionId: result.session.id
  }, {
    ageGroup: result.user.ageGroup
  });

  sdk.track("signup_completed");
}
```

로그아웃 시에는 identity를 비웁니다.

```js
sdk.clearIdentity();
```

### Client methods

| method | 설명 |
|---|---|
| `track(eventName, fields?)` | 문자열 이벤트명을 수집합니다. identity가 없으면 queue에 넣지 않고 drop합니다. |
| `setIdentity(identity, context?)` | `{ userId, sessionId }`를 설정하고 선택적으로 공유 context를 갱신합니다. 최초 identity 설정 시 현재 페이지를 `page_view`로 1회 기록합니다. |
| `clearIdentity()` | 로그아웃 시 identity를 제거합니다. 이후 이벤트는 새 identity가 들어오기 전까지 drop됩니다. |
| `destroy()` | DOM listener와 History API patch를 정리합니다. 테스트, hot reload, microfrontend unmount에서 사용합니다. |

### Init options

| option | 필수 | 기본값 | 설명 |
|---|---:|---|---|
| `projectId` | yes | 없음 | Event Collector payload의 `project_id`로 들어가는 서비스 식별자 |
| `identity` | no | `null` | 앱 시작 시 이미 로그인 상태를 알고 있을 때 전달하는 `{ userId, sessionId }` |
| `context` | no | `{}` | 이후 이벤트에 공통으로 붙일 channel, device, campaign 등 flat context |
| `debug` | no | `false` | drop, send fail 같은 SDK 내부 경고를 console에 출력 |
| `autoTrackPageViews` | no | `true` | init identity 또는 최초 `setIdentity()` 시 현재 페이지를 기록하고 SPA URL 변경을 추적 |
| `collectDomEvents` | no | `true` | `data-loopad-event`가 붙은 DOM event를 document delegation으로 수집 |

## script tag 사용

GitHub Pages로 배포된 IIFE bundle을 직접 불러올 수 있습니다.

```html
<script src="https://krafton-jungle-project-4team.github.io/loop-ad_event_sdk/loop-ad-event-sdk.iife.js"></script>
<script>
  const sdk = LoopAdEventSDK.init({
    projectId: "demo-shoppingmall"
  });

  window.onAuthReady = function (user, session) {
    sdk.setIdentity({
      userId: user.id,
      sessionId: session.id
    });
  };
</script>
```

운영에서 자체 CDN, S3/CloudFront, 정적 파일 서버를 쓰고 싶으면
`dist/loop-ad-event-sdk.iife.js`를 같은 방식으로 올려서 사용합니다. 로컬 예시는
[examples/basic.html](examples/basic.html)을 참고합니다.

## 이벤트명

`track()`의 첫 번째 인자는 문자열입니다. SDK가 브라우저에서 표준 이벤트가 아닌
이름을 차단하지는 않습니다.

Loop Ad 분석과 추천 파이프라인에서는 아래 표준 이벤트명을 우선 사용합니다.

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

고객사 서비스에서 필요한 커스텀 이벤트도 전송할 수 있습니다.

```js
sdk.track("signup_completed");
sdk.track("banner_hovered", { campaignId: "summer-2026" });
```

운영에서 엄격한 이벤트명 검증이 필요하면 브라우저 SDK가 아니라 Event Collector
또는 tracking plan 단계에서 처리합니다.

## DOM attribute 수집

마크업에 `data-loopad-event`를 붙이면 SDK가 document event delegation으로
수집합니다. identity가 준비되기 전이면 전송하지 않고 drop합니다.

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

수집 event type은 기본적으로 요소 종류에 따라 정해집니다.

```text
form              -> submit
select            -> change
input checkbox    -> change
input radio       -> change
그 외 요소        -> click
```

다른 browser event를 듣고 싶으면 `data-loopad-listen`을 명시합니다.

```html
<form data-loopad-event="checkout_start" data-loopad-listen="submit">
  ...
</form>
```

SDK는 버튼 텍스트를 기본 수집하지 않습니다. 필요할 때만 아래처럼 명시합니다.

```html
<button data-loopad-event="ad_click" data-loopad-label="hero_cta">
  Start
</button>
```

## Identity gate

기본 정책은 아래와 같습니다.

```js
const sdk = init({ projectId: "demo-shoppingmall" });

sdk.track("product_view", { productId: "SKU-before-login" }); // dropped

sdk.setIdentity({
  userId: "user-1",
  sessionId: "session-1"
}); // current page_view is sent once

sdk.track("product_view", { productId: "SKU-after-login" }); // sent
```

- `userId`, `sessionId` 없이는 이벤트를 전송하지 않는다.
- 로그인 이전 활동은 SDK가 메모리에 보관하지 않는다.
- `setIdentity()`: 이후 이벤트에 사용할 `userId`, `sessionId`를 설정하고 현재
  페이지를 1회 자동 기록한다.
- `clearIdentity()`: logout 후 identity 없는 이벤트를 다시 drop한다.
- 예외적으로 page view를 직접 보내야 하면 별도 API 대신
  `track("page_view")`를 사용한다.

JWT, access token, refresh token은 SDK 옵션이나 이벤트 payload에 넣지 않습니다.
SDK는 anonymous id를 만들지 않습니다.

## Payload 형식

SDK는 Event Collector로 아래처럼 ClickHouse `events` 컬럼에 맞춘 flat JSON을
전송합니다. 요청 도메인은 `loop-ad_infra/docs/app-repository-guide.md`의 Public
API Domains 계약에 따라 `https://event.api.dev.loop-ad.org`로 고정합니다.

`properties_json`에는 기본적으로 page 정보와 SDK 정보가 들어가며, DOM 수집 시
element metadata와 `data-loopad-prop-*` 값이 함께 들어갑니다.

```json
{
  "project_id": "demo-shoppingmall",
  "event_id": "evt_...",
  "user_id": "user-123",
  "session_id": "session-123",
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
- secret, DB credential, API key, JWT는 브라우저 SDK 옵션에 넣지 않습니다.

운영 적용 전에는 고객사 서비스의 동의 화면, 개인정보 처리방침, 보관 기간,
국가별 규제 요구사항을 별도로 검토해야 합니다.

## 개발과 기여

로컬 개발, 검증, 문서 변경 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)를 봅니다.
SDK 비교/분석처럼 분량이 커지는 글만 루트 Markdown 파일로 별도 관리합니다.
