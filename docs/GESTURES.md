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

## 1. 여우 소환 제스처 (fox summon hand sign)

**v4-a2 구현 기준** (`src/lib/gestures/detectFoxSummon.ts`). 특정 작품/캐릭터를 지칭하지 않는
오리지널 손모양이며, 코드/문서에서는 "fox summon hand sign" 또는 "anime-inspired fox hand
sign"으로만 표기한다.

**손모양:** 검지와 새끼손가락은 여우 귀처럼 위로 펴고, 엄지·중지·약지는 서로 가까이 모아
아래쪽에 고리(입 모양)를 만든다. 겉보기엔 락 사인(rock sign)과 비슷할 수 있지만, 엄지가
중지·약지와 만나 고리를 이룬다는 점이 다르다.

**감지 대상:** 검출된 손 중 조건을 가장 잘 만족하는 하나 (손 1개 이상 필요)

**판정 조건 (매 프레임, `handScale = distance(WRIST, MIDDLE_MCP)` 로 정규화):**

1. **검지 폄**: `distance(WRIST, INDEX_TIP)`이 `distance(WRIST, INDEX_PIP)`와
   `distance(WRIST, INDEX_MCP) × 1.15`를 모두 충분히 넘어야 함 (연속값 score로 평가)
2. **새끼 폄**: 검지와 동일한 방식으로 `PINKY_MCP/PIP/TIP` 기준 평가
3. **중지 접힘 + 엄지에 근접**: 중지가 펴지지 않은 정도(1 − 폄 score)와, `THUMB_TIP`과의
   정규화 거리가 가까운 정도를 함께 봄 (둘 다 만족해야 점수가 높음)
4. **약지 접힘 + 엄지에 근접**: 약지도 동일하게 평가
5. **루프 점수(loop score)**: `THUMB_TIP`, `MIDDLE_TIP`, `RING_TIP` 세 점의 평균 상호 거리가
   `handScale`의 0.35 미만일수록 높은 점수 — 가장 중요한 조건 중 하나
6. **락 사인 방지(anti-rock-sign)**: 엄지가 검지 쪽보다 위 루프(중지·약지) 쪽에 확실히 더
   가까워야 함. 락 사인은 엄지가 고리를 이루지 않고 검지 옆에 머무르므로 이 조건에서 걸러짐

**신뢰도(confidence):** 위 6개 score의 **기하평균**(하나라도 0에 가까우면 전체도 낮아지는
"게이팅" 성질)에, 검지 또는 새끼손가락 끝의 y좌표가 0.7 미만이면 소폭(+0.05) 보너스를 더해
0~1로 clamp. `confidence ≥ 0.6`이면 그 프레임은 조건을 만족한 것으로 판정.

**오탐 방지:**
- **peace sign** (검지+중지 폄, 새끼 접힘): 새끼가 안 펴져 있어 "새끼 폄" score가 낮고, 중지가
  펴져 있어 "중지 접힘" score도 낮아 이중으로 걸러짐
- **open palm** (모든 손가락 폄): 중지·약지가 펴져 있어 "접힘" score가 낮아 걸러짐
- **finger gun** (엄지+검지 폄): 새끼가 안 펴져 있어 "새끼 폄" score가 낮아 걸러짐
- **rock sign** (검지+새끼 폄, 엄지가 고리를 이루지 않음): 위 6번 조건에서 걸러짐

**상태 머신 (변경 없음):** `idle`(손 없음) → `detecting`(손은 있으나 조건 불만족) →
`holding`(조건 만족, 경과 시간 누적) → 500ms 이상 유지되면 `triggered` 1회 발동(`fox-summon`)
→ 이후 1500ms `cooldown`. 쿨다운이 끝나면 조건이 계속 유지되고 있어도 `holding`부터 다시
시작한다(홀드 타이머 리셋).

**시각 이펙트 개요:**

- 화면 배경에 거대한 여우 실루엣 머리(2D 일러스트 또는 3D 모델)가 덮치듯 등장했다가 사라짐.
- 화면 전체에 소환 심볼(룬/한자 등 자체 제작 그래픽)이 확대되며 파티클과 함께 페이드아웃.

---

## 2. Pin Pull Transform Gesture

### User-facing description

사용자는 목 옆, 초커, 칼라 근처에 있는 가상의 작은 핀을 엄지와 검지로 집습니다. 이후 그 핀을
바깥쪽 또는 살짝 뒤쪽으로 짧게 당깁니다. 이 동작은 단순한 정적 손 모양이 아니라,
`pinch near neck → pull outward → trigger` 구조의 motion sequence입니다.

### Recognition type

- motion sequence
- hand + body pose

### Required landmarks

HandLandmarker:
- THUMB_TIP
- INDEX_TIP
- WRIST
- palm size estimation용 MCP landmarks

PoseLandmarker:
- LEFT_SHOULDER
- RIGHT_SHOULDER
- optional NOSE or MOUTH landmark

### Neck position estimation

- `shoulderCenter = midpoint(leftShoulder, rightShoulder)`
- `shoulderWidth = distance(leftShoulder, rightShoulder)`
- `neckApprox = point above shoulderCenter by shoulderWidth * 0.35`
- face landmarks가 안정적으로 잡히면 nose/mouth와 shoulderCenter를 이용해 neckApprox를
  보정할 수 있습니다.

### Detection rules v1

1. thumb tip과 index tip이 가까워 pinch 상태여야 합니다.
2. `pinchPoint = midpoint(THUMB_TIP, INDEX_TIP)`로 계산합니다.
3. pinchPoint가 neckApprox 근처에 있어야 합니다.
   - `distance(pinchPoint, neckApprox) / shoulderWidth < 0.35` 정도를 초기 기준으로 사용합니다.
4. pinch near neck 상태가 약 200ms 이상 유지되면 armed 상태로 진입합니다.
5. armedStartPinchPoint와 armedStartTime을 저장합니다.
6. 이후 pinchPoint가 neckApprox 또는 armedStartPinchPoint에서 바깥쪽으로 이동해야 합니다.
7. armed 이후 150ms~1200ms 안에 이동 거리가 `shoulderWidth * 0.15` 이상이면 triggered
   상태가 됩니다. (v1 구현 시 800ms/0.20 기준으로 시작했으나, 실제 카메라 테스트에서 "armed
   진입 후 당길지 결정하는" 반응 시간까지 포함하면 800ms가 너무 빠듯하다는 것이 확인되어
   완화했다.)
8. triggered 후 1500ms cooldown을 적용합니다.

### State machine

- idle
- armed
- pulling
- triggered
- cooldown

### False positive risks

- 옷깃 정리
- 목 긁기
- 머리카락 만지기
- 얼굴 근처에서 우연히 pinch 모양 만들기
- 손이 목 근처를 지나가는 동작

### False positive prevention

- 반드시 thumb-index pinch가 있어야 합니다.
- 반드시 neckApprox 근처에서 시작해야 합니다.
- 정적 자세만으로는 trigger되지 않아야 합니다.
- 짧은 시간 안에 바깥쪽 pull motion이 있어야 합니다.
- movement distance와 time window를 함께 사용해야 합니다.

### Implementation notes

- 이 제스처는 HandLandmarker만으로 구현하지 않는 것이 좋습니다.
- PoseLandmarker 추가 후 구현하는 것이 적절합니다.
- pinchPoint의 짧은 history buffer가 필요합니다.
- movement direction, displacement, velocity 계산 helper가 필요합니다.
- mirrored camera view와 handedness 처리를 주의해야 합니다.

---

## 3. Chain Recoil Transform Gesture

### User-facing description

사용자는 가슴 중앙 또는 명치 근처에 있는 가상의 손잡이, 줄, 트리거를 쥔 것처럼 손을 둡니다.
이후 손을 짧고 강하게 당깁니다. 이 동작은 `grip near chest → pull motion → trigger` 구조의
motion sequence입니다.

### Difference from pin pull transform

Pin Pull Transform:
- neckApprox 근처에서 시작
- thumb-index pinch 사용
- 작은 핀을 짧게 옆으로 뽑는 느낌

Chain Recoil Transform:
- chestApprox 근처에서 시작
- fist 또는 grip-like hand shape 사용
- 가슴 중앙에서 손잡이/줄을 강하게 당기는 느낌

### Recognition type

- motion sequence
- hand + body pose

### Required landmarks

HandLandmarker:
- WRIST
- INDEX_MCP
- MIDDLE_MCP
- RING_MCP
- PINKY_MCP
- INDEX_TIP
- MIDDLE_TIP
- RING_TIP
- PINKY_TIP

PoseLandmarker:
- LEFT_SHOULDER
- RIGHT_SHOULDER
- LEFT_HIP
- RIGHT_HIP

### Chest position estimation

- `shoulderCenter = midpoint(leftShoulder, rightShoulder)`
- `hipCenter = midpoint(leftHip, rightHip)`
- `shoulderWidth = distance(leftShoulder, rightShoulder)`
- `chestApprox = lerp(shoulderCenter, hipCenter, 0.25)`

### Hand center estimation

- `handCenter = average(WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP)`

### Grip / fist-like hand detection

초기 구현에서는 완벽한 주먹 판정보다 grip-like 상태를 느슨하게 잡습니다.

기준:
1. index, middle, ring, pinky 중 3개 이상이 folded 상태에 가까워야 합니다.
2. 각 finger tip이 해당 MCP에서 멀리 뻗어 있지 않아야 합니다.
3. finger tip들이 palm center 또는 wrist 쪽에 가까우면 folded score를 높입니다.

### Detection rules v1

1. fist-like 또는 grip-like hand shape를 감지합니다.
2. handCenter가 chestApprox 근처에서 시작해야 합니다.
   - `distance(handCenter, chestApprox) / shoulderWidth < 0.45` 정도를 초기 기준으로
     사용합니다.
3. grip near chest 상태가 150~300ms 유지되면 armed 상태로 진입합니다.
4. armedStartHandCenter와 armedStartTime을 저장합니다.
5. 이후 handCenter가 armedStartHandCenter에서 충분히 이동해야 합니다.
6. armed 이후 150ms~900ms 안에 이동 거리가 `shoulderWidth * 0.25` 이상이면 triggered
   상태가 됩니다.
7. optional: velocity가 일정 threshold 이상일 때 confidence를 높입니다.
8. triggered 후 1500ms cooldown을 적용합니다.

### State machine

- idle
- armed
- pulling
- triggered
- cooldown

### False positive risks

- 넥타이 또는 셔츠 정리
- 가슴 긁기
- 상체 근처에 주먹을 우연히 둔 자세
- 걷거나 움직이며 팔이 흔들리는 상황
- pin pull transform과의 혼동

### False positive prevention

- 반드시 chestApprox 근처에서 시작해야 합니다.
- 반드시 grip/fist-like hand shape여야 합니다.
- 정적 주먹 자세만으로는 trigger되지 않아야 합니다.
- 짧은 pull motion이 있어야 합니다.
- movement distance와 time window를 함께 사용해야 합니다.
- pin pull과 구분하기 위해 neckApprox + pinch이면 pin pull로, chestApprox + grip이면 chain
  recoil로 분류합니다.

### Implementation notes

- 이 제스처도 HandLandmarker만으로 구현하지 않는 것이 좋습니다.
- PoseLandmarker 추가 후 구현하는 것이 적절합니다.
- handCenter position history가 필요합니다.
- displacement, velocity, moving-away-from-anchor 계산 helper가 필요합니다.
- pin pull transform과 공통 motion-sequence utility를 공유하는 것이 좋습니다.

---

## 4. Finger Gun Gesture

### User-facing description

사용자는 손으로 총 모양을 만듭니다. 검지는 앞으로 길게 펴고, 엄지는 위쪽 또는 대각선 위로
펴서 총의 해머처럼 보이게 합니다. 중지, 약지, 새끼손가락은 접혀 있어야 합니다. 손끝 방향으로
발사하는 느낌의 정적 손 모양 중심 제스처입니다.

### Recognition type

- static hand pose
- HandLandmarker only

### Required landmarks

HandLandmarker:
- WRIST
- THUMB_TIP
- THUMB_IP
- THUMB_MCP
- INDEX_MCP
- INDEX_PIP
- INDEX_DIP
- INDEX_TIP
- MIDDLE_MCP
- MIDDLE_PIP
- MIDDLE_TIP
- RING_MCP
- RING_PIP
- RING_TIP
- PINKY_MCP
- PINKY_PIP
- PINKY_TIP

### Detection rules v1

1. 손이 하나 이상 감지되어야 합니다.
2. index finger는 extended 상태여야 합니다.
   - INDEX_TIP이 INDEX_PIP보다 손목에서 더 멀어야 합니다.
   - INDEX_TIP이 INDEX_MCP보다 충분히 멀어야 합니다.
3. thumb는 open 상태여야 합니다.
   - THUMB_TIP이 palm center에서 충분히 떨어져 있어야 합니다.
   - THUMB_TIP과 INDEX_MCP 사이 거리가 너무 가깝지 않아야 합니다.
   - thumb direction과 index direction 사이 각도가 일정 범위 이상이면 thumb open score를
     높입니다.
4. middle, ring, pinky는 folded 상태여야 합니다.
   - 각 finger tip이 해당 MCP에서 멀리 뻗어 있지 않아야 합니다.
   - finger tip이 palm center 또는 wrist 쪽에 가까울수록 folded score가 높습니다.
5. index direction을 계산합니다.
   - `indexDirection = vector(INDEX_MCP → INDEX_TIP)`
   - 이 방향은 나중에 muzzle flash 또는 impact effect 방향으로 사용할 수 있습니다.
6. 400~600ms 정도 유지되면 triggered 상태가 됩니다.
7. triggered 후 1000~1500ms cooldown을 적용합니다.

### Optional two-hand interaction

향후 확장으로, 한 손이 finger gun을 만들고 다른 손바닥을 타격 대상처럼 세우는 연출을 추가할
수 있습니다. 하지만 v1에서는 한 손 finger gun만 구현합니다.

### False positive risks

- fox summon gesture와 혼동
- open palm
- pointing gesture
- peace sign
- thumb up
- 일반적으로 검지만 펴서 가리키는 자세

### False positive prevention

- 검지만 펴진 pointing gesture와 구분하기 위해 thumb open 조건을 반드시 요구합니다.
- fox summon과 구분하기 위해 pinky가 펴져 있으면 finger gun confidence를 낮춥니다.
- peace sign과 구분하기 위해 middle finger가 펴져 있으면 finger gun으로 보지 않습니다.
- open palm과 구분하기 위해 middle/ring/pinky folded 조건을 강하게 둡니다.
- thumb up과 구분하기 위해 index extended 조건을 반드시 요구합니다.
- **pin pull과 구분**: thumb open 조건(팜/검지 knuckle 대비 거리, 각도)만으로는 목 근처에서
  엄지-검지 pinch를 하는 pin pull 동작과 구분되지 않는 경우가 실제 카메라 테스트에서 확인됐다
  (손 전체가 몸에서 멀리 뻗어 있으면 엄지가 팜/검지 knuckle 기준으로는 "충분히 멀다"고 읽히고,
  pinch 특성상 중지/약지/새끼가 자연스럽게 접히기도 함). `THUMB_TIP`과 `INDEX_TIP` 사이 거리가
  pin pull이 pinch로 인정하는 범위(`PINCH_MAX_NORMALIZED_DISTANCE`, 현재 0.35) 근처거나 그보다
  가까우면 finger gun confidence를 낮추는 `antiPinPullScore`를 추가했다.

### Confidence score components

- indexExtendedScore
- thumbOpenScore
- middleFoldedScore
- ringFoldedScore
- pinkyFoldedScore
- antiFoxSummonScore
- antiOpenPalmScore
- antiPinPullScore

### Effect mapping note

finger gun이 triggered되면 CSS 기반의 muzzle flash, sharp line burst, impact wave 효과를
사용할 수 있습니다. 원작 이미지나 고유명사는 사용하지 않습니다.

### Implementation notes

- 이 제스처는 HandLandmarker만으로 우선 구현 가능합니다.
- `detectFingerGun.ts`를 별도 파일로 만들 수 있습니다.
- `useGestureEngine`은 여러 detector를 동시에 실행하고, confidence가 가장 높은 제스처를
  선택하도록 확장하는 것이 좋습니다.
- fox summon과 finger gun이 동시에 감지될 수 있으므로 gesture priority 또는 confidence
  threshold를 명확히 해야 합니다.
- indexDirection은 추후 이펙트 방향 계산에 재사용할 수 있도록 반환하는 구조를 고려합니다.

---

## Cross-gesture priority and conflict rules

### Gesture implementation priority

1. fox summon hand sign
   - 이미 구현됨. 실제 손 모양 기준으로 v2 개선 필요.
2. finger gun
   - HandLandmarker만으로 구현 가능하므로 다음 구현 후보.
3. PoseLandmarker integration
   - pin pull과 chain recoil 구현 전 필수.
4. pin pull transform
   - neckApprox + pinch + pull motion.
5. chain recoil transform
   - chestApprox + grip + pull motion.

### Conflict rules

- fox summon vs finger gun:
  - fox summon은 index + pinky extended, thumb/middle/ring loop가 핵심입니다.
  - finger gun은 index + thumb extended, middle/ring/pinky folded가 핵심입니다.
  - pinky가 펴져 있으면 finger gun confidence를 낮춥니다.
  - thumb-middle-ring loop가 있으면 fox summon confidence를 높입니다.

- pin pull vs chain recoil:
  - pin pull은 neckApprox + thumb-index pinch입니다.
  - chain recoil은 chestApprox + grip/fist-like hand입니다.
  - 시작 anchor와 hand shape가 다르므로 별도 detector로 분리합니다.

- pin pull vs finger gun:
  - 실제 카메라 테스트에서 목 근처 pinch 동작이 finger gun으로도 잘못 인식되는 문제가
    확인됐다 — finger gun의 thumb open 조건은 엄지가 "팜/검지 knuckle" 기준으로 멀리 있는지만
    보고, 엄지 끝과 검지 끝 사이 거리는 보지 않기 때문에 pinch와 우연히 양립할 수 있다.
  - finger gun 쪽에 `antiPinPullScore`(엄지-검지 tip 거리가 pin pull의 pinch 기준 이하면
    감점)를 추가해 구분한다.

- static pose vs motion sequence:
  - fox summon과 finger gun은 static hand pose입니다.
  - pin pull과 chain recoil은 motion sequence입니다.
  - motion sequence gestures는 정적 자세만으로 trigger되지 않아야 합니다.

### Shared helper candidates

향후 구현 시 다음 helper를 고려합니다.

- distance2D
- midpoint
- lerp
- normalizeDistance
- getPalmCenter
- estimatePalmSize
- isFingerExtended
- isFingerFolded
- estimateNeckAnchor
- estimateChestAnchor
- trackPointHistory
- calculateDisplacement
- calculateVelocity
- isMovingAwayFromAnchor

---

## 임계값 튜닝 메모

각 제스처 섹션에 적어둔 수치(거리 비율, ms 범위 등)는 모두 **초기 추정값**이며, 실제 웹캠으로
테스트하면서 조정한다. 조정 시 해당 제스처 섹션을 함께 갱신한다. 2번(pin pull)과 3번(chain
recoil)처럼 "진입(armed) → 방향성 이동(pulling) → 발동(triggered)"을 판정하는 motion sequence
제스처는 반드시 상태 머신으로 구현한다 (`idle → armed → pulling → triggered → cooldown`,
`armed`/`pulling` 상태에서 시간 초과 시 `idle`로 복귀). 가능하면 절대 정규화 좌표보다
`distance(WRIST, MIDDLE_MCP)`(손 크기) 또는 `shoulderWidth`(몸통 크기) 같은 신체 크기 근사치
대비 상대값으로 임계값을 정의해, 카메라와의 거리 변화에 덜 민감하도록 한다.

## 저작권 관련 메모

위 4개 제스처는 특정 작품/캐릭터를 본떠 만들지 않은 오리지널 컨셉(fox summon hand sign, pin
pull transform, chain recoil transform, finger gun)으로 정의한다. 코드·문서·커밋 메시지에서는
`anime-inspired`, `contract`, `transform`, `summon`, `trigger`, `pull`, `finger gun` 같은
일반 표현만 사용하고, 특정 작품명·캐릭터명·고유명사·원작 이미지 출처는 쓰지 않는다. 실제 구현
시 사용하는 일러스트/3D 모델/사운드 등 아트 에셋도 직접 제작하거나 라이선스가 명확한(공개
도메인, CC0, 구매한 에셋 등) 리소스만 사용한다.
