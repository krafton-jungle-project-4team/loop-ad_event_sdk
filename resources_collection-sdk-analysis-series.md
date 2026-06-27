# 수집 SDK 분석 시리즈

상태: TODO. 이 파일은 아직 완성된 분석 글이 아니라, 수집 SDK 분석 시리즈를 작성할
때 사용할 source list와 질문 목록입니다.

## 검증할 오픈소스 소스

- Segment Analytics Next
  - [AnalyticsBrowser](https://github.com/segmentio/analytics-next/blob/master/packages/browser/src/browser/index.ts)
  - [EventQueue](https://github.com/segmentio/analytics-next/blob/master/packages/browser/src/core/queue/event-queue.ts)
  - [User identity store](https://github.com/segmentio/analytics-next/blob/master/packages/browser/src/core/user/index.ts)
- PostHog JS
  - [Autocapture](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/autocapture.ts)
  - [RequestQueue](https://github.com/PostHog/posthog-js/blob/main/packages/browser/src/request-queue.ts)
- Amplitude Browser SDK
  - [BrowserClient](https://github.com/amplitude/Amplitude-TypeScript/blob/main/packages/analytics-browser/src/browser-client.ts)
  - [Default tracking](https://github.com/amplitude/Amplitude-TypeScript/blob/main/packages/analytics-browser/src/default-tracking.ts)

## 분석할 질문

1. Public API는 어디까지 열고 어디부터 내부 구현으로 숨기는가?
2. user id, anonymous id, session id는 각각 어디에서 만들고 저장하는가?
3. 초기화 전 이벤트, offline 이벤트, 실패한 요청은 queue에 어떻게 보관하는가?
4. document-level autocapture는 어떤 event와 attribute를 수집하고 무엇을 제외하는가?
5. page view와 SPA route 변경은 어떤 plugin 또는 lifecycle로 처리하는가?
6. 민감한 form value, token, 긴 text, JSON 직렬화 실패는 어떻게 방어하는가?

## Loop Ad MVP와 비교할 항목

- 가져온 패턴: public API 축소, identity setter 분리, document-level delegation,
  명시 attribute 기반 수집, page metadata 자동 부착, transport 분리
- 의도적으로 제외한 패턴: anonymous id 생성, 로그인 전 queue, durable retry queue,
  batch transport, remote config, plugin system
