export type AppLang = 'en' | 'zh' | 'ja'

interface DictBranch {
  [key: string]: string | DictBranch
}
type DictNode = string | DictBranch
type Dict = Record<AppLang, Record<string, DictNode>>

const DICT: Dict = {
  en: {
    common: {
      close: 'Close',
      loading: 'Loading…',
      refresh: 'Refresh',
      settings: 'Settings',
      auto: 'Auto',
      builtIn: 'Built-in'
    },
    app: {
      showSidebar: 'Show Sidebar',
      newChat: 'New Chat',
      files: 'Files',
      commit: 'Commit',
      terminal: 'Terminal',
      preview: 'Preview',
      configureModelFirst: 'Please configure a model',
      summaryTitle: 'Conversation Summary',
      summaryLoading: 'Loading…',
      summaryEmpty: 'No summary yet.',
      artifacts: 'Artifacts',
      newContentBelow: 'New content below',
      dropImageHint: 'Release to add image attachment',
      updatedAt: 'Updated at: {time}',
      messageCount: '{count} messages',
      noGitRepo: 'No Git repository',
      currentProjectNotGitRepo: 'Current project is not a Git repository',
      branches: 'Branches',
      spellSuggestions: 'Spelling suggestions: {word}',
      voiceInput: 'Voice Input',
      stopRecording: 'Stop Recording',
      contextUsage: 'Context Usage: {percent}',
      contextUsed: 'Used: {used}',
      contextLimit: 'Limit: {limit}'
    },
    update: {
      title: 'Software Update',
      found: 'A new version is available',
      upToDate: 'You are on the latest version',
      error: 'Update failed',
      cancel: 'Cancel',
      later: 'Later',
      downloadNow: 'Download now',
      downloading: 'Downloading…',
      downloaded: 'Download complete. Ready to install.',
      restartNow: 'Restart now',
      releaseNotes: 'Release notes'
    },
    todo: {
      progress: 'Task Progress'
    },
    rightSidebar: {
      files: 'Files',
      commit: 'Commit',
      terminal: 'Terminal',
      preview: 'Preview',
      loading: 'Loading…'
    },
    browserPreview: {
      go: 'Go',
      back: 'Back',
      forward: 'Forward',
      refresh: 'Refresh',
      zoomOut: 'Zoom Out',
      zoomIn: 'Zoom In',
      urlPlaceholder: 'Enter URL or start a preview server...',
      openInBrowser: 'Open in Browser',
      openDevtools: 'Open DevTools',
      autoFitReset: 'Auto Fit (Click to Reset)',
      clickAutoFit: 'Click to Auto Fit',
      ready: 'Ready to Browse',
      startPreview: 'Start Preview'
    },
    terminal: {
      create: 'Create Terminal',
      noActive: 'No active terminal',
      tabTitle: 'Terminal {index}'
    },
    git: {
      noRepoOpened: 'No repository opened.',
      openRepo: 'Open Repository',
      noGitRepo: 'No Git Repository',
      notGitFolder: 'The current folder is not a git repository.',
      initRepo: 'Initialize Repository',
      openDifferentFolder: 'Open Different Folder',
      branchPlaceholder: 'Branch',
      commitPlaceholder: 'Commit message...',
      commit: 'Commit',
      changes: 'Changes ({count})',
      noChanges: 'No changes detected',
      stashes: 'Stashes',
      noStashes: 'No stashes',
      head: 'HEAD',
      noCommits: 'No commits yet'
    },
    fileExplorer: {
      copyPartialFailed: 'Some files failed to copy: {items}',
      copyFailed: 'Copy failed: {error}',
      writePartialFailed: 'Some files failed to write: {items}',
      writeFailed: 'Write failed: {error}',
      movePartialFailed: 'Some items failed to move: {items}',
      moveFailed: 'Move failed: {error}',
      noFolderOpened: 'No folder opened.',
      openFolder: 'Open Folder',
      expand: 'Expand',
      collapse: 'Collapse',
      refresh: 'Refresh',
      openInFinder: 'Open in Finder',
      explorer: 'Explorer',
      moveExplorerLeft: 'Move explorer to left',
      moveExplorerRight: 'Move explorer to right',
      selectFileToPreview: 'Select a file to preview',
      externalDropEmpty: 'Detected external drag but no files were read. Drop files on a folder row, or use upload.',
      previewPaused: 'Preview paused',
      loading: 'Loading...',
      errorLoadingFile: 'Error loading file',
      previewNotAvailable: 'Preview not available',
      previewNotAvailableHint: 'This file type cannot be previewed directly.'
    },
    codeBlock: {
      showCode: 'Show Code',
      preview: 'Preview',
      runCode: 'Run code',
      copyCode: 'Copy code',
      previewTitle: '{lang} Preview'
    },
    artifacts: {
      preview: 'Preview'
    },
    chatHistory: {
      newChat: 'New Chat',
      newProject: 'New Project',
      addProject: 'Add project',
      emptyProjects: 'No projects',
      emptyProjectsHint: 'Add a project by selecting a folder.',
      emptyChats: '空',
      projectSection: 'Project',
      chatSection: 'Chat',
      untitled: 'New Chat',
      search: 'Search',
      collapseSidebar: 'Collapse sidebar',
      searchChats: 'Search chats',
      addProjectTip: 'Add project',
      createChatTip: 'New chat',
      projectMenuTip: 'More actions',
      deleteChatTip: 'Delete chat',
      deleteProject: 'Delete project',
      deleteProjectTitle: 'Delete Project',
      deleteProjectDesc: 'Delete this project and all its chats? This action cannot be undone.',
      deleteTitle: 'Delete Chat',
      deleteDesc: 'Are you sure you want to delete this chat? This action cannot be undone.',
      cancel: 'Cancel',
      ok: 'OK',
      delete: 'Delete',
      settings: 'Settings',
      renameProject: 'Rename project',
      projectName: 'Project name',
      pin: 'Pin',
      unpin: 'Unpin',
      createChat: 'New chat',
      update: 'Update',
      skills: 'Skills'
    },
    appInit: {
      loadingTitle: 'Loading settings…',
      failedTitle: 'Failed to load settings',
      subtitle: 'Connecting to local backend',
      retry: 'Retry'
    },
    settings: {
      modelConfig: {
        title: 'Configure Model: {model}',
        contextWindow: 'Context Window',
        contextWindowPlaceholder: 'e.g. 128000',
        maxOutputTokens: 'Max Output Tokens',
        maxOutputTokensPlaceholder: 'e.g. 4096',
        additionalConfig: 'Additional Config (JSON)',
        saveChanges: 'Save changes'
      },
      customProvider: {
        title: 'Add Custom Provider',
        providerType: 'Provider Type',
        apiProvider: 'API Provider',
        acpProvider: 'ACP Provider',
        providerName: 'Provider Name',
        providerNamePlaceholder: 'My Custom Provider',
        baseUrl: 'Base URL',
        apiKey: 'API Key',
        apiFormat: 'API Format',
        apiFormatHint: 'Choose the API endpoint format your provider uses',
        useMaxCompletionTokens: 'Use max_completion_tokens',
        useMaxCompletionTokensHint: 'Enable for newer OpenAI models (o1, o3, etc.) that require max_completion_tokens instead of max_tokens',
        command: 'Command',
        args: 'Args',
        kind: 'Kind',
        framing: 'Framing',
        approvalMode: 'Approval Mode',
        defaultModel: 'Default Model',
        env: 'Env (KEY=VALUE)',
        cancel: 'Cancel',
        addProvider: 'Add Provider'
      }
    }
  },
  zh: {
    common: {
      close: '关闭',
      loading: '加载中…',
      refresh: '刷新',
      settings: '设置',
      auto: '自动',
      builtIn: '内置'
    },
    app: {
      showSidebar: '显示侧边栏',
      newChat: '新对话',
      files: '文件',
      commit: '提交',
      terminal: '终端',
      preview: '预览',
      configureModelFirst: '请配置模型',
      summaryTitle: '对话摘要',
      summaryLoading: '加载中…',
      summaryEmpty: '暂无摘要。',
      artifacts: '产物',
      newContentBelow: '下方有新内容',
      dropImageHint: '松开即可添加图片附件',
      updatedAt: '更新时间：{time}',
      messageCount: '{count} 条消息',
      noGitRepo: '无 Git 仓库',
      currentProjectNotGitRepo: '当前项目不是 Git 仓库',
      branches: '分支',
      spellSuggestions: '拼写建议：{word}',
      voiceInput: '语音输入',
      stopRecording: '停止录音',
      contextUsage: '上下文使用：{percent}',
      contextUsed: '已用：{used}',
      contextLimit: '上限：{limit}'
    },
    update: {
      title: '软件更新',
      found: '发现新版本可用',
      upToDate: '当前已是最新版本',
      error: '更新失败',
      cancel: '取消',
      later: '稍后',
      downloadNow: '立即下载',
      downloading: '下载中…',
      downloaded: '下载完成！准备安装。',
      restartNow: '立即重启',
      releaseNotes: '更新内容'
    },
    todo: {
      progress: '任务进度'
    },
    rightSidebar: {
      files: '文件',
      commit: '提交',
      terminal: '终端',
      preview: '预览',
      loading: '加载中…'
    },
    browserPreview: {
      go: '前往',
      back: '后退',
      forward: '前进',
      refresh: '刷新',
      zoomOut: '缩小',
      zoomIn: '放大',
      urlPlaceholder: '输入 URL 或启动预览服务...',
      openInBrowser: '在浏览器中打开',
      openDevtools: '打开开发者工具',
      autoFitReset: '自动适配（点击重置）',
      clickAutoFit: '点击自动适配',
      ready: '准备浏览',
      startPreview: '开始预览'
    },
    terminal: {
      create: '新建终端',
      noActive: '没有活动终端',
      tabTitle: '终端 {index}'
    },
    git: {
      noRepoOpened: '未打开仓库。',
      openRepo: '打开仓库',
      noGitRepo: '不是 Git 仓库',
      notGitFolder: '当前文件夹不是 Git 仓库。',
      initRepo: '初始化仓库',
      openDifferentFolder: '打开其他文件夹',
      branchPlaceholder: '分支',
      commitPlaceholder: '提交信息...',
      commit: '提交',
      changes: '变更 ({count})',
      noChanges: '未检测到变更',
      stashes: '暂存',
      noStashes: '暂无暂存',
      head: 'HEAD',
      noCommits: '暂无提交'
    },
    fileExplorer: {
      copyPartialFailed: '部分文件复制失败：{items}',
      copyFailed: '拖拽复制失败：{error}',
      writePartialFailed: '部分文件写入失败：{items}',
      writeFailed: '拖拽写入失败：{error}',
      movePartialFailed: '部分项目移动失败：{items}',
      moveFailed: '拖拽移动失败：{error}',
      noFolderOpened: '未打开文件夹。',
      openFolder: '打开文件夹',
      expand: '展开',
      collapse: '收起',
      refresh: '刷新',
      openInFinder: '在 Finder 中打开',
      explorer: '资源管理器',
      moveExplorerLeft: '将资源管理器移到左侧',
      moveExplorerRight: '将资源管理器移到右侧',
      selectFileToPreview: '选择文件以预览',
      externalDropEmpty: '检测到外部拖拽，但未读取到文件列表。请把文件拖到文件夹名称行后松开，或直接使用上传入口。',
      previewPaused: '预览已暂停',
      loading: '加载中...',
      errorLoadingFile: '加载文件失败',
      previewNotAvailable: '无法预览',
      previewNotAvailableHint: '该文件类型不支持直接预览。'
    },
    codeBlock: {
      showCode: '显示代码',
      preview: '预览',
      runCode: '运行代码',
      copyCode: '复制代码',
      previewTitle: '{lang} 预览'
    },
    artifacts: {
      preview: '预览'
    },
    chatHistory: {
      newChat: '新对话',
      newProject: '新建项目',
      addProject: '添加项目',
      emptyProjects: '暂无项目',
      emptyProjectsHint: '通过选择文件夹来添加一个项目。',
      emptyChats: '空',
      projectSection: '项目',
      chatSection: '聊天',
      untitled: '新对话',
      search: '搜索',
      collapseSidebar: '收起侧边栏',
      searchChats: '搜索对话',
      addProjectTip: '添加项目',
      createChatTip: '新建对话',
      projectMenuTip: '更多操作',
      deleteChatTip: '删除对话',
      deleteProject: '删除项目',
      deleteProjectTitle: '删除项目',
      deleteProjectDesc: '确定要删除该项目及其全部对话吗？此操作无法撤销。',
      deleteTitle: '删除对话',
      deleteDesc: '确定要删除这个对话吗？此操作无法撤销。',
      cancel: '取消',
      ok: '确定',
      delete: '删除',
      settings: '设置',
      renameProject: '修改项目名称',
      projectName: '项目名称',
      pin: '置顶',
      unpin: '取消置顶',
      createChat: '新建对话',
      update: '更新',
      skills: '技能'
    },
    appInit: {
      loadingTitle: '正在加载设置…',
      failedTitle: '加载设置失败',
      subtitle: '正在连接本地后端',
      retry: '重试'
    },
    settings: {
      modelConfig: {
        title: '配置模型：{model}',
        contextWindow: '上下文窗口',
        contextWindowPlaceholder: '例如 128000',
        maxOutputTokens: '最大输出 Token',
        maxOutputTokensPlaceholder: '例如 4096',
        additionalConfig: '附加配置（JSON）',
        saveChanges: '保存更改'
      },
      customProvider: {
        title: '添加自定义 Provider',
        providerType: 'Provider 类型',
        apiProvider: 'API Provider',
        acpProvider: 'ACP Provider',
        providerName: 'Provider 名称',
        providerNamePlaceholder: '我的自定义 Provider',
        baseUrl: 'Base URL',
        apiKey: 'API Key',
        apiFormat: 'API 格式',
        apiFormatHint: '选择该 Provider 使用的 API 端点格式',
        useMaxCompletionTokens: '使用 max_completion_tokens',
        useMaxCompletionTokensHint: '新版本 OpenAI 模型（o1、o3 等）需使用 max_completion_tokens 替代 max_tokens',
        command: '命令',
        args: '参数',
        kind: '类型',
        framing: '分帧',
        approvalMode: '审批模式',
        defaultModel: '默认模型',
        env: '环境变量（KEY=VALUE）',
        cancel: '取消',
        addProvider: '添加 Provider'
      }
    }
  },
  ja: {
    common: {
      close: '閉じる',
      loading: '読み込み中…',
      refresh: '更新',
      settings: '設定',
      auto: '自動',
      builtIn: '内蔵'
    },
    app: {
      showSidebar: 'サイドバーを表示',
      newChat: '新規チャット',
      files: 'ファイル',
      commit: 'コミット',
      terminal: 'ターミナル',
      preview: 'プレビュー',
      configureModelFirst: 'モデルを設定してください',
      summaryTitle: '会話の要約',
      summaryLoading: '読み込み中…',
      summaryEmpty: '要約はまだありません。',
      artifacts: '成果物',
      newContentBelow: '下部に新しい内容があります',
      dropImageHint: '離すと画像添付を追加します',
      updatedAt: '更新時刻: {time}',
      messageCount: '{count} 件のメッセージ',
      noGitRepo: 'Git リポジトリなし',
      currentProjectNotGitRepo: '現在のプロジェクトは Git リポジトリではありません',
      branches: 'ブランチ',
      spellSuggestions: 'スペル候補: {word}',
      voiceInput: '音声入力',
      stopRecording: '録音を停止',
      contextUsage: 'コンテキスト使用量: {percent}',
      contextUsed: '使用済み: {used}',
      contextLimit: '上限: {limit}'
    },
    update: {
      title: 'ソフトウェア更新',
      found: '新しいバージョンがあります',
      upToDate: '最新バージョンです',
      error: '更新に失敗しました',
      cancel: 'キャンセル',
      later: 'あとで',
      downloadNow: '今すぐダウンロード',
      downloading: 'ダウンロード中…',
      downloaded: 'ダウンロード完了。インストール準備完了。',
      restartNow: '今すぐ再起動',
      releaseNotes: '更新内容'
    },
    todo: {
      progress: 'タスク進捗'
    },
    rightSidebar: {
      files: 'ファイル',
      commit: 'コミット',
      terminal: 'ターミナル',
      preview: 'プレビュー',
      loading: '読み込み中…'
    },
    browserPreview: {
      go: '移動',
      back: '戻る',
      forward: '進む',
      refresh: '更新',
      zoomOut: '縮小',
      zoomIn: '拡大',
      urlPlaceholder: 'URL を入力するか、プレビューサーバーを起動してください...',
      openInBrowser: 'ブラウザで開く',
      openDevtools: 'DevTools を開く',
      autoFitReset: '自動フィット（クリックでリセット）',
      clickAutoFit: 'クリックで自動フィット',
      ready: 'ブラウズの準備完了',
      startPreview: 'プレビュー開始'
    },
    terminal: {
      create: 'ターミナルを作成',
      noActive: 'アクティブなターミナルはありません',
      tabTitle: 'ターミナル {index}'
    },
    git: {
      noRepoOpened: 'リポジトリが開かれていません。',
      openRepo: 'リポジトリを開く',
      noGitRepo: 'Git リポジトリではありません',
      notGitFolder: '現在のフォルダーは Git リポジトリではありません。',
      initRepo: 'リポジトリを初期化',
      openDifferentFolder: '別のフォルダーを開く',
      branchPlaceholder: 'ブランチ',
      commitPlaceholder: 'コミットメッセージ...',
      commit: 'コミット',
      changes: '変更 ({count})',
      noChanges: '変更はありません',
      stashes: 'スタッシュ',
      noStashes: 'スタッシュはありません',
      head: 'HEAD',
      noCommits: 'コミットはまだありません'
    },
    fileExplorer: {
      copyPartialFailed: '一部ファイルのコピーに失敗しました: {items}',
      copyFailed: 'ドラッグコピーに失敗しました: {error}',
      writePartialFailed: '一部ファイルの書き込みに失敗しました: {items}',
      writeFailed: 'ドラッグ書き込みに失敗しました: {error}',
      movePartialFailed: '一部項目の移動に失敗しました: {items}',
      moveFailed: 'ドラッグ移動に失敗しました: {error}',
      noFolderOpened: 'フォルダーが開かれていません。',
      openFolder: 'フォルダーを開く',
      expand: '展開',
      collapse: '折りたたむ',
      refresh: '更新',
      openInFinder: 'Finder で開く',
      explorer: 'エクスプローラー',
      moveExplorerLeft: 'エクスプローラーを左へ移動',
      moveExplorerRight: 'エクスプローラーを右へ移動',
      selectFileToPreview: 'プレビューするファイルを選択',
      externalDropEmpty: '外部ドラッグを検出しましたが、ファイル一覧を取得できませんでした。フォルダー行にドロップしてください。',
      previewPaused: 'プレビュー停止中',
      loading: '読み込み中...',
      errorLoadingFile: 'ファイル読み込みエラー',
      previewNotAvailable: 'プレビュー不可',
      previewNotAvailableHint: 'このファイル形式は直接プレビューできません。'
    },
    codeBlock: {
      showCode: 'コードを表示',
      preview: 'プレビュー',
      runCode: 'コードを実行',
      copyCode: 'コードをコピー',
      previewTitle: '{lang} プレビュー'
    },
    artifacts: {
      preview: 'プレビュー'
    },
    chatHistory: {
      newChat: '新規チャット',
      newProject: '新規プロジェクト',
      addProject: 'プロジェクト追加',
      emptyProjects: 'プロジェクト未作成',
      emptyProjectsHint: 'フォルダーを選択してプロジェクトを追加します。',
      emptyChats: '空',
      projectSection: 'プロジェクト',
      chatSection: 'チャット',
      untitled: '新規チャット',
      search: '検索',
      collapseSidebar: 'サイドバーを閉じる',
      searchChats: 'チャットを検索',
      addProjectTip: 'プロジェクト追加',
      createChatTip: '新規チャット',
      projectMenuTip: 'その他',
      deleteChatTip: 'チャットを削除',
      deleteProject: 'プロジェクトを削除',
      deleteProjectTitle: 'プロジェクトを削除',
      deleteProjectDesc: 'このプロジェクトと全てのチャットを削除しますか？この操作は取り消せません。',
      deleteTitle: 'チャットを削除',
      deleteDesc: 'このチャットを削除してもよろしいですか？この操作は取り消せません。',
      cancel: 'キャンセル',
      ok: 'OK',
      delete: '削除',
      settings: '設定',
      renameProject: '名前を変更',
      projectName: 'プロジェクト名',
      pin: '固定',
      unpin: '固定解除',
      createChat: '新規チャット',
      update: '更新',
      skills: 'スキル'
    },
    appInit: {
      loadingTitle: '設定を読み込み中…',
      failedTitle: '設定の読み込みに失敗しました',
      subtitle: 'ローカルバックエンドに接続中',
      retry: '再試行'
    },
    settings: {
      modelConfig: {
        title: 'モデル設定: {model}',
        contextWindow: 'コンテキストウィンドウ',
        contextWindowPlaceholder: '例: 128000',
        maxOutputTokens: '最大出力トークン',
        maxOutputTokensPlaceholder: '例: 4096',
        additionalConfig: '追加設定（JSON）',
        saveChanges: '保存'
      },
      customProvider: {
        title: 'カスタム Provider を追加',
        providerType: 'Provider タイプ',
        apiProvider: 'API Provider',
        acpProvider: 'ACP Provider',
        providerName: 'Provider 名',
        providerNamePlaceholder: 'カスタム Provider',
        baseUrl: 'Base URL',
        apiKey: 'API Key',
        apiFormat: 'API 形式',
        apiFormatHint: 'この Provider が使う API エンドポイント形式を選択します',
        useMaxCompletionTokens: 'max_completion_tokens を使用',
        useMaxCompletionTokensHint: '新しい OpenAI モデル（o1、o3 など）では max_tokens ではなく max_completion_tokens が必要です',
        command: 'コマンド',
        args: '引数',
        kind: '種別',
        framing: 'フレーミング',
        approvalMode: '承認モード',
        defaultModel: 'デフォルトモデル',
        env: '環境変数（KEY=VALUE）',
        cancel: 'キャンセル',
        addProvider: 'Provider を追加'
      }
    }
  }
}

export function resolveAppLang(raw: unknown): AppLang {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'zh' || v.startsWith('zh-')) return 'zh'
  if (v === 'ja' || v.startsWith('ja-')) return 'ja'
  if (v === 'en' || v.startsWith('en-')) return 'en'
  if (v === 'auto') {
    const nav = (() => {
      try {
        return String(navigator.language || '').toLowerCase()
      } catch {
        return ''
      }
    })()
    if (nav.startsWith('zh')) return 'zh'
    if (nav.startsWith('ja')) return 'ja'
    return 'en'
  }
  return 'en'
}

function getByPath(obj: Record<string, DictNode>, path: string): string | null {
  const parts = String(path || '').split('.').filter(Boolean)
  let cur: DictNode | undefined = obj
  for (const p of parts) {
    if (!cur || typeof cur === 'string') return null
    cur = cur[p]
  }
  return typeof cur === 'string' ? cur : null
}

export function i18nText(lang: AppLang, key: string, vars?: Record<string, string | number>): string {
  const base = DICT[lang] || DICT.en
  const fallback = DICT.en
  const tpl = getByPath(base, key) ?? getByPath(fallback, key) ?? key
  if (!vars) return tpl
  return tpl.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}
