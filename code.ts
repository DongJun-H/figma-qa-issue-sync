type SyncSettings = {
  endpoint: string;
  owner: string;
  repo: string;
  label: string;
  secret: string;
  fileKeyInput: string;
  scanAllPages: boolean;
  skipSynced: boolean;
};

type IssueRequestItem = {
  title: string;
  body: string;
  labels: string[];
  nodeId: string;
  signature: string;
};

type IssueResultItem = {
  nodeId?: string;
  signature?: string;
  status?: number;
  url?: string;
  error?: string;
};

const STORAGE_KEY = 'qa-sync-settings';
const SESSION_KEY = 'qa-github-session';
const PLUGIN_DATA_KEY = 'qaIssueSynced';

const DEFAULT_SETTINGS: SyncSettings = {
  endpoint: '',
  owner: '',
  repo: '',
  label: 'QA',
  secret: '',
  fileKeyInput: '',
  scanAllPages: false,
  skipSynced: true,
};

figma.showUI(__html__, { width: 360, height: 520 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'get-settings') {
    const settings = await loadSettings();
    const sessionId = await figma.clientStorage.getAsync(SESSION_KEY);
    figma.ui.postMessage({ type: 'settings', settings, sessionId });
    return;
  }

  if (msg.type === 'check-auth') {
    const sessionId = await figma.clientStorage.getAsync(SESSION_KEY);
    if (!sessionId) {
      figma.ui.postMessage({ type: 'auth-status', authenticated: false });
      return;
    }
    // UI will handle the actual API call
    figma.ui.postMessage({ type: 'auth-status-check', sessionId });
    return;
  }

  if (msg.type === 'start-login') {
    const settings = normalizeSettings(msg.settings as Partial<SyncSettings>);
    const endpoint = settings.endpoint.replace(/\/api\/qa-issues\/?$/, '');
    if (!endpoint) {
      figma.ui.postMessage({ type: 'error', message: 'Endpoint URL을 먼저 설정해주세요.' });
      return;
    }
    figma.ui.postMessage({ type: 'open-auth', endpoint });
    return;
  }

  if (msg.type === 'open-external') {
    figma.openExternal(msg.url);
    return;
  }

  if (msg.type === 'save-session') {
    await figma.clientStorage.setAsync(SESSION_KEY, msg.sessionId);
    figma.ui.postMessage({ type: 'auth-saved' });
    return;
  }

  if (msg.type === 'logout') {
    const sessionId = await figma.clientStorage.getAsync(SESSION_KEY);
    const settings = normalizeSettings(msg.settings as Partial<SyncSettings>);
    const endpoint = settings.endpoint.replace(/\/api\/qa-issues\/?$/, '');
    await figma.clientStorage.deleteAsync(SESSION_KEY);
    figma.ui.postMessage({ type: 'do-logout', endpoint, sessionId });
    return;
  }

  if (msg.type === 'sync-qa') {
    const settings = normalizeSettings(msg.settings as Partial<SyncSettings>);
    await saveSettings(settings);
    await syncQaAnnotations(settings);
    return;
  }

  if (msg.type === 'view-synced') {
    const settings = normalizeSettings(msg.settings as Partial<SyncSettings>);
    await saveSettings(settings);
    await viewSyncedAnnotations(settings);
    return;
  }

  if (msg.type === 'reset-synced') {
    const settings = normalizeSettings(msg.settings as Partial<SyncSettings>);
    await saveSettings(settings);
    await resetSyncedAnnotations(settings);
    return;
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
  }
};

function normalizeSettings(input: Partial<SyncSettings>): SyncSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    endpoint: (input.endpoint ?? DEFAULT_SETTINGS.endpoint).trim(),
    owner: (input.owner ?? DEFAULT_SETTINGS.owner).trim(),
    repo: (input.repo ?? DEFAULT_SETTINGS.repo).trim(),
    label: (input.label ?? DEFAULT_SETTINGS.label).trim(),
    secret: (input.secret ?? DEFAULT_SETTINGS.secret).trim(),
    fileKeyInput: (input.fileKeyInput ?? DEFAULT_SETTINGS.fileKeyInput).trim(),
    scanAllPages: Boolean(input.scanAllPages),
    skipSynced: input.skipSynced !== false,
  };
}

async function loadSettings(): Promise<SyncSettings> {
  const stored = (await figma.clientStorage.getAsync(STORAGE_KEY)) as Partial<SyncSettings> | undefined;
  return normalizeSettings(stored ?? {});
}

async function saveSettings(settings: SyncSettings): Promise<void> {
  await figma.clientStorage.setAsync(STORAGE_KEY, settings);
}

async function syncQaAnnotations(settings: SyncSettings): Promise<void> {
  try {
    if (!settings.endpoint) {
      figma.ui.postMessage({ type: 'error', message: 'Vercel endpoint URL을 입력해주세요.' });
      return;
    }
    // Enforce HTTPS for security
    if (!settings.endpoint.startsWith('https://')) {
      figma.ui.postMessage({
        type: 'error',
        message: '보안을 위해 HTTPS URL만 허용됩니다.'
      });
      return;
    }
    if (!settings.owner || !settings.repo) {
      figma.ui.postMessage({ type: 'error', message: 'GitHub owner/repo를 입력해주세요.' });
      return;
    }

    figma.ui.postMessage({ type: 'progress', message: '파일 정보 확인 중...' });
    const fileKey = figma.fileKey ?? extractFileKey(settings.fileKeyInput);
    if (!fileKey) {
      figma.ui.postMessage({
        type: 'error',
        message:
          'Figma 파일 키를 찾을 수 없습니다. 플러그인을 Private로 유지하거나, 파일 URL/키를 입력해주세요.',
      });
      return;
    }

    figma.ui.postMessage({ type: 'progress', message: 'QA 카테고리 확인 중...' });
    const qaCategory = await getQaCategory();
    if (!qaCategory) {
      figma.ui.postMessage({
        type: 'error',
        message: 'QA 카테고리를 찾을 수 없습니다. (Dev Mode에서 QA 카테고리를 생성했는지 확인해주세요)',
      });
      return;
    }

    if (settings.scanAllPages) {
      figma.ui.postMessage({ type: 'progress', message: '전체 페이지 로딩 중...' });
      await figma.loadAllPagesAsync();
    }

    const pages = settings.scanAllPages ? figma.root.children : [figma.currentPage];
    const fileName = figma.root.name;
    const nodeMap = new Map<string, SceneNode>();
    const issues: IssueRequestItem[] = [];
    const totalPages = pages.length;
    let pageIndex = 0;

    for (const page of pages) {
      pageIndex += 1;
      figma.ui.postMessage({
        type: 'progress',
        message: `QA annotation 스캔 중... (${pageIndex}/${totalPages})`,
      });
      const annotatedNodes = page.findAll((node) => {
        return 'annotations' in node && Array.isArray((node as any).annotations) && (node as any).annotations.length > 0;
      }) as SceneNode[];

      for (const node of annotatedNodes) {
        const annotations = (node as any).annotations as ReadonlyArray<Annotation>;
        if (!annotations || annotations.length === 0) continue;

        for (const annotation of annotations) {
          if (annotation.categoryId !== qaCategory.id) continue;

          const annotationText = annotation.labelMarkdown ?? annotation.label ?? '';
          const signature = hashString(
            `${node.id}|${annotation.categoryId ?? ''}|${annotationText}`
          );

          if (settings.skipSynced && isSignatureSynced(node, signature)) {
            continue;
          }

          const componentName = await getComponentName(node);
          const layerName = getTopLevelFrameName(node);
          const title = `[QA] Fix ${componentName} in ${layerName}`;
          const link = buildFigmaLink(fileKey, fileName, node.id);
          const body = buildIssueBody({
            annotationText: annotationText || '(No annotation text)',
            layerName,
            figmaLink: link,
            annotation,
            node,
            componentName,
          });

          issues.push({
            title,
            body,
            labels: [settings.label || 'QA'],
            nodeId: node.id,
            signature,
          });
          nodeMap.set(node.id, node);
        }
      }
    }

    if (issues.length === 0) {
      figma.ui.postMessage({ type: 'empty', message: '전송할 QA annotation이 없습니다.' });
      return;
    }

    figma.ui.postMessage({
      type: 'progress',
      message: `수집 완료: ${issues.length}건. 서버 전송 중...`,
    });

    const sessionId = await figma.clientStorage.getAsync(SESSION_KEY);
    const response = await fetchWithTimeout(settings.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'X-QA-Session': sessionId } : {}),
        ...(settings.secret ? { 'X-QA-Secret': settings.secret } : {}),
      },
      body: JSON.stringify({
        owner: settings.owner,
        repo: settings.repo,
        issues,
      }),
    }, 20000);

    if (!response.ok) {
      const text = await response.text();
      figma.ui.postMessage({
        type: 'error',
        message: `서버 에러 (${response.status}): ${text || response.statusText}`,
      });
      return;
    }

    const data = (await response.json()) as { created?: number; failed?: number; results?: IssueResultItem[] };
    const results = Array.isArray(data.results) ? data.results : [];
    let createdCount = 0;

    for (const result of results) {
      if (!result.nodeId || !result.signature) continue;
      const node = nodeMap.get(result.nodeId);
      if (!node) continue;
      if (result.status && result.status >= 200 && result.status < 300) {
        markSignatureSynced(node, result.signature);
        createdCount += 1;
      }
    }

    figma.ui.postMessage({
      type: 'done',
      message: `완료: ${createdCount}건 생성, ${data.failed ?? 0}건 실패`,
    });
  } catch (error) {
    const message = (error as Error).message === 'Timeout'
      ? '요청 시간이 초과되었습니다. 네트워크/엔드포인트를 확인해주세요.'
      : `요청 실패: ${(error as Error).message}`;
    figma.ui.postMessage({ type: 'error', message });
  }
}

async function viewSyncedAnnotations(settings: SyncSettings): Promise<void> {
  try {
    if (settings.scanAllPages) {
      figma.ui.postMessage({ type: 'progress', message: '전체 페이지 로딩 중...' });
      await figma.loadAllPagesAsync();
    }

    const pages = settings.scanAllPages ? figma.root.children : [figma.currentPage];
    const totalPages = pages.length;
    let pageIndex = 0;
    let totalNodes = 0;
    let totalSignatures = 0;

    for (const page of pages) {
      pageIndex += 1;
      figma.ui.postMessage({
        type: 'progress',
        message: `전송 기록 스캔 중... (${pageIndex}/${totalPages})`,
      });
      const nodesWithData = page.findAll((node) => {
        if (!('getPluginData' in node)) return false;
        const stored = (node as BaseNode & PluginDataMixin).getPluginData(PLUGIN_DATA_KEY);
        return Boolean(stored);
      }) as SceneNode[];

      for (const node of nodesWithData) {
        const stored = node.getPluginData(PLUGIN_DATA_KEY);
        if (!stored) continue;
        totalNodes += 1;
        try {
          const parsed = JSON.parse(stored) as string[];
          totalSignatures += Array.isArray(parsed) ? parsed.length : 1;
        } catch {
          totalSignatures += 1;
        }
      }
    }

    figma.ui.postMessage({
      type: 'done',
      message: `전송 기록: 노드 ${totalNodes}개, 항목 ${totalSignatures}개`,
    });
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: `요청 실패: ${(error as Error).message}` });
  }
}

async function resetSyncedAnnotations(settings: SyncSettings): Promise<void> {
  try {
    if (settings.scanAllPages) {
      figma.ui.postMessage({ type: 'progress', message: '전체 페이지 로딩 중...' });
      await figma.loadAllPagesAsync();
    }

    const pages = settings.scanAllPages ? figma.root.children : [figma.currentPage];
    const totalPages = pages.length;
    let pageIndex = 0;
    let clearedNodes = 0;

    for (const page of pages) {
      pageIndex += 1;
      figma.ui.postMessage({
        type: 'progress',
        message: `전송 기록 초기화 중... (${pageIndex}/${totalPages})`,
      });
      const nodesWithData = page.findAll((node) => {
        if (!('getPluginData' in node)) return false;
        const stored = (node as BaseNode & PluginDataMixin).getPluginData(PLUGIN_DATA_KEY);
        return Boolean(stored);
      }) as SceneNode[];

      for (const node of nodesWithData) {
        node.setPluginData(PLUGIN_DATA_KEY, '');
        clearedNodes += 1;
      }
    }

    figma.ui.postMessage({
      type: 'done',
      message: `초기화 완료: ${clearedNodes}개 노드에서 전송 기록 삭제`,
    });
  } catch (error) {
    figma.ui.postMessage({ type: 'error', message: `요청 실패: ${(error as Error).message}` });
  }
}

function fetchWithTimeout(
  url: string,
  options: FetchOptions,
  timeoutMs: number
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Timeout'));
    }, timeoutMs);

    fetch(url, options)
      .then((response) => {
        clearTimeout(timeoutId);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function buildIssueBody(input: {
  annotationText: string;
  layerName: string;
  figmaLink: string;
  annotation: Annotation;
  node: SceneNode;
  componentName: string;
}): string {
  const annotationProps = formatAnnotationProperties(input.node, input.annotation, input.componentName);
  const componentProps = formatComponentProperties(input.node);
  const annotationLines = annotationProps.length
    ? annotationProps.reduce<string[]>((acc, prop) => acc.concat(formatPropertyLines(prop)), [])
    : ['- 없음'];
  const componentLines = componentProps.length
    ? componentProps.reduce<string[]>((acc, prop) => acc.concat(formatPropertyLines(prop)), [])
    : ['- 없음'];

  // Sanitize annotation text to prevent XSS in GitHub Markdown
  const safeAnnotationText = input.annotationText
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return [
    '# 🎨 디자인 QA',
    '',
    '## 발견 위치',
    `- **화면**: ${input.layerName}`,
    `- **Figma 링크**: ${input.figmaLink}`,
    '',
    '## 문제 설명',
    safeAnnotationText,
    '',
    '### Annotation에 함께 등록된 properties',
    ...annotationLines,
    '',
    '## 상세 스펙',
    ...componentLines,
  ].join('\n');
}

function formatAnnotationProperties(
  node: SceneNode,
  annotation: Annotation,
  componentName: string
): Array<{ name: string; lines: string[] }> {
  const properties = annotation.properties ?? [];
  const lines: Array<{ name: string; lines: string[] }> = [];

  for (const property of properties) {
    const value = getAnnotationPropertyValue(node, property.type, componentName);
    if (value === null || value === undefined) continue;
    const formattedLines = formatValueLines(value);
    if (formattedLines.length === 0) continue;
    lines.push({ name: property.type, lines: formattedLines });
  }

  return lines;
}

function formatComponentProperties(node: SceneNode): Array<{ name: string; lines: string[] }> {
  const instance = getContainingInstance(node);
  if (!instance) return [];

  const entries = Object.entries(instance.componentProperties ?? {});
  if (entries.length === 0) return [];

  const normalized = new Map<string, string[]>();
  for (const [rawName, meta] of entries) {
    const baseName = rawName.split('#')[0];
    const value = meta?.value;
    const formatted = formatValueLines(value);
    if (formatted.length === 0) continue;
    normalized.set(baseName, formatted);
  }

  return Array.from(normalized.entries()).map(([name, lines]) => ({ name, lines }));
}

function getAnnotationPropertyValue(
  node: SceneNode,
  type: AnnotationPropertyType,
  componentName: string
): any {
  const anyNode = node as any;

  switch (type) {
    case 'mainComponent':
      return componentName;
    case 'padding': {
      if (
        typeof anyNode.paddingTop === 'number' ||
        typeof anyNode.paddingRight === 'number' ||
        typeof anyNode.paddingBottom === 'number' ||
        typeof anyNode.paddingLeft === 'number'
      ) {
        return {
          top: anyNode.paddingTop,
          right: anyNode.paddingRight,
          bottom: anyNode.paddingBottom,
          left: anyNode.paddingLeft,
        };
      }
      return null;
    }
    case 'alignItems': {
      const primary = anyNode.primaryAxisAlignItems;
      const counter = anyNode.counterAxisAlignItems;
      if (primary || counter) {
        return { primary, counter };
      }
      return null;
    }
    case 'fontFamily': {
      if (node.type !== 'TEXT') return null;
      const fontName = node.fontName;
      if (fontName === figma.mixed) return 'MIXED';
      if (fontName && typeof fontName === 'object') {
        return fontName.family;
      }
      return null;
    }
    case 'fontStyle': {
      if (node.type !== 'TEXT') return null;
      const fontName = node.fontName;
      if (fontName === figma.mixed) return 'MIXED';
      if (fontName && typeof fontName === 'object') {
        return fontName.style;
      }
      return null;
    }
    default: {
      if (typeof anyNode[type] !== 'undefined') {
        return anyNode[type];
      }
      return null;
    }
  }
}

function formatPropertyLines(prop: { name: string; lines: string[] }): string[] {
  if (prop.lines.length === 1 && !prop.lines[0].startsWith('- ')) {
    return [`- **${prop.name}**: ${prop.lines[0]}`];
  }

  return [`- **${prop.name}**:`, ...prop.lines.map((line) => `  ${line}`)];
}

function formatValueLines(value: any): string[] {
  if (value === undefined || value === null) return [];
  if (isPrimitive(value)) {
    return [formatPrimitive(value)];
  }

  return formatNestedLines(value);
}

function formatNestedLines(value: any): string[] {
  if (value === undefined || value === null) return [];
  if (isPrimitive(value)) {
    return [`- ${formatPrimitive(value)}`];
  }

  if (Array.isArray(value)) {
    const lines: string[] = [];
    value.forEach((item, index) => {
      if (isPrimitive(item)) {
        lines.push(`- ${formatPrimitive(item)}`);
        return;
      }
      lines.push(`- item ${index + 1}:`);
      lines.push(...indentLines(formatNestedLines(item)));
    });
    return lines;
  }

  if (typeof value === 'object') {
    const lines: string[] = [];
    for (const [key, entry] of Object.entries(value)) {
      if (isPrimitive(entry)) {
        lines.push(`- ${key}: ${formatPrimitive(entry)}`);
      } else {
        lines.push(`- ${key}:`);
        lines.push(...indentLines(formatNestedLines(entry)));
      }
    }
    return lines;
  }

  return [`- ${String(value)}`];
}

function indentLines(lines: string[]): string[] {
  return lines.map((line) => `  ${line}`);
}

function isPrimitive(value: any): boolean {
  return (
    value === figma.mixed ||
    value === null ||
    ['string', 'number', 'boolean'].includes(typeof value)
  );
}

function formatPrimitive(value: any): string {
  if (value === figma.mixed) return 'MIXED';
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value.toString() : String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    if ('value' in value && 'unit' in value) {
      return `${(value as { value: number; unit: string }).value}${(value as { unit: string }).unit}`;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function getContainingInstance(node: SceneNode): InstanceNode | null {
  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if (current.type === 'INSTANCE') {
      return current;
    }
    current = current.parent;
  }
  return null;
}

async function getQaCategory(): Promise<AnnotationCategory | null> {
  const annotationsApi = (figma as any).annotations as typeof figma.annotations | undefined;
  if (!annotationsApi || !annotationsApi.getAnnotationCategoriesAsync) {
    return null;
  }
  const categories = await annotationsApi.getAnnotationCategoriesAsync();
  const qa = categories.find((category) => category.label.trim().toLowerCase() === 'qa');
  return qa ?? null;
}

function buildFigmaLink(fileKey: string, fileName: string, nodeId: string): string {
  const encodedName = encodeURIComponent(fileName);
  const encodedNode = encodeURIComponent(nodeId);
  return `https://www.figma.com/file/${fileKey}/${encodedName}?node-id=${encodedNode}`;
}

function extractFileKey(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/figma\.com\/(?:file|design)\/([^\/?]+)/i);
  if (urlMatch && urlMatch[1]) return urlMatch[1];
  return trimmed;
}

async function getComponentName(node: SceneNode): Promise<string> {
  if (node.type === 'INSTANCE') {
    const mainComponent = await node.getMainComponentAsync();
    if (mainComponent) {
      if (mainComponent.parent && mainComponent.parent.type === 'COMPONENT_SET') {
        return mainComponent.parent.name;
      }
      return mainComponent.name;
    }
  }

  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if (current.type === 'INSTANCE') {
      const mainComponent = await current.getMainComponentAsync();
      if (mainComponent) {
        if (mainComponent.parent && mainComponent.parent.type === 'COMPONENT_SET') {
          return mainComponent.parent.name;
        }
        return mainComponent.name;
      }
    }
    if (current.type === 'COMPONENT_SET' || current.type === 'COMPONENT') {
      return current.name;
    }
    current = current.parent;
  }

  return node.name;
}

function getTopLevelFrameName(node: SceneNode): string {
  let current: BaseNode | null = node;

  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if (
      current.type === 'FRAME' &&
      current.parent &&
      (current.parent.type === 'PAGE' || current.parent.type === 'SECTION')
    ) {
      return current.name;
    }
    current = current.parent;
  }

  return node.parent?.name ?? node.name;
}

function isSignatureSynced(node: BaseNode & PluginDataMixin, signature: string): boolean {
  const stored = node.getPluginData(PLUGIN_DATA_KEY);
  if (!stored) return false;
  try {
    const parsed = JSON.parse(stored) as string[];
    return Array.isArray(parsed) && parsed.includes(signature);
  } catch {
    return false;
  }
}

function markSignatureSynced(node: BaseNode & PluginDataMixin, signature: string): void {
  const stored = node.getPluginData(PLUGIN_DATA_KEY);
  let parsed: string[] = [];
  if (stored) {
    try {
      parsed = JSON.parse(stored) as string[];
    } catch {
      parsed = [];
    }
  }
  if (!parsed.includes(signature)) {
    parsed.push(signature);
    node.setPluginData(PLUGIN_DATA_KEY, JSON.stringify(parsed));
  }
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}
