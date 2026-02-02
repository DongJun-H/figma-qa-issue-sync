# QA Annotation → GitHub Issues Sync

Figma Dev Mode annotation 중 **QA 카테고리**를 GitHub Issue로 자동 생성하는 플러그인입니다.

## 주요 기능
- QA annotation을 GitHub Issues로 자동 변환
- **GitHub OAuth 로그인**: 사용자 본인 계정으로 이슈 생성
- GitHub Projects v2 연동 지원

## 구성
```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────┐
│  Figma 플러그인  │ ───► │   Vercel 서버    │ ───► │   GitHub    │
│  (ui.html,      │      │   (API + KV)    │      │  (Issues)   │
│   code.ts)      │      └─────────────────┘      └─────────────┘
└─────────────────┘
```

## 설정 방법

### 1. Vercel 배포
1. 이 레포를 Fork 후 Vercel에 연결
2. Vercel Storage에서 KV (Upstash Redis) 생성 및 프로젝트에 연결

### 2. GitHub OAuth App 생성
1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. 설정값:
   - **Application name**: `QA Issue Sync`
   - **Homepage URL**: `https://your-app.vercel.app`
   - **Authorization callback URL**: `https://your-app.vercel.app/api/auth/callback`
3. Client ID, Client Secret 복사

### 3. 환경변수 설정 (Vercel Dashboard)

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `GITHUB_CLIENT_ID` | O | GitHub OAuth App Client ID |
| `GITHUB_CLIENT_SECRET` | O | GitHub OAuth App Client Secret |
| `OAUTH_CALLBACK_URL` | O | `https://your-app.vercel.app/api/auth/callback` |
| `KV_REST_API_URL` | O | Vercel KV 연결 시 자동 생성 |
| `KV_REST_API_TOKEN` | O | Vercel KV 연결 시 자동 생성 |
| `GITHUB_TOKEN` | - | 폴백용 서버 토큰 (로그인 안 한 경우) |
| `GITHUB_PROJECT_NUMBER` | - | GitHub Project v2 번호 |
| `GITHUB_PROJECT_OWNER` | - | 프로젝트 소유자 |
| `QA_SYNC_SECRET` | - | API 접근 제한용 시크릿 |

### 4. 플러그인 빌드
```bash
npm install
npm run build
```

### 5. Figma에 플러그인 등록
1. Figma 데스크탑 앱 → Plugins → Development → Import plugin from manifest
2. `manifest.json` 선택

## 사용법

### 로그인
1. 플러그인 상단의 "로그인" 버튼 클릭
2. 브라우저에서 GitHub 인증 완료
3. 플러그인에 `@username` 표시 확인

### QA 이슈 생성
1. Endpoint URL, Owner, Repo 입력
2. **Sync QA Annotations** 클릭
3. GitHub에서 생성된 이슈 확인 (로그인한 계정으로 생성됨)

## 이슈 형식
- **제목**: `[QA] Fix {컴포넌트명} in {화면명}`
- **본문**: 발견 위치, 문제 설명, 상세 스펙 포함
- **라벨**: 설정한 라벨 (기본: `QA`)

## 사전 조건
- Figma Dev Mode에서 **QA 카테고리** 생성 필요

## 문서
- [OAuth 인증 시스템 상세 문서](docs/OAUTH_ARCHITECTURE.md)

## 파일 구조
```
├── api/
│   ├── auth/           # OAuth 인증 API
│   │   ├── login.js
│   │   ├── callback.js
│   │   ├── status.js
│   │   └── logout.js
│   └── qa-issues.js    # 이슈 생성 API
├── code.ts             # 플러그인 로직
├── ui.html             # 플러그인 UI
└── manifest.json       # 플러그인 설정
```
