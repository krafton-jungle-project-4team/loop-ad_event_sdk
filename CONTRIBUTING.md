# Contributing to loop-ad_event_sdk

이 문서는 저장소에 기여할 때 따르는 개발 절차를 설명합니다. SDK 사용 방법은
[README.md](README.md)를 기준으로 유지합니다.

## 개발 환경

- Node.js 20 이상
- npm

처음 시작할 때 의존성을 설치합니다.

```bash
npm install
```

## 로컬 검증

변경 후에는 아래 명령을 실행합니다.

```bash
npm run verify
```

개별 명령이 필요하면 아래처럼 나누어 실행할 수 있습니다.

```bash
npm run typecheck
npm run build
npm test
```

- `npm run build`: ESM, CJS, browser IIFE bundle과 `.d.ts`를 생성합니다.
- `npm test`: Node test runner로 SDK runtime 동작을 검증합니다.
- `npm run verify`: typecheck, build, test를 한 번에 실행합니다.

## 프로젝트 구조

```text
.
├── README.md
├── CONTRIBUTING.md
├── resources_collection-sdk-analysis-series.md
├── examples/
│   └── basic.html
├── scripts/
│   └── build.mjs
├── src/
│   └── index.ts
├── tests/
│   └── sdk.test.mjs
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

## SDK 내부 구성

외부에 노출되는 API는 아래로 제한합니다.

```text
init(options)
client.track(eventName, fields)
client.setIdentity(identity, context?)
client.clearIdentity()
client.destroy()
```

실행 흐름은 다음처럼 작게 유지합니다.

```text
init(options)
  -> Runtime.start()
  -> document-level DOM event delegation
  -> History API 기반 page_view 감지
  -> identity gate
  -> ClickHouse events 형식 payload 생성
  -> Event Collector ingest endpoint로 fetch 전송
```

SDK가 직접 Kafka, ClickHouse, Redis, AWS secret을 읽지 않습니다. 브라우저에서
이벤트 draft를 만들고, identity가 있으면 Event Collector ingest endpoint로 보내는
것만 담당합니다.

## 변경 절차

1. 동작 변경은 `src/index.ts`에 작게 반영합니다.
2. 변경한 동작은 `tests/sdk.test.mjs`에서 검증합니다.
3. 외부 사용법이 달라지면 `README.md`를 함께 수정합니다.
4. 내부 개발 절차가 달라지면 이 파일을 수정합니다.
5. 커밋 전 `npm run verify`를 실행합니다.

## 문서 작성 기준

- `README.md`: SDK 소개, 사용 방법, 공개 동작, payload 예시를 유지합니다.
- `CONTRIBUTING.md`: 개발 환경, 검증, 변경 절차 같은 process/how-to 내용을 유지합니다.
- `resources_collection-sdk-analysis-series.md`: Segment, PostHog, Amplitude 분석처럼
  README에 넣기 긴 supporting material을 관리합니다.

꼭 필요한 문서가 아니면 새 파일을 만들지 않고 README에 반영합니다.
문서가 길어져 역할이 섞이면 Diátaxis 기준으로 tutorial, how-to, reference,
explanation 중 하나를 먼저 정하고 분리합니다.
