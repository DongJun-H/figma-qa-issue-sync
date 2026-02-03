# QA Issue Sync - GitHub OAuth 인증 시스템 문서

## 1. 시스템 개요

### 이 시스템이 하는 일
Figma에서 디자인 QA 작업 시 발견한 문제점(annotation)을 GitHub Issues로 자동 등록해주는 플러그인입니다.

**핵심 기능**: 사용자가 자신의 GitHub 계정으로 로그인하면, 생성되는 이슈의 작성자가 해당 사용자로 표시됩니다.

### 구성 요소

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           전체 시스템 구조                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   [Figma 플러그인]              [Vercel 서버]              [GitHub]          │
│   ┌───────────┐                ┌───────────────┐         ┌─────────┐       │
│   │  ui.html  │ ◄───────────►  │   API 서버    │ ◄─────► │  OAuth  │       │
│   │  code.ts  │    HTTP 요청    │   (Node.js)   │         │   API   │       │
│   └───────────┘                └───────┬───────┘         └─────────┘       │
│                                        │                                    │
│                    ┌───────────────────┼───────────────────┐               │
│                    │                   │                   │               │
│                    ▼                   ▼                   ▼               │
│             ┌───────────┐       ┌───────────┐       ┌───────────┐         │
│             │ Vercel KV │       │Middleware │       │  lib/     │         │
│             │  (Redis)  │       │(Rate Limit)│      │ security  │         │
│             └───────────┘       └───────────┘       │ crypto    │         │
│              세션 저장소          요청 제한           └───────────┘         │
│                                                       보안 유틸            │
└─────────────────────────────────────────────────────────────────────────────┘
```

| 구성 요소 | 역할 | 비유 |
|----------|------|------|
| **Figma 플러그인** | 사용자가 직접 조작하는 화면 | 은행 ATM 화면 |
| **Vercel 서버** | 요청을 처리하는 중간 서버 | 은행 중앙 시스템 |
| **Vercel KV** | 로그인 정보를 저장하는 저장소 | 은행 금고 |
| **Middleware** | 모든 요청을 검사하는 관문 | 은행 보안 게이트 |
| **lib/security** | 보안 검사 도구 모음 | 보안 검색대 |
| **lib/crypto** | 민감 정보 암호화 | 금고 자물쇠 |
| **GitHub** | 실제 이슈가 생성되는 곳 | 최종 목적지 |

---

## 2. 파일 구조

```
프로젝트/
├── api/                      # 서버 코드 (Vercel에서 실행)
│   ├── auth/                 # 인증 관련 API
│   │   ├── login.js          # 로그인 시작점
│   │   ├── callback.js       # GitHub 인증 완료 처리
│   │   ├── status.js         # 로그인 상태 확인
│   │   └── logout.js         # 로그아웃 처리
│   └── qa-issues.js          # 이슈 생성 API
│
├── lib/                      # 공통 유틸리티 (보안 관련)
│   ├── security.js           # CORS, 입력 검증, XSS 방지
│   └── crypto.js             # 토큰 암호화/복호화
│
├── middleware.js             # Rate Limiting (요청 횟수 제한)
├── code.ts                   # Figma 플러그인 로직
├── ui.html                   # 플러그인 UI 화면
├── manifest.json             # 플러그인 설정
└── package.json              # 의존성 목록
```

---

## 3. 로그인 과정 (OAuth 흐름)

### 비유로 이해하기
OAuth 로그인은 **"대리인을 통한 신원 확인"**과 같습니다.

> **예시: 호텔 체크인**
> 1. 손님이 프론트에 체크인 요청
> 2. 프론트: "신분증 확인이 필요합니다. 경찰서에서 확인받아 오세요"
> 3. 손님이 경찰서 가서 신분 확인 (GitHub 로그인)
> 4. 경찰서가 "이 사람 확인됨" 증명서 발급
> 5. 손님이 증명서 들고 호텔로 돌아옴
> 6. 프론트가 증명서 확인 후 방 키(세션) 발급
> 7. 손님은 방 키로 호텔 시설 이용

### 실제 로그인 흐름 (10단계)

```
[사용자]          [Figma 플러그인]         [Vercel 서버]           [GitHub]
   │                    │                      │                     │
   │ ① 로그인 클릭      │                      │                     │
   │ ─────────────────► │                      │                     │
   │                    │                      │                     │
   │                    │ ② 로그인 요청        │                     │
   │                    │ ────────────────────►│                     │
   │                    │                      │                     │
   │                    │ ③ GitHub URL +       │                     │
   │                    │    state 토큰 반환   │                     │
   │                    │ ◄────────────────────│                     │
   │                    │                      │                     │
   │ ④ 브라우저 열림    │                      │                     │
   │ ◄──────────────────│                      │                     │
   │                    │                      │                     │
   │ ⑤ GitHub 로그인 화면에서 "승인" 클릭      │                     │
   │ ─────────────────────────────────────────────────────────────►│
   │                    │                      │                     │
   │                    │                      │ ⑥ 인증 코드 전달   │
   │                    │                      │ ◄───────────────────│
   │                    │                      │                     │
   │                    │                      │ ⑦ 코드 → 토큰 교환 │
   │                    │                      │ ────────────────────►
   │                    │                      │                     │
   │                    │                      │ ⑧ 토큰 + 사용자정보│
   │                    │                      │ ◄────────────────────
   │                    │                      │                     │
   │ ⑨ "로그인 완료" 페이지 표시              │                     │
   │ ◄─────────────────────────────────────────│                     │
   │                    │                      │                     │
   │                    │ ⑩ 상태 확인 (폴링)  │                     │
   │                    │ ────────────────────►│                     │
   │                    │    → 세션 ID 수신    │                     │
   │                    │ ◄────────────────────│                     │
   │                    │                      │                     │
   │ 로그인 완료!       │                      │                     │
   │ ◄──────────────────│                      │                     │
```

### 각 단계 상세 설명

#### ① 로그인 버튼 클릭
- **어디서**: Figma 플러그인 UI (`ui.html`)
- **무슨 일이**: 사용자가 "로그인" 버튼을 클릭
- **결과**: 플러그인이 서버에 로그인 요청 준비

#### ② 로그인 요청 (GET /api/auth/login)
- **어디서**: 플러그인 → 서버
- **무슨 일이**: "로그인 시작해주세요" 요청
- **서버가 하는 일**:
  - `state`라는 고유 코드 생성 (위조 방지용)
  - 이 코드를 Vercel KV에 저장 (10분간 유효)
  - GitHub 로그인 URL 생성

#### ③ GitHub URL 반환
- **서버가 반환하는 것**:
  ```json
  {
    "authUrl": "https://github.com/login/oauth/authorize?client_id=xxx&state=abc123",
    "state": "abc123"
  }
  ```
- **state의 역할**: 나중에 "이 요청이 진짜 우리가 보낸 건지" 확인하는 암호

#### ④ 브라우저 열기
- **어디서**: Figma 플러그인
- **무슨 일이**: `figma.openExternal()`로 GitHub 로그인 페이지 열기
- **사용자 경험**: 브라우저가 열리며 GitHub 로그인 화면 표시

#### ⑤ GitHub에서 승인
- **어디서**: 사용자의 웹 브라우저
- **무슨 일이**:
  - 사용자가 GitHub 계정으로 로그인
  - "이 앱에 권한을 허용하시겠습니까?" 승인
- **허용되는 권한**: `repo` (저장소 접근 - 이슈 생성에 필요)

#### ⑥ 인증 코드 전달
- **어디서**: GitHub → Vercel 서버
- **무슨 일이**: GitHub이 우리 서버의 callback URL로 리다이렉트
- **URL 예시**: `https://our-server.vercel.app/api/auth/callback?code=xyz789&state=abc123`

#### ⑦ 코드 → 토큰 교환
- **어디서**: Vercel 서버 → GitHub API
- **무슨 일이**:
  - 받은 `code`와 우리 앱의 `client_secret`을 GitHub에 전송
  - GitHub이 검증 후 `access_token` 발급
- **왜 이렇게 복잡하게?**: 보안! code는 1회용, access_token은 비밀

#### ⑧ 사용자 정보 조회
- **어디서**: Vercel 서버 → GitHub API
- **무슨 일이**: access_token으로 사용자 정보 조회 (이름, 아바타 등)

#### ⑨ 세션 생성 및 저장
- **어디서**: Vercel 서버
- **무슨 일이**:
  - 고유한 `sessionId` 생성
  - **access_token을 AES-256-GCM으로 암호화**
  - Vercel KV에 저장:
    ```
    키: oauth:session:세션ID
    값: { 암호화된토큰, 사용자이름, 아바타URL, 생성시간 }
    유효기간: 24시간
    ```
  - 브라우저에 "로그인 완료" 페이지 표시

#### ⑩ 상태 확인 (폴링)
- **어디서**: Figma 플러그인
- **무슨 일이**:
  - 플러그인이 3초마다 서버에 "로그인 됐나요?" 질문
  - 서버가 "완료됨!" 응답하면 sessionId 수신
  - sessionId를 Figma 내부 저장소에 저장
- **왜 폴링?**: 브라우저와 Figma 플러그인이 직접 통신할 수 없어서

---

## 4. 이슈 생성 과정

로그인 후 QA annotation을 동기화하면:

```
[Figma 플러그인]                    [Vercel 서버]                    [GitHub]
      │                                  │                              │
      │ POST /api/qa-issues             │                              │
      │ + X-QA-Session: 세션ID          │                              │
      │ ─────────────────────────────► │                              │
      │                                  │                              │
      │                                  │ 세션ID로 KV에서              │
      │                                  │ 암호화된 토큰 조회 → 복호화  │
      │                                  │                              │
      │                                  │ 사용자 토큰으로 이슈 생성    │
      │                                  │ ─────────────────────────────►
      │                                  │                              │
      │                                  │         이슈 생성 완료       │
      │                                  │ ◄─────────────────────────────
      │                                  │                              │
      │        생성 결과 반환            │                              │
      │ ◄───────────────────────────────│                              │
```

### 핵심 포인트
- 이슈는 **로그인한 사용자의 토큰**으로 생성됨
- 따라서 GitHub에서 이슈 작성자가 해당 사용자로 표시됨
- 로그인하지 않으면 서버에 설정된 기본 토큰 사용 (폴백)

---

## 5. 보안 아키텍처

### 전체 보안 계층 구조

```
                            요청 흐름
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  1단계: Rate Limiting (middleware.js)                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • IP당 분당 10회 요청 제한                           │   │
│  │ • 초과 시 429 Too Many Requests 반환                │   │
│  │ • DDoS, Brute Force 공격 방지                       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  2단계: CORS 검증 (lib/security.js)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • 허용된 Origin만 통과:                              │   │
│  │   - https://www.figma.com                           │   │
│  │   - https://figma.com                               │   │
│  │   - null (Figma 플러그인 샌드박스)                   │   │
│  │ • 악성 사이트에서의 API 호출 차단                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  3단계: 입력값 검증 (lib/security.js)                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • owner/repo 형식 검증 (정규식)                      │   │
│  │ • 이슈 제목/본문 길이 제한                          │   │
│  │ • Path Traversal 공격 방지 (../../../ 등)           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  4단계: 인증/권한 확인                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • X-QA-Secret 헤더 검증 (선택)                       │   │
│  │ • X-QA-Session 헤더로 세션 확인                      │   │
│  │ • OAuth state로 CSRF 공격 방지                       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  5단계: 토큰 복호화 (lib/crypto.js)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ • AES-256-GCM으로 암호화된 토큰 복호화               │   │
│  │ • KV 저장소 유출 시에도 토큰 보호                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
                         비즈니스 로직 실행
```

### 각 보안 계층 상세 설명

#### 1단계: Rate Limiting (요청 횟수 제한)

**왜 필요한가?**
- 악의적인 사용자가 1초에 수천 번 요청을 보내면 서버가 다운됨
- 비밀번호 무차별 대입 공격(Brute Force) 방지
- 서버 비용 폭증 방지

**동작 방식**:
```
[요청] → [IP 주소 확인] → [최근 1분 내 요청 횟수 확인]
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              10회 이하                        10회 초과
                    │                               │
                    ▼                               ▼
              요청 허용                    429 Too Many Requests
```

**구현 코드** (`middleware.js`):
```javascript
import { Ratelimit } from '@upstash/ratelimit';
import { kv } from '@vercel/kv';

const ratelimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(10, '1m'),  // 분당 10회
});

export default async function middleware(request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? '127.0.0.1';
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return new Response('Too Many Requests', { status: 429 });
  }
}
```

#### 2단계: CORS (Cross-Origin Resource Sharing)

**왜 필요한가?**
- 브라우저는 기본적으로 다른 도메인으로의 요청을 차단함
- 악성 웹사이트에서 우리 API를 호출하는 것을 방지

**동작 방식**:
```
attacker.com에서 요청     →   CORS 헤더 없음   →   브라우저가 차단
figma.com에서 요청        →   CORS 헤더 있음   →   요청 허용
```

**구현 코드** (`lib/security.js`):
```javascript
const ALLOWED_ORIGINS = [
  'https://www.figma.com',
  'https://figma.com',
  'null',     // Figma 플러그인은 "null" 문자열을 보냄
  null,       // Origin 헤더 없음
  undefined
];

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || 'null');
  }
  // 허용 목록에 없으면 CORS 헤더를 설정하지 않음 → 브라우저가 차단
}
```

> **Figma 플러그인 특이점**: Figma 플러그인은 샌드박스 환경에서 실행되어
> `Origin: null` 헤더를 **문자열**로 전송합니다. JavaScript의 `null`이 아니라
> 문자열 `'null'`입니다.

#### 3단계: 입력값 검증

**왜 필요한가?**
- 사용자 입력을 신뢰하면 안 됨
- 악의적인 입력으로 시스템을 공격할 수 있음

**방지하는 공격**:

| 공격 유형 | 예시 | 방지 방법 |
|----------|------|----------|
| Path Traversal | `owner: "../../../etc"` | 정규식으로 영문/숫자/하이픈만 허용 |
| 인젝션 | `repo: "test; rm -rf /"` | 특수문자 차단 |
| DoS | 1GB 크기의 이슈 본문 | 길이 제한 (제목 256자, 본문 65536자) |

**구현 코드** (`lib/security.js`):
```javascript
const OWNER_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
const REPO_REGEX = /^[a-zA-Z0-9._-]+$/;
const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 65536;

function validateOwnerRepo(owner, repo) {
  if (!owner || !repo) return false;
  if (owner.length > 39 || repo.length > 100) return false;
  if (!OWNER_REGEX.test(owner)) return false;  // GitHub username 규칙
  if (!REPO_REGEX.test(repo)) return false;
  return true;
}
```

#### 4단계: 인증 및 CSRF 방지

**State 토큰으로 CSRF 방지**:
```
1. 로그인 시작 시 서버가 랜덤 state 생성 → KV에 저장
2. 사용자가 GitHub 인증 완료
3. GitHub이 callback으로 state 포함하여 전달
4. 서버가 KV에서 state 확인 → 일치하면 정상 요청
```

**왜 state가 CSRF를 방지하나?**
- 공격자가 사용자를 속여 악성 callback URL을 클릭하게 할 수 있음
- 하지만 state 값을 모르기 때문에 서버가 거부함

```javascript
// api/auth/login.js - state 생성
const stateData = {
  id: crypto.randomUUID(),  // 예측 불가능한 랜덤 값
  createdAt: Date.now(),
  status: 'pending'
};
await kv.set(`oauth:state:${stateData.id}`, stateData, { ex: 600 });  // 10분 유효

// api/auth/callback.js - state 검증
const stateData = await kv.get(`oauth:state:${state}`);
if (!stateData || stateData.status !== 'pending') {
  return sendErrorPage(res, '로그인 세션이 만료되었습니다.');
}
```

#### 5단계: 토큰 암호화

**왜 필요한가?**
- Vercel KV(Redis)가 해킹당하면 모든 사용자의 GitHub 토큰이 유출됨
- 토큰이 유출되면 해당 사용자의 모든 저장소에 접근 가능

**암호화 방식: AES-256-GCM**

```
평문 토큰: gho_xxxxxxxxxxxxxxxxxxxx

    │ encrypt()
    ▼

암호화된 토큰: a1b2c3d4e5f6...:f7e8d9c0...:암호화된데이터
              (IV 16바이트)   (Auth Tag)   (암호문)

    │ decrypt()
    ▼

복호화된 토큰: gho_xxxxxxxxxxxxxxxxxxxx
```

**구현 코드** (`lib/crypto.js`):
```javascript
const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');  // 32바이트 키
  const iv = crypto.randomBytes(16);  // 초기화 벡터 (매번 랜덤)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');  // 무결성 검증용

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}
```

**왜 AES-256-GCM인가?**
- **AES-256**: 미국 정부도 사용하는 강력한 암호화
- **GCM (Galois/Counter Mode)**:
  - 암호화 + 무결성 검증을 동시에 제공
  - 암호문이 변조되면 복호화 실패 (Auth Tag 검증)

### 추가 보안 기능

#### HTTPS 강제 (Figma 플러그인)

```typescript
// code.ts
if (!settings.endpoint.startsWith('https://')) {
  figma.ui.postMessage({
    type: 'error',
    message: '보안을 위해 HTTPS URL만 허용됩니다.'
  });
  return;
}
```

**왜?**: HTTP는 평문 통신이라 중간에서 토큰을 가로챌 수 있음

#### 에러 메시지 (Self-hosted 환경)

이 플러그인은 **Self-hosted** 환경입니다. 사용자가 직접 Vercel에 배포하므로:
- "공격자"가 존재하지 않음
- 상세한 에러 메시지가 디버깅에 도움됨

```javascript
// Self-hosted에서는 상세 에러 메시지 OK
error: "Repository not found"
error: "Invalid owner or repo format: Owner: 1-39자, 영문/숫자/하이픈만 허용..."
```

**QA_SYNC_SECRET으로 상세 에러 보호**

GitHub 저장소가 공개되어 Vercel URL이 노출되는 경우, `QA_SYNC_SECRET`을 설정하면 상세 에러 메시지가 보호됩니다:

```
[요청] → [Secret 검증] → 실패 시 "Unauthorized" 만 반환 (상세 정보 없음)
                      → 성공 시 정상 처리 (상세 에러 포함)
```

| QA_SYNC_SECRET | 요청 | 응답 |
|----------------|------|------|
| 설정함 + Secret 없음/틀림 | 모든 요청 | `401 Unauthorized` |
| 설정함 + Secret 맞음 | 정상 요청 | 상세 에러 메시지 |
| 미설정 | 모든 요청 | 상세 에러 메시지 |

> **권장**: 공개 저장소인 경우 `QA_SYNC_SECRET` 환경변수를 설정하세요.

#### XSS 방지

```typescript
// code.ts - 이슈 본문 생성 시
const safeAnnotationText = input.annotationText
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');
```

**왜?**: 악성 스크립트가 이슈 본문에 삽입되는 것을 방지

---

## 6. 데이터 저장소

### Vercel KV (Redis)에 저장되는 데이터

| 키 패턴 | 용도 | 유효기간 |
|--------|------|----------|
| `oauth:state:{state}` | 로그인 진행 상태 추적 | 10분 |
| `oauth:session:{sessionId}` | 로그인된 사용자 세션 | **24시간** |

#### state 데이터 예시
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": 1706889600000,
  "status": "pending"  // → "completed"로 변경됨
}
```

#### session 데이터 예시
```json
{
  "accessToken": "a1b2c3d4...:e5f6g7h8...:i9j0k1l2...",  // 암호화됨!
  "userId": 12345678,
  "login": "username",
  "avatarUrl": "https://avatars.githubusercontent.com/u/12345678",
  "createdAt": 1706889600000
}
```

> **중요**: `accessToken`은 암호화되어 저장됩니다.
> KV가 유출되어도 `ENCRYPTION_KEY` 없이는 복호화 불가능합니다.

### Figma clientStorage에 저장되는 데이터

| 키 | 용도 |
|----|------|
| `qa-sync-settings` | 플러그인 설정 (endpoint, owner, repo 등) |
| `qa-github-session` | 로그인 세션 ID |

---

## 7. 환경변수

Vercel 대시보드에서 설정해야 하는 값:

```bash
# GitHub OAuth App 정보
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OAUTH_CALLBACK_URL=https://your-app.vercel.app/api/auth/callback

# Vercel KV (자동 생성됨)
KV_REST_API_URL=https://xxx.upstash.io
KV_REST_API_TOKEN=xxxxxxxx

# 보안 (필수)
ENCRYPTION_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# 생성 방법: openssl rand -hex 32

# 폴백용 서버 토큰 (선택)
GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# API 접근 제한 (선택)
QA_SYNC_SECRET=your-secret-key
```

### 환경변수 보안 중요도

| 변수 | 유출 시 위험도 | 설명 |
|------|---------------|------|
| `GITHUB_CLIENT_SECRET` | 🔴 Critical | 앱 가장하여 인증 가능 |
| `ENCRYPTION_KEY` | 🔴 Critical | 모든 저장된 토큰 복호화 가능 |
| `KV_REST_API_TOKEN` | 🔴 Critical | 모든 세션 데이터 접근 가능 |
| `GITHUB_TOKEN` | 🟠 High | 서버 권한으로 이슈 생성 가능 |
| `QA_SYNC_SECRET` | 🟡 Medium | API 무단 접근 가능 |
| `GITHUB_CLIENT_ID` | 🟢 Low | 공개해도 무방 |

---

## 8. 문제 해결 가이드

### 로그인 버튼이 반응 없음
1. Endpoint URL이 올바르게 입력되었는지 확인
2. **HTTPS**로 시작하는지 확인 (HTTP는 차단됨)
3. 플러그인 하단 상태 메시지 확인
4. 브라우저 개발자 도구에서 네트워크 오류 확인

### 로그인 후 "인증 대기 중"에서 멈춤
1. 브라우저에서 GitHub 로그인 완료했는지 확인
2. 5분 초과 시 자동 타임아웃 → 다시 시도

### "Too Many Requests" 에러 (429)
1. Rate Limit에 걸림 (분당 10회 초과)
2. 1분 기다린 후 다시 시도

### "요청 출처를 확인할 수 없습니다" 에러
1. 구버전 코드에서 발생하던 에러 (현재는 수정됨)
2. 최신 버전으로 업데이트 필요

### 이슈가 다른 사람 이름으로 생성됨
1. 플러그인에서 로그인 상태 확인 (@username 표시되는지)
2. 로그아웃 후 다시 로그인 시도

### 세션이 자주 만료됨
1. 세션 유효기간이 24시간으로 설정됨 (보안상 이유)
2. 매일 재로그인 필요

---

## 9. 용어 정리

| 용어 | 설명 |
|------|------|
| **OAuth** | 다른 서비스(GitHub)의 계정으로 로그인하는 표준 방식 |
| **Access Token** | GitHub API를 사용할 수 있는 "열쇠" |
| **Session** | 로그인 상태를 유지하기 위한 정보 |
| **Polling** | 주기적으로 상태를 확인하는 방식 |
| **KV (Key-Value)** | 키와 값을 저장하는 간단한 데이터베이스 |
| **Callback URL** | GitHub이 인증 완료 후 돌아올 주소 |
| **State** | 요청 위조(CSRF) 방지를 위한 1회용 코드 |
| **CORS** | 브라우저가 다른 도메인 요청을 제어하는 보안 정책 |
| **Rate Limiting** | 요청 횟수를 제한하는 보안 기능 |
| **AES-256-GCM** | 강력한 대칭키 암호화 알고리즘 |
| **CSRF** | 사용자를 속여 의도치 않은 요청을 보내게 하는 공격 |
| **XSS** | 웹페이지에 악성 스크립트를 삽입하는 공격 |
| **Path Traversal** | `../`를 사용해 허용되지 않은 파일에 접근하는 공격 |

---

## 10. 보안 체크리스트

배포 전 확인해야 할 사항:

- [ ] `ENCRYPTION_KEY` 환경변수 설정 완료
- [ ] `GITHUB_CLIENT_SECRET` 공개 저장소에 커밋 안 함
- [ ] HTTPS URL만 사용
- [ ] Vercel KV 연결 완료
- [ ] Rate Limit 테스트 완료 (11번째 요청에서 429 반환)
- [ ] CORS 테스트 완료 (악성 도메인에서 차단)
