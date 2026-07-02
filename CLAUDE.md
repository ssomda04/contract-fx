@AGENTS.md

# contract-fx

## 프로젝트 목표

웹캠 입력을 받아 [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision) 으로
손(Hand Landmarker) / 몸(Pose Landmarker) 랜드마크를 실시간으로 감지하고, 사전에 정의한 제스처
(여우 소환, 슬래시, 차지 등)가 인식되면 화면에 애니메이션 이펙트를 발동시키는 브라우저 기반
인터랙티브 웹앱을 만든다. 모든 처리는 클라이언트(브라우저) 사이드에서 수행하며, 최종적으로는
포트폴리오로 공개 가능한 수준의 완성도를 목표로 한다.

## 개발 규칙

- App Router(`src/app/`) 기준으로 개발한다. import alias는 `@/*` → `src/*` 를 사용한다
  (`tsconfig.json` 기준).
- 웹캠, MediaPipe, `<canvas>` 조작 등 브라우저 API를 쓰는 컴포넌트에만 `"use client"`를 붙인다.
  나머지는 기본 서버 컴포넌트로 유지한다.
- MediaPipe 초기화/추론/후처리 로직은 `lib/mediapipe/` 안에 캡슐화하고, UI 컴포넌트는 가공된
  결과(랜드마크 좌표, 감지된 제스처 이벤트)만 소비한다. 컴포넌트 안에 MediaPipe raw API 호출을
  직접 흩뿌리지 않는다.
- 제스처 판정 로직(좌표 → 제스처 여부)은 `lib/gestures/` 에 순수 함수로 분리하고, React 상태와
  결합하지 않는다. 판정 함수는 랜드마크 배열을 입력받아 boolean/이벤트를 반환하는 형태를 기본으로 한다.
- 타입은 `strict` 모드를 유지하고 `any`를 남용하지 않는다. MediaPipe 결과 타입은
  `lib/types/` 에 정의해 재사용한다.
- 스타일은 Tailwind 유틸리티 클래스를 우선 사용하고, 커스텀 CSS는 `globals.css`에 최소한으로만 둔다.
- 새 기능은 [docs/ROADMAP.md](docs/ROADMAP.md) 의 해당 버전 범위를 벗어나지 않는다. 범위를
  넘는 작업이 필요하면 먼저 로드맵을 갱신하고 진행한다.
- 필요한 만큼만 구현한다. 나중을 위한 추상화, 아직 쓰이지 않는 옵션/설정, 방어적 에러 처리를
  미리 만들어두지 않는다.

## 파일 구조

```
contract-fx/
├── CLAUDE.md
├── AGENTS.md
├── docs/
│   ├── ROADMAP.md          # 버전별(v0~v6) 구현 로드맵
│   └── GESTURES.md         # 제스처별 좌표 기반 감지 기준
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── webcam/          # 웹캠 화면 출력, 권한 처리
│   │   ├── landmarks/       # 랜드마크 오버레이(canvas) 렌더링
│   │   └── effects/         # 제스처 발동 시 애니메이션 이펙트
│   ├── hooks/                # 브라우저 API를 감싸는 커스텀 훅 (useWebcam 등)
│   └── lib/
│       ├── mediapipe/       # HandLandmarker/PoseLandmarker 초기화 및 추론 래퍼
│       ├── gestures/        # 제스처 판정 순수 함수 (여우 소환 / 슬래시 / 차지 등)
│       └── types/            # 공용 타입 정의
└── public/
    └── models/               # MediaPipe .task 모델 파일 (필요 시)
```

실제 구현 단계에서 하위 디렉터리는 로드맵 진행에 맞춰 필요할 때만 생성한다.

## npm 명령어

- `npm run dev` — 개발 서버 실행 (http://localhost:3000)
- `npm run build` — 프로덕션 빌드
- `npm run start` — 빌드 결과 실행
- `npm run lint` — ESLint 검사

## 금지사항

- 웹캠 영상/프레임/랜드마크 데이터를 서버로 전송하거나 저장하지 않는다. 모든 추론은 브라우저
  내에서만 수행한다 (프라이버시 보장).
- 사용자 승인 없이 새 npm 패키지를 추가하지 않는다. 특히 MediaPipe 관련 패키지 버전은 사전에
  확인받는다.
- `.env`, API 키, 인증 정보 등을 커밋하지 않는다.
- `git push --force`, `git reset --hard`, `git clean -f` 등 파괴적 git 명령은 사용자 명시적
  요청 없이 실행하지 않는다.
- `docs/` 이외의 위치에 임의로 `*.md` 문서 파일을 추가하지 않는다.
- 로드맵 범위를 벗어난 기능(예: v2 단계에서 이펙트 시스템 구현)을 임의로 앞당겨 만들지 않는다.

## 커밋 단위

- 로드맵 버전(v0 ~ v6) 하나를 완료할 때마다 최소 1개 커밋을 남긴다. 버전 하나가 크면 그 안에서도
  의미 있는 작은 단위로 나눠 커밋한다.
- 한 커밋에는 하나의 목적만 담는다 (기능 추가 / 리팩터 / 설정 변경을 섞지 않는다).
- 커밋 메시지는 무엇을 바꿨는지보다 왜 바꿨는지를 중심으로 간결하게 작성한다.
- 사용자가 명시적으로 요청하기 전까지는 커밋을 생성하지 않는다.

## 구현 순서

[docs/ROADMAP.md](docs/ROADMAP.md) 의 v0 → v6 순서를 그대로 따른다. 각 버전 작업을 시작하기 전에
해당 버전의 목표와 완료 기준을 확인하고, 완료 후에는 사용자 확인을 받은 뒤 다음 버전으로 넘어간다.
제스처 판정 세부 기준은 [docs/GESTURES.md](docs/GESTURES.md) 를 기준으로 하되, 실제 구현/테스트
중 임계값이 조정되면 문서도 함께 갱신한다.
