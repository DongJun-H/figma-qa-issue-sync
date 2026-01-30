# QA Annotation → GitHub Issues Sync

Figma Dev Mode annotation 중 **QA 카테고리**만 수동으로 동기화해 GitHub Issue를 생성합니다.

## 구성
- Figma 플러그인: Annotation을 읽어 이슈 요청을 Vercel API로 전송
- Vercel 서버리스: GitHub Issues API 호출

## Vercel 설정
1. 이 레포를 Vercel에 연결합니다.
2. 환경변수 설정:
   - `GITHUB_TOKEN`: Fine-grained PAT (Issues: Read & Write 권한)
   - `GITHUB_PROJECT_NAME` (선택): GitHub Project v2 이름 (예: `DAYO 2.0`)
   - `GITHUB_PROJECT_OWNER` (선택): 프로젝트 소유자 (예: `Daily-DAYO`)
   - `QA_SYNC_SECRET` (선택): 플러그인과 서버 간 간단한 공유 시크릿
3. 배포 후, Vercel 엔드포인트는 `/api/qa-issues`입니다.

## 플러그인 사용법
1. `npm install`
2. `npm run build` 또는 `npm run watch`
3. Figma 데스크탑 앱에서 플러그인 등록
4. 플러그인 UI에 아래 값 입력
   - Vercel Endpoint URL
   - GitHub owner / repo
   - Label (기본 QA)
   - Secret (설정한 경우)
   - File URL/Key (Private 플러그인이 아니면 필요)
5. **Sync QA Annotations** 버튼 클릭

## 동작 규칙
- 제목: `[QA] Fix ({최상위 프레임명}) {컴포넌트명}`
- 본문: 템플릿 형식(발견 위치/문제 설명/스펙 포함)
- 이미 전송된 annotation은 node pluginData로 추적합니다.

## 사전 조건
- Dev Mode에서 QA 카테고리를 생성해야 합니다.

## GitHub Projects v2 연동 (선택)
- `GITHUB_PROJECT_NAME`을 설정하면 생성된 이슈를 해당 프로젝트에 추가합니다.
- Fine-grained PAT에 **Projects: Read & Write** 권한이 필요합니다.

## 참고
TypeScript를 사용하며, `code.ts` → `code.js`로 컴파일됩니다.
