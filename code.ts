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
    figma.ui.postMessage({ type: 'settings', settings });
    return;
  }

  if (msg.type === 'sync-qa') {
    const settings = normalizeSettings(msg.settings as Partial<SyncSettings>);
    await saveSettings(settings);
    await syncQaAnnotations(settings);
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
  if (!settings.endpoint) {
    figma.ui.postMessage({ type: 'error', message: 'Vercel endpoint URL을 입력해주세요.' });
    return;
  }
  if (!settings.owner || !settings.repo) {
    figma.ui.postMessage({ type: 'error', message: 'GitHub owner/repo를 입력해주세요.' });
    return;
  }

  const fileKey = figma.fileKey ?? extractFileKey(settings.fileKeyInput);
  if (!fileKey) {
    figma.ui.postMessage({
      type: 'error',
      message:
        'Figma 파일 키를 찾을 수 없습니다. 플러그인을 Private로 유지하거나, 파일 URL/키를 입력해주세요.',
    });
    return;
  }

  const qaCategory = await getQaCategory();
  if (!qaCategory) {
    figma.ui.postMessage({
      type: 'error',
      message: 'QA 카테고리를 찾을 수 없습니다. (Dev Mode에서 QA 카테고리를 생성했는지 확인해주세요)',
    });
    return;
  }

  if (settings.scanAllPages) {
    await figma.loadAllPagesAsync();
  }

  const pages = settings.scanAllPages ? figma.root.children : [figma.currentPage];
  const fileName = figma.root.name;
  const nodeMap = new Map<string, SceneNode>();
  const issues: IssueRequestItem[] = [];

  for (const page of pages) {
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

        const componentName = getComponentName(node);
        const title = `Fix ${componentName}`;
        const link = buildFigmaLink(fileKey, fileName, node.id);
        const body = `${annotationText || '(No annotation text)'}\n\nFigma: ${link}`;

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

  figma.ui.postMessage({ type: 'progress', message: `총 ${issues.length}건 전송 중...` });

  try {
    const response = await fetch(settings.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.secret ? { 'X-QA-Secret': settings.secret } : {}),
      },
      body: JSON.stringify({
        owner: settings.owner,
        repo: settings.repo,
        issues,
      }),
    });

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
    figma.ui.postMessage({ type: 'error', message: `요청 실패: ${(error as Error).message}` });
  }
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

function getComponentName(node: SceneNode): string {
  if (node.type === 'INSTANCE') {
    return node.mainComponent?.name ?? node.name;
  }

  let current: BaseNode | null = node;
  while (current && current.type !== 'PAGE' && current.type !== 'DOCUMENT') {
    if (current.type === 'INSTANCE') {
      return current.mainComponent?.name ?? current.name;
    }
    if (current.type === 'COMPONENT' || current.type === 'COMPONENT_SET') {
      return current.name;
    }
    current = current.parent;
  }

  return node.name;
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
