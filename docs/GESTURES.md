# GESTURES

이 문서는 v4(제스처 감지 엔진) 구현을 위한 **초안**이다. 실제 카메라/조명 환경에서 테스트하며
임계값은 조정될 수 있다. 좌표는 MediaPipe가 반환하는 정규화 좌표(`x, y ∈ [0, 1]`, 좌상단 원점)를
기준으로 하며, Hand Landmarker(21포인트)와 Pose Landmarker(33포인트) 인덱스는 아래를 따른다.

```
[Hand Landmarker — 21포인트]
0  WRIST
1  THUMB_CMC   2 THUMB_MCP   3 THUMB_IP   4 THUMB_TIP
5  INDEX_MCP   6 INDEX_PIP   7 INDEX_DIP  8 INDEX_TIP
9  MIDDLE_MCP  10 MIDDLE_PIP 11 MIDDLE_DIP 12 MIDDLE_TIP
13 RING_MCP    14 RING_PIP   15 RING_DIP  16 RING_TIP
17 PINKY_MCP   18 PINKY_PIP  19 PINKY_DIP 20 PINKY_TIP

[Pose Landmarker — 33포인트 중 사용하는 것]
0  NOSE
11 LEFT_SHOULDER   12 RIGHT_SHOULDER
23 LEFT_HIP        24 RIGHT_HIP
```

공통 보조 판정:

- **손가락 폄(extended) 여부**: `tip.y < pip.y` (이미지 좌표는 아래로 갈수록 y 증가하므로,
  손끝이 PIP 관절보다 위에 있으면 폄으로 간주). 엄지는 다른 손가락과 각도가 달라 별도 판정한다.
- **손 중심(palm centroid)**: `(WRIST + INDEX_MCP + PINKY_MCP) / 3` 로 근사한다.
- **안정 프레임 수(hold frame)**: 카메라 30fps 가정 시 10프레임 ≈ 0.3초, 20프레임 ≈ 0.6초.
- **손/몸 좌표 결합**: Hand Landmarker와 Pose Landmarker를 같은 비디오 프레임에 대해 실행하면
  둘 다 해당 프레임 기준 정규화 좌표를 반환하므로 좌표계를 그대로 비교할 수 있다 (별도 변환 불필요).
- Hand Landmarker는 좌우 손을 각각 별도 랜드마크 세트로 반환하므로, 아래 제스처들은 "검출된 손
  중 하나라도 조건을 만족하면" 트리거되는 것을 기본으로 한다.

이번 초안부터는 오리지널 소환/변신 모티프를 기준으로 4개 제스처를 정의한다 (특정 IP 캐릭터를
지칭하지 않는 창작 컨셉). 실제 아트 에셋(실루엣 일러스트/3D 모델, 헤드웨어, 웨폰 이펙트 등)의
제작/소싱은 v5(이펙트 발동) 단계에서 별도로 다루며, 이 문서는 감지 로직 기준만 다룬다.

---

## 1. 여우 소환 제스처

**감지 대상:** 단일 손 (Hand Landmarker)

**판정 조건 (매 프레임):**

1. 검지 폄: `INDEX_TIP.y < INDEX_PIP.y`
2. 중지 폄: `MIDDLE_TIP.y < MIDDLE_PIP.y`
3. 약지 폄: `RING_TIP.y < RING_PIP.y`
4. 엄지·새끼 맞닿음: `distance(THUMB_TIP, PINKY_TIP) < 0.05` (정규화 좌표 기준, 추후
   `distance(WRIST, MIDDLE_MCP)` 대비 상대값으로 보정 검토 — 여우 머리 모양의 "귀 세 개 + 입"
   실루엣을 의도)

**발동 조건:** 1~4를 **10프레임 이상 연속** 만족하면 `fox-summon` 이벤트 발동. 재발동까지
쿨다운 1.5초.

**시각 이펙트 개요:**

- 화면 배경에 거대한 여우 실루엣 머리(2D 일러스트 또는 3D 모델)가 덮치듯 등장했다가 사라짐.
- 화면 전체에 소환 심볼(룬/한자 등 자체 제작 그래픽)이 확대되며 파티클과 함께 페이드아웃.

---

## 2. 핀 뽑기 변신 제스처

**감지 대상:** 단일 손(Hand Landmarker) + 몸(Pose Landmarker) 결합

**기준점:** `neckPoint = midpoint(POSE_LEFT_SHOULDER, POSE_RIGHT_SHOULDER)` (또는 `POSE_NOSE`
를 보조 기준으로 사용)

**판정 조건 (2단계 시퀀스):**

1. **진입(pin) 단계**: `distance(palmCentroid, neckPoint) < 0.12` — 손이 목/턱 부근에 진입.
   이 상태를 최소 3프레임 이상 확인해 우연한 통과와 구분한다.
2. **이탈(pull) 단계**: 진입 상태 종료 시점부터 짧은 윈도우(예: 6프레임 이내) 안에
   `palmCentroid`가 `neckPoint`에서 멀어지는 방향으로 이동하며, 이동 속도가 임계값
   (`|Δp| / Δt > 0.3`, 정규화 좌표 기준) 이상이어야 함 — "당겨서 뽑는" 동작.

**발동 조건:** 진입 → 이탈 시퀀스가 완료되는 순간 `pin-pull` 이벤트 1회 발동. 쿨다운 2초.

**시각 이펙트 개요:**

- 목 주변에서 폭발 파티클이 사방으로 튐.
- 코(`POSE_NOSE`) 랜드마크를 기준 앵커로 머리 위에 자체 제작 헤드웨어를 트래킹 부착.

---

## 3. 체인 리코일 변신 제스처

**감지 대상:** 단일 손(Hand Landmarker) + 몸(Pose Landmarker) 결합

**기준점:** `chestCenter = average(LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)`

**판정 조건 (2단계 시퀀스):**

1. **진입 단계**: `distance(palmCentroid, chestCenter) < 0.12` — 손이 가슴 중앙 부근에 위치.
   최소 3프레임 유지.
2. **하강(pull-down) 단계**: 진입 이후 짧은 윈도우(예: 6프레임 이내) 안에 `palmCentroid.y`가
   빠르게 증가(아래로 이동)하고, 이동 속도가 임계값(`Δy / Δt > 0.3`) 이상 — "리코일 스타터
   줄을 아래로 당겨 시동 거는" 동작.

**발동 조건:** 진입 → 하강 시퀀스가 완료되는 순간 `chain-pull` 이벤트 1회 발동. 쿨다운 2초.

**시각 이펙트 개요:**

- 가슴 부위에서 스파크(전기 불꽃) 파티클이 강하게 발생.
- 화면 전체에 짧은 잔상/블러 효과가 스치듯 표시된 후, 머리(코 랜드마크 기준)와 양팔(손목
  랜드마크 기준)에 체인/톱날 모티프 이펙트가 부착되어 이후 움직임을 트래킹.

---

## 4. 건 제스처 ("Bang")

**감지 대상:** 단일 손 (Hand Landmarker)

**판정 조건 — 손모양 (매 프레임):**

1. 엄지 폄: `THUMB_TIP`이 `INDEX_MCP`에서 충분히 멀어져 있음 (`distance(THUMB_TIP, INDEX_MCP) >
   0.08`) — 위/정면을 향해 벌어진 권총 모양의 엄지.
2. 검지 폄: `INDEX_TIP.y < INDEX_PIP.y`
3. 중지 접힘: `MIDDLE_TIP.y > MIDDLE_PIP.y`
4. 약지 접힘: `RING_TIP.y > RING_PIP.y`
5. 새끼 접힘: `PINKY_TIP.y > PINKY_PIP.y`

**판정 조건 — 반동(recoil) 모션:**

6. 손모양(1~5) 유지 상태에서 `INDEX_TIP.y`를 짧은 슬라이딩 윈도우(3~5프레임)로 관찰해
   급격한 상승 후 즉시 원위치로 복귀하는 패턴을 감지: 연속 프레임에서 `Δy_1 < -0.04`
   (위로 튐) 다음 `Δy_2 > +0.03` (원위치 복귀)이 연이어 나타나면 반동으로 판정.

**발동 조건:** 손모양이 유지되는 동안 반동 패턴이 감지되는 순간 `finger-gun-bang` 이벤트 1회
발동. 검지 방향 벡터(`INDEX_TIP - INDEX_MCP`)를 이벤트 payload로 함께 전달. 쿨다운 800ms.

**시각 이펙트 개요:**

- 검지 손끝에서 검지 방향으로 투명 충격파 레이저(빔)가 발사됨.
- 발사 순간 화면 전체 Screen Shake + 붉은 섬광 연출.

---

## 임계값 튜닝 메모

위 수치(`0.05`, `0.12`, `0.3`, `0.08`, `0.04`, `0.03`, 프레임 수 등)는 모두 **초기 추정값**이며,
v4 구현 중 실제 웹캠으로 테스트하면서 조정한다. 조정 시 이 문서도 함께 갱신한다. 특히 2번(핀 뽑기)과
3번(체인 리코일)처럼 "진입 → 특정 방향 이동"을 판정하는 2단계 시퀀스 제스처는 상태 머신(state
machine) 형태로 구현하는 것을 권장한다 (예: `idle → armed(진입 감지) → triggered(방향/속도 조건
충족)`, `armed` 상태에서 일정 시간 초과 시 `idle`로 복귀). 가능하면 절대 정규화 좌표보다
`distance(WRIST, MIDDLE_MCP)` 또는 어깨 너비(`distance(LEFT_SHOULDER, RIGHT_SHOULDER)`) 같은
신체 크기 근사치 대비 상대값으로 임계값을 정의해, 카메라와의 거리 변화에 덜 민감하도록 개선하는
것을 v4 후반에 검토한다.

## 저작권 관련 메모

위 4개 제스처는 특정 작품/캐릭터를 본떠 만들지 않은 오리지널 컨셉(여우 소환, 핀 뽑기 변신, 체인
리코일 변신, 건 제스처)으로 정의한다. 실제 구현 시 사용하는 일러스트/3D 모델/사운드 등 아트 에셋은
직접 제작하거나 라이선스가 명확한(공개 도메인, CC0, 구매한 에셋 등) 리소스만 사용하고, 특정 IP를
연상시키는 이름·문구·룩앤필을 코드/에셋/커밋 메시지에 남기지 않는다.
