# 성숙한 분석 SDK 패턴 분석

이 문서는 Segment Analytics Next, PostHog JS, Amplitude Browser SDK의 공개 소스와
문서를 보고 `loop-ad_event_sdk` MVP에 반영할 최소 패턴을 정리합니다.

## 참고 소스

- Segment Analytics Next
  - Browser entry: <https://github.com/segmentio/analytics-next/tree/master/packages/browser/src/browser>
  - Core source: <https://github.com/segmentio/analytics-next/tree/master/packages/browser/src/core>
  - Event queue: <https://github.com/segmentio/analytics-next/blob/master/packages/browser/src/core/queue/event-queue.ts>
  - User identity: <https://github.com/segmentio/analytics-next/blob/master/packages/browser/src/core/user/index.ts>
  - Page lifecycle utility: <https://github.com/segmentio/analytics-next/blob/master/packages/browser/src/lib/on-page-change.ts>
- PostHog JS
  - Browser SDK source: <https://github.com/PostHog/posthog-js/tree/main/packages/browser/src>
  - Autocapture: <https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts>
  - Request queue: <https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/request-queue.ts>
  - Autocapture docs: <https://posthog.com/docs/product-analytics/autocapture>
  - Identify docs: <https://posthog.com/docs/product-analytics/identify>
- Amplitude Browser SDK
  - Browser SDK source: <https://github.com/amplitude/Amplitude-TypeScript/tree/main/packages/analytics-browser/src>
  - Browser client: <https://github.com/amplitude/Amplitude-TypeScript/blob/main/packages/analytics-browser/src/browser-client.ts>
  - Default tracking config: <https://github.com/amplitude/Amplitude-TypeScript/blob/main/packages/analytics-browser/src/default-tracking.ts>
  - Browser SDK docs: <https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2>

## 공통 구성요소

| 구성요소 | 성숙한 SDK에서의 역할 | MVP 반영 |
|---|---|---|
| Public client | `track`, `identify`, `setUserId`, `setSessionId`, `reset` 같은 API를 제공 | `track`, `pageView`, `setIdentity`, `clearIdentity`, `identify` |
| Config normalization | SDK 시작 전에 endpoint, tracking 옵션, default 값을 확정 | `withDefaultInitOptions()` |
| Identity manager | user id, anonymous id, session id를 분리 관리 | anonymous id를 만들지 않고 `Identity { userId, sessionId }`만 관리 |
| Autocapture | document-level listener로 click/change/submit 등 수집 | `data-loopad-event` 기반 DOM event delegation |
| Page tracking | 초기 page view와 SPA route 변경을 수집 | History API patch + `popstate`/`hashchange` |
| Queue | 초기화 전, offline, transport pause 상태에서 이벤트 보관 | 로그인 전 이벤트 queue는 제외, 이후 retry queue만 후보 |
| Transport | fetch, beacon, batch 등 실제 전송 담당 | MVP는 event 1개당 `fetch` 1회 |
| Privacy guard | 민감 input value나 token 수집 방지 | input/select/textarea value 자동 수집 없음, JWT 금지 |
| Extensibility | plugin, destination, remote config로 확장 | MVP에서는 파일 분리 대신 책임 경계만 주석으로 보존 |

## SDK별 관찰

### Segment Analytics Next

Segment는 browser entry, core analytics, event queue, user storage, plugin 계층이
나뉘어 있습니다. `EventQueue`는 persisted priority queue를 사용하고 offline이면
flush하지 않습니다. `User`는 user id, anonymous id, traits를 storage 계층에
분리해 저장합니다.

우리 프로젝트는 익명 이벤트를 보내지 않는 정책이므로 anonymous id storage와
pre-login queue는 가져오지 않았습니다. 대신 Segment의 `capture -> payload ->
transport` 책임 분리만 작게 반영했습니다.

### PostHog JS

PostHog의 autocapture는 document에 `submit`, `change`, `click` listener를 capture
phase로 붙이고, element chain과 안전한 attribute만 properties로 만듭니다.
request queue는 pause 상태에서 시작하고, enable 후 일정 interval로 batch flush를
수행합니다.

MVP에서는 batch와 remote config는 제외했습니다. 대신 document-level delegation,
민감 value 미수집, 명시 attribute 기반 수집만 반영했습니다.

### Amplitude Browser SDK

Amplitude는 `BrowserClient`가 `setUserId`, `setSessionId`, `setIdentity`, `reset`,
default tracking plugin 설치를 담당합니다. `default-tracking.ts`는 page views,
sessions, form interactions, element interactions 같은 자동 수집 기능을 설정별로
켜고 끄는 판단을 분리합니다.

MVP에서는 plugin 시스템은 만들지 않았습니다. 대신 `autoTrackPageViews`,
`collectDomEvents`, `setIdentity`, `clearIdentity`처럼 작은 API로 자동 수집과
identity gate를 제어합니다.

## Loop Ad MVP 설계 결정

1. SDK는 앱 부팅 시 바로 `init()` 가능하다.
2. 기본값으로 identity 없이는 전송하지 않는다.
3. 초기 auth 확인 중 발생한 이벤트는 메모리에 보관하지 않고 drop한다.
4. `setIdentity({ userId, sessionId })`가 호출되면 이후 이벤트부터 전송한다.
5. `clearIdentity()` 이후 identity 없는 이벤트는 다시 drop한다.
6. DOM 자동 수집은 명시적으로 `data-loopad-event`가 붙은 요소만 대상으로 한다.
7. input, textarea, select 값과 JWT/token은 SDK가 읽거나 전송하지 않는다.

## 나중에 추가할 수 있는 것

- durable retry queue: identity가 있는 이벤트의 네트워크 실패 재시도용 queue
- batch transport: Event Collector가 batch endpoint를 제공할 때 추가
- sendBeacon fallback: page unload 시 보장 강화
- schema validation: event_name별 필수 field 검증
- remote config: 고객사별 autocapture allowlist/denylist 내려받기
- consent gate: 지역별 개인정보 동의 상태와 연동
