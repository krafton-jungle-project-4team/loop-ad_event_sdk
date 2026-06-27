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

개별 명령이 필요하면 아래처럼 나누어 실행할 수 있습니다. `npm test`는
`dist/index.mjs`를 import하므로 clean checkout에서는 먼저 `npm run build`를
실행해야 합니다.

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
├── .gitignore
├── .github/
│   └── workflows/
│       └── publish-github-packages.yml
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
├── package-lock.json
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

## 배포 문서 주의사항

`package.json`의 `files` 설정은 npm package에 `dist/`와 `README.md`만 포함합니다.
`CONTRIBUTING.md`와 `resources_*.md`는 GitHub 저장소에서 보는 개발 문서입니다.
패키지 사용자에게 꼭 필요한 내용은 README에 남겨야 합니다.

## GitHub Packages 배포

`main` branch로 PR이 merge되면 `.github/workflows/publish-github-packages.yml`이
실행됩니다.

workflow는 다음 순서로 동작합니다.

1. `npm ci`로 의존성을 설치합니다.
2. KST 기준 날짜와 `GITHUB_RUN_NUMBER`로 `0.1.YYYYMMDD-run.N` 버전을 만듭니다.
3. `npm version --no-git-tag-version`으로 workflow 작업 디렉터리의 package version만 바꿉니다.
4. `npm run verify`로 typecheck, build, test를 실행합니다.
5. `npm publish`로 GitHub Packages에 배포합니다.

GitHub Actions의 `GITHUB_TOKEN`을 사용하므로 repo workflow 권한에는
`packages: write`가 필요합니다. 별도 npm token secret은 사용하지 않습니다.
