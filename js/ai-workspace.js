// ai-workspace.js — 知屿 (弯弯机 AI 工作空间) 第二阶段：基础 UI 与交互控制器
// 说明：本阶段仅实现极简聊天主页、左侧滑出侧边栏与底部附件菜单基础 UI，不接入 AI 模型或后端存储。
(function(global) {
  'use strict';

  var PAGE_ID = 'ai-workspace-page';

  // 最小化图标 SVG（极简黑灰线性风格）
  var SVG_MENU_LINES =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="4" y1="8.5" x2="20" y2="8.5"></line>' +
      '<line x1="4" y1="15.5" x2="14.5" y2="15.5"></line>' +
    '</svg>';

  var SVG_VOICE_WAVES =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="5" y1="10" x2="5" y2="14"></line>' +
      '<line x1="9.5" y1="6.5" x2="9.5" y2="17.5"></line>' +
      '<line x1="14.5" y1="8.5" x2="14.5" y2="15.5"></line>' +
      '<line x1="19" y1="10.5" x2="19" y2="13.5"></line>' +
    '</svg>';

  var SVG_ZHIYU_MARK =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 2.5C12.7 7.6 16.4 11.3 21.5 12C16.4 12.7 12.7 16.4 12 21.5C11.3 16.4 7.6 12.7 2.5 12C7.6 11.3 11.3 7.6 12 2.5Z"></path>' +
    '</svg>';

  // 侧边栏占位对话条目（仅作基础 UI 列表展示）
  var SAMPLE_CHATS = [
    { id: 'pin-1', title: '日常灵感与待办整理（示例）', pinned: true },
    { id: 'pin-2', title: '阅读笔记与摘要助手（示例）', pinned: true },
    { id: 'rec-1', title: '周末旅行行程规划（示例）', pinned: false },
    { id: 'rec-2', title: '长文润色与结构梳理（示例）', pinned: false },
    { id: 'rec-3', title: '英语口语日常练习（示例）', pinned: false },
    { id: 'rec-4', title: '工作周报模板草稿（示例）', pinned: false }
  ];

  var _state = {
    sidebarOpen: false,
    attachOpen: false,
    moreNavOpen: false,
    deepThinkEnabled: false,
    searchQuery: '',
    activeChatId: null,
    messages: [],
    userProfile: {
      name: '我',
      avatar: 'img/ava-00.jpg',
      bio: '本地工作空间'
    },
    appearance: {
      mode: 'system',
      accent: 'pink'
    },
    general: {
      enterToSend: true,
      autoUseDefaultPreset: true,
      showCharCount: true
    },
    defaultPreset: null
  };

  var _mediaQuery = null;
  var _mediaListener = null;

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function notifyToast(msg) {
    if (typeof global.toast === 'function') {
      global.toast(msg);
    } else if (typeof global.showToast === 'function') {
      global.showToast(msg);
    }
  }

  function resolveEffectiveDarkMode(mode) {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    var mediaDark = !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
    var rootDark = !!(document.documentElement && document.documentElement.classList.contains('theme-dark'));
    return mediaDark || rootDark;
  }

  function applyWorkspaceAppearance(page, appearance) {
    if (!page) return;
    var cfg = appearance || _state.appearance || { mode: 'system', accent: 'pink' };
    var isDark = resolveEffectiveDarkMode(cfg.mode || 'system');
    page.classList.toggle('aiw-theme-dark', isDark);
    page.classList.toggle('aiw-theme-light', !isDark);
    page.setAttribute('data-aiw-mode', cfg.mode || 'system');
    page.setAttribute('data-aiw-accent', cfg.accent || 'pink');
  }

  function detachAppearanceMediaListener() {
    if (_mediaQuery && _mediaListener) {
      try {
        if (_mediaQuery.removeEventListener) _mediaQuery.removeEventListener('change', _mediaListener);
        else if (_mediaQuery.removeListener) _mediaQuery.removeListener(_mediaListener);
      } catch (_) {}
    }
    _mediaQuery = null;
    _mediaListener = null;
  }

  function attachAppearanceMediaListener(page) {
    detachAppearanceMediaListener();
    if (!global.matchMedia) return;
    _mediaQuery = global.matchMedia('(prefers-color-scheme: dark)');
    _mediaListener = function() {
      var curPage = document.getElementById(PAGE_ID);
      if (curPage && _state.appearance && _state.appearance.mode === 'system') {
        applyWorkspaceAppearance(curPage, _state.appearance);
      }
    };
    if (_mediaQuery.addEventListener) _mediaQuery.addEventListener('change', _mediaListener);
    else if (_mediaQuery.addListener) _mediaQuery.addListener(_mediaListener);
  }

  async function loadWorkspaceState() {
    if (global.AiWorkspaceStorage) {
      try {
        var results = await Promise.all([
          global.AiWorkspaceStorage.getProfile(),
          global.AiWorkspaceStorage.getAppearance(),
          global.AiWorkspaceStorage.getGeneralSettings(),
          global.AiWorkspaceStorage.getDefaultPreset()
        ]);
        _state.userProfile = results[0];
        _state.appearance = results[1];
        _state.general = results[2];
        _state.defaultPreset = results[3];
        return;
      } catch (_) {}
    }
    try {
      if (!global.db || !global.db.characters) return;
      var op = function() {
        return global.db.characters.where('type').equals('user').first();
      };
      var user = typeof global.runWanWanDBRead === 'function'
        ? await global.runWanWanDBRead(op)
        : await op();
      if (user) {
        _state.userProfile = {
          name: String(user.name || user.nick || '我'),
          avatar: String(user.avatar || 'img/ava-00.jpg'),
          bio: '本地工作空间'
        };
      }
    } catch (_) {}
  }

  function syncSidebarAccountDom(page) {
    if (!page) return;
    var avatarEl = page.querySelector('#aiw-account-avatar');
    var nameEl = page.querySelector('#aiw-account-name');
    var subEl = page.querySelector('#aiw-account-sub');
    if (avatarEl) avatarEl.src = _state.userProfile.avatar || 'img/ava-00.jpg';
    if (nameEl) nameEl.textContent = _state.userProfile.name || '我';
    if (subEl) subEl.textContent = (_state.userProfile.bio || '本地工作空间') + ' · 设置中心';
  }

  function buildPageHtml() {
    return (
      '<div class="aiw-topbar">' +
        '<div class="aiw-topbar-left">' +
          '<button type="button" class="aiw-circle-btn" id="aiw-sidebar-btn" title="打开侧边栏" aria-label="打开侧边栏">' +
            SVG_MENU_LINES +
          '</button>' +
        '</div>' +
        '<div class="aiw-topbar-center">' +
          '<span class="aiw-brand-pill" id="aiw-topbar-title">知屿</span>' +
        '</div>' +
        '<div class="aiw-topbar-right">' +
          '<button type="button" class="aiw-circle-btn" id="aiw-new-chat-btn" title="新对话" aria-label="新对话">' +
            '<i class="fa-regular fa-pen-to-square"></i>' +
          '</button>' +
          '<button type="button" class="aiw-circle-btn" id="aiw-close-btn" title="返回桌面" aria-label="返回桌面">' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +
      '</div>' +

      '<div class="aiw-main" id="aiw-main-scroll">' +
        '<div class="aiw-empty-stage" id="aiw-empty-stage">' +
          '<div class="aiw-empty-mark">' + SVG_ZHIYU_MARK + '</div>' +
          '<div class="aiw-empty-title" id="aiw-empty-title">有什么可以帮你的？</div>' +
          '<div class="aiw-empty-sub" id="aiw-empty-sub">知屿 AI 工作空间基础界面已就绪</div>' +
        '</div>' +
        '<div class="aiw-message-list" id="aiw-message-list" hidden></div>' +
      '</div>' +

      '<div class="aiw-composer-wrap">' +
        '<div class="aiw-mode-chip-bar" id="aiw-mode-chip-bar" hidden>' +
          '<button type="button" class="aiw-mode-chip" id="aiw-chip-deep-think" title="点击取消深入思考">' +
            '<i class="fa-regular fa-lightbulb"></i>' +
            '<span>深入思考</span>' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +
        '<div class="aiw-composer">' +
          '<button type="button" class="aiw-attach-btn" id="aiw-attach-btn" title="添加附件或能力" aria-label="打开附件菜单">' +
            '<i class="fa-solid fa-plus"></i>' +
          '</button>' +
          '<textarea class="aiw-input" id="aiw-input" rows="1" placeholder="问点什么..." aria-label="输入消息"></textarea>' +
          '<div class="aiw-composer-actions">' +
            '<button type="button" class="aiw-mic-btn" id="aiw-mic-btn" title="语音输入" aria-label="语音输入">' +
              '<i class="fa-solid fa-microphone"></i>' +
            '</button>' +
            '<button type="button" class="aiw-send-btn" id="aiw-send-btn" title="发送" aria-label="发送" hidden>' +
              '<i class="fa-solid fa-arrow-up"></i>' +
            '</button>' +
            '<button type="button" class="aiw-voice-btn" id="aiw-voice-btn" title="语音通话" aria-label="语音对话">' +
              SVG_VOICE_WAVES +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="aiw-sidebar-backdrop" id="aiw-sidebar-backdrop"></div>' +
      '<aside class="aiw-sidebar" id="aiw-sidebar" aria-label="工作空间侧边栏">' +
        '<div class="aiw-sidebar-head">' +
          '<div class="aiw-search-box">' +
            '<i class="fa-solid fa-magnifying-glass"></i>' +
            '<input type="search" class="aiw-search-input" id="aiw-search-input" placeholder="搜索聊天" aria-label="搜索聊天">' +
          '</div>' +
          '<button type="button" class="aiw-sidebar-close-btn" id="aiw-sidebar-close" title="关闭侧边栏" aria-label="关闭侧边栏">' +
            '<i class="fa-solid fa-xmark"></i>' +
          '</button>' +
        '</div>' +

        '<div class="aiw-sidebar-scroll" id="aiw-sidebar-scroll">' +
          '<div class="aiw-nav-group">' +
            '<button type="button" class="aiw-nav-item" data-nav="image">' +
              '<span class="aiw-nav-item-icon"><i class="fa-regular fa-image"></i></span>' +
              '<span class="aiw-nav-item-label">图像</span>' +
            '</button>' +
            '<button type="button" class="aiw-nav-item" data-nav="library">' +
              '<span class="aiw-nav-item-icon"><i class="fa-regular fa-folder-open"></i></span>' +
              '<span class="aiw-nav-item-label">资料库</span>' +
            '</button>' +
            '<button type="button" class="aiw-nav-item" data-nav="projects">' +
              '<span class="aiw-nav-item-icon"><i class="fa-regular fa-folder"></i></span>' +
              '<span class="aiw-nav-item-label">项目</span>' +
            '</button>' +
            '<button type="button" class="aiw-nav-item" data-nav="remote">' +
              '<span class="aiw-nav-item-icon"><i class="fa-solid fa-globe"></i></span>' +
              '<span class="aiw-nav-item-label">Remote</span>' +
            '</button>' +
            '<button type="button" class="aiw-nav-item" data-nav="tasks">' +
              '<span class="aiw-nav-item-icon"><i class="fa-regular fa-clock"></i></span>' +
              '<span class="aiw-nav-item-label">定时任务</span>' +
            '</button>' +
            '<button type="button" class="aiw-nav-item" id="aiw-nav-more-btn">' +
              '<span class="aiw-nav-item-icon"><i class="fa-solid fa-ellipsis"></i></span>' +
              '<span class="aiw-nav-item-label">查看更多</span>' +
              '<span class="aiw-nav-item-tag" id="aiw-nav-more-chevron"><i class="fa-solid fa-angle-down"></i></span>' +
            '</button>' +
            '<div class="aiw-more-panel" id="aiw-more-panel" hidden>' +
              '<button type="button" class="aiw-nav-item" data-nav="plugins">' +
                '<span class="aiw-nav-item-icon"><i class="fa-solid fa-puzzle-piece"></i></span>' +
                '<span class="aiw-nav-item-label">插件扩展</span>' +
                '<span class="aiw-nav-item-tag">待接入</span>' +
              '</button>' +
              '<button type="button" class="aiw-nav-item" data-nav="memory">' +
                '<span class="aiw-nav-item-icon"><i class="fa-regular fa-bookmark"></i></span>' +
                '<span class="aiw-nav-item-label">记忆空间</span>' +
                '<span class="aiw-nav-item-tag">待接入</span>' +
              '</button>' +
            '</div>' +
          '</div>' +

          '<div class="aiw-chat-section" id="aiw-pinned-section">' +
            '<div class="aiw-chat-section-title">置顶聊天</div>' +
            '<div class="aiw-chat-list" id="aiw-pinned-list"></div>' +
          '</div>' +

          '<div class="aiw-chat-section" id="aiw-recent-section">' +
            '<div class="aiw-chat-section-title">最近聊天</div>' +
            '<div class="aiw-chat-list" id="aiw-recent-list"></div>' +
          '</div>' +
        '</div>' +

        '<div class="aiw-sidebar-foot">' +
          '<button type="button" class="aiw-account-btn" id="aiw-account-btn">' +
            '<img class="aiw-account-avatar" id="aiw-account-avatar" src="' + escapeHtml(_state.userProfile.avatar) + '" alt="用户头像">' +
            '<div class="aiw-account-info">' +
              '<div class="aiw-account-name" id="aiw-account-name">' + escapeHtml(_state.userProfile.name) + '</div>' +
              '<div class="aiw-account-sub" id="aiw-account-sub">' + escapeHtml((_state.userProfile.bio || '本地工作空间') + ' · 设置中心') + '</div>' +
            '</div>' +
            '<span class="aiw-account-chevron"><i class="fa-solid fa-gear"></i></span>' +
          '</button>' +
        '</div>' +
      '</aside>' +

      '<div class="aiw-attach-backdrop" id="aiw-attach-backdrop"></div>' +
      '<div class="aiw-attach-sheet" id="aiw-attach-sheet" role="dialog" aria-modal="true" aria-label="附件与工具菜单">' +
        '<div class="aiw-sheet-handle"></div>' +
        '<div class="aiw-attach-grid">' +
          '<button type="button" class="aiw-attach-tile" data-attach="camera">' +
            '<i class="fa-solid fa-camera"></i>' +
            '<span>拍照</span>' +
          '</button>' +
          '<button type="button" class="aiw-attach-tile" data-attach="photos">' +
            '<i class="fa-regular fa-image"></i>' +
            '<span>照片</span>' +
          '</button>' +
          '<button type="button" class="aiw-attach-tile" data-attach="files">' +
            '<i class="fa-regular fa-file-lines"></i>' +
            '<span>文件</span>' +
          '</button>' +
        '</div>' +
        '<div class="aiw-attach-rows">' +
          '<button type="button" class="aiw-attach-row" data-attach="plugins">' +
            '<span class="aiw-attach-row-icon"><i class="fa-solid fa-puzzle-piece"></i></span>' +
            '<div class="aiw-attach-row-body">' +
              '<div class="aiw-attach-row-title">插件</div>' +
              '<div class="aiw-attach-row-desc">扩展工具与外部连接能力</div>' +
            '</div>' +
            '<span class="aiw-attach-row-state">未接入</span>' +
          '</button>' +
          '<button type="button" class="aiw-attach-row" id="aiw-attach-deep-think" data-attach="deepThink">' +
            '<span class="aiw-attach-row-icon"><i class="fa-regular fa-lightbulb"></i></span>' +
            '<div class="aiw-attach-row-body">' +
              '<div class="aiw-attach-row-title">深入思考</div>' +
              '<div class="aiw-attach-row-desc">切换推理模式 UI 状态（模型暂未接入）</div>' +
            '</div>' +
            '<span class="aiw-attach-row-state" id="aiw-deep-think-state">关闭</span>' +
          '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderSidebarChats(page) {
    if (!page) return;
    var q = String(_state.searchQuery || '').trim().toLowerCase();
    var filtered = SAMPLE_CHATS.filter(function(item) {
      if (!q) return true;
      return item.title.toLowerCase().indexOf(q) !== -1;
    });

    var pinned = filtered.filter(function(item) { return item.pinned; });
    var recent = filtered.filter(function(item) { return !item.pinned; });

    var pinnedList = page.querySelector('#aiw-pinned-list');
    var recentList = page.querySelector('#aiw-recent-list');
    var pinnedSec = page.querySelector('#aiw-pinned-section');
    var recentSec = page.querySelector('#aiw-recent-section');

    function renderItems(list) {
      return list.map(function(item) {
        var activeCls = _state.activeChatId === item.id ? ' active' : '';
        return (
          '<button type="button" class="aiw-chat-item' + activeCls + '" data-chat-id="' + escapeHtml(item.id) + '">' +
            '<span class="aiw-chat-item-title">' + escapeHtml(item.title) + '</span>' +
            (item.pinned ? '<span class="aiw-chat-item-pin" title="已置顶"><i class="fa-solid fa-thumbtack"></i></span>' : '') +
          '</button>'
        );
      }).join('');
    }

    if (pinnedList) {
      pinnedList.innerHTML = pinned.length ? renderItems(pinned) : '';
    }
    if (pinnedSec) {
      pinnedSec.hidden = pinned.length === 0;
    }

    if (recentList) {
      if (recent.length) {
        recentList.innerHTML = renderItems(recent);
      } else if (!pinned.length) {
        recentList.innerHTML = '<div class="aiw-chat-empty">没有匹配的聊天记录</div>';
      } else {
        recentList.innerHTML = '';
      }
    }
    if (recentSec) {
      recentSec.hidden = recent.length === 0 && pinned.length > 0;
    }

    page.querySelectorAll('.aiw-chat-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var chatId = btn.getAttribute('data-chat-id');
        var found = SAMPLE_CHATS.find(function(c) { return c.id === chatId; });
        _state.activeChatId = chatId;
        _state.messages = [];
        setSidebarOpen(page, false);
        updateMainStage(page, found ? found.title : null);
        renderSidebarChats(page);
      });
    });
  }

  function updateMainStage(page, selectedSampleTitle) {
    if (!page) return;
    var emptyStage = page.querySelector('#aiw-empty-stage');
    var msgList = page.querySelector('#aiw-message-list');
    var emptyTitle = page.querySelector('#aiw-empty-title');
    var emptySub = page.querySelector('#aiw-empty-sub');
    var topbarTitle = page.querySelector('#aiw-topbar-title');

    if (topbarTitle) {
      topbarTitle.textContent = selectedSampleTitle ? selectedSampleTitle.replace(/（示例）$/, '') : '知屿';
    }

    if (_state.messages.length === 0) {
      if (emptyStage) emptyStage.hidden = false;
      if (msgList) {
        msgList.hidden = true;
        msgList.innerHTML = '';
      }
      if (emptyTitle) {
        emptyTitle.textContent = selectedSampleTitle
          ? selectedSampleTitle.replace(/（示例）$/, '')
          : '有什么可以帮你的？';
      }
      if (emptySub) {
        if (selectedSampleTitle) {
          emptySub.textContent = '此条目为侧边栏占位示例，历史对话与 AI 模型将在后续阶段接入。';
        } else if (_state.general && _state.general.autoUseDefaultPreset && _state.defaultPreset) {
          emptySub.textContent = '默认预设：' + _state.defaultPreset.name + '（模型对话将在第四阶段接入）';
        } else {
          emptySub.textContent = '知屿 AI 工作空间已就绪';
        }
      }
      return;
    }

    if (emptyStage) emptyStage.hidden = true;
    if (msgList) {
      msgList.hidden = false;
      msgList.innerHTML = _state.messages.map(function(m) {
        var badge = m.deepThink
          ? '<div class="aiw-msg-badge"><i class="fa-regular fa-lightbulb"></i><span>深入思考 UI</span></div>'
          : '';
        return (
          '<div class="aiw-msg-row ' + (m.role === 'user' ? 'is-user' : 'is-assistant') + '">' +
            badge +
            '<div class="aiw-msg-bubble">' + escapeHtml(m.content) + '</div>' +
          '</div>'
        );
      }).join('');
    }
    var scrollEl = page.querySelector('#aiw-main-scroll');
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }

  function setSidebarOpen(page, open) {
    if (!page) return;
    _state.sidebarOpen = !!open;
    var backdrop = page.querySelector('#aiw-sidebar-backdrop');
    var sidebar = page.querySelector('#aiw-sidebar');
    if (backdrop) backdrop.classList.toggle('open', _state.sidebarOpen);
    if (sidebar) sidebar.classList.toggle('open', _state.sidebarOpen);
    if (_state.sidebarOpen && _state.attachOpen) {
      setAttachOpen(page, false);
    }
  }

  function setAttachOpen(page, open) {
    if (!page) return;
    _state.attachOpen = !!open;
    var backdrop = page.querySelector('#aiw-attach-backdrop');
    var sheet = page.querySelector('#aiw-attach-sheet');
    if (backdrop) backdrop.classList.toggle('open', _state.attachOpen);
    if (sheet) sheet.classList.toggle('open', _state.attachOpen);
    if (_state.attachOpen && _state.sidebarOpen) {
      setSidebarOpen(page, false);
    }
  }

  function syncDeepThinkUI(page) {
    if (!page) return;
    var chipBar = page.querySelector('#aiw-mode-chip-bar');
    var row = page.querySelector('#aiw-attach-deep-think');
    var stateEl = page.querySelector('#aiw-deep-think-state');
    if (chipBar) chipBar.hidden = !_state.deepThinkEnabled;
    if (row) row.classList.toggle('is-active', _state.deepThinkEnabled);
    if (stateEl) stateEl.textContent = _state.deepThinkEnabled ? '已开启' : '关闭';
  }

  function syncComposerButtons(page) {
    if (!page) return;
    var input = page.querySelector('#aiw-input');
    var sendBtn = page.querySelector('#aiw-send-btn');
    var voiceBtn = page.querySelector('#aiw-voice-btn');
    if (!input) return;

    input.style.height = 'auto';
    input.style.height = Math.min(116, Math.max(24, input.scrollHeight)) + 'px';

    var hasText = input.value.trim().length > 0;
    if (sendBtn) sendBtn.hidden = !hasText;
    if (voiceBtn) voiceBtn.hidden = hasText;
  }

  function handleLocalPreviewSend(page) {
    var input = page.querySelector('#aiw-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    _state.messages.push({
      role: 'user',
      content: text,
      deepThink: _state.deepThinkEnabled
    });
    _state.messages.push({
      role: 'assistant',
      content: '【基础 UI 预览】已收到输入。当前阶段尚未接入 AI 模型与后端存储，请等待后续阶段开放真实对话能力。'
    });

    input.value = '';
    syncComposerButtons(page);
    updateMainStage(page, null);
  }

  function bindEvents(page) {
    // 顶部栏按钮
    page.querySelector('#aiw-sidebar-btn').addEventListener('click', function() {
      setSidebarOpen(page, true);
    });

    page.querySelector('#aiw-new-chat-btn').addEventListener('click', function() {
      _state.activeChatId = null;
      _state.messages = [];
      updateMainStage(page, null);
      renderSidebarChats(page);
      notifyToast('已开启新对话');
    });

    page.querySelector('#aiw-close-btn').addEventListener('click', function() {
      closeAiWorkspacePage();
    });

    // 侧边栏开关与搜索
    page.querySelector('#aiw-sidebar-backdrop').addEventListener('click', function() {
      setSidebarOpen(page, false);
    });

    page.querySelector('#aiw-sidebar-close').addEventListener('click', function() {
      setSidebarOpen(page, false);
    });

    var searchInput = page.querySelector('#aiw-search-input');
    searchInput.addEventListener('input', function() {
      _state.searchQuery = searchInput.value || '';
      renderSidebarChats(page);
    });

    // 侧边栏导航项（诚实占位提示）
    var NAV_LABELS = {
      image: '图像',
      library: '资料库',
      projects: '项目',
      remote: 'Remote',
      tasks: '定时任务',
      plugins: '插件扩展',
      memory: '记忆空间'
    };

    page.querySelectorAll('.aiw-nav-item[data-nav]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.getAttribute('data-nav');
        var label = NAV_LABELS[key] || '该功能';
        notifyToast('「' + label + '」将在后续阶段接入');
      });
    });

    page.querySelector('#aiw-nav-more-btn').addEventListener('click', function() {
      _state.moreNavOpen = !_state.moreNavOpen;
      var morePanel = page.querySelector('#aiw-more-panel');
      var chev = page.querySelector('#aiw-nav-more-chevron i');
      if (morePanel) morePanel.hidden = !_state.moreNavOpen;
      if (chev) {
        chev.className = _state.moreNavOpen ? 'fa-solid fa-angle-up' : 'fa-solid fa-angle-down';
      }
    });

    page.querySelector('#aiw-account-btn').addEventListener('click', function() {
      setSidebarOpen(page, false);
      if (global.AiWorkspaceSettings && typeof global.AiWorkspaceSettings.openSettingsCenter === 'function') {
        global.AiWorkspaceSettings.openSettingsCenter(page, 'home', function(nextState) {
          if (nextState) {
            if (nextState.profile) _state.userProfile = nextState.profile;
            if (nextState.appearance) _state.appearance = nextState.appearance;
            if (nextState.general) _state.general = nextState.general;
            if (Array.isArray(nextState.presets)) {
              _state.defaultPreset = nextState.presets.find(function(p) { return p.isDefault; }) || nextState.presets[0] || null;
            }
          }
          applyWorkspaceAppearance(page, _state.appearance);
          syncSidebarAccountDom(page);
          if (_state.messages.length === 0 && !_state.activeChatId) {
            updateMainStage(page, null);
          }
        });
      } else {
        notifyToast('设置中心模块加载中');
      }
    });

    // 底部输入框与附件菜单
    var input = page.querySelector('#aiw-input');
    input.addEventListener('input', function() {
      syncComposerButtons(page);
    });
    input.addEventListener('keydown', function(e) {
      var enterSend = !_state.general || _state.general.enterToSend !== false;
      if (e.key === 'Enter' && !e.shiftKey && enterSend) {
        e.preventDefault();
        handleLocalPreviewSend(page);
      }
    });

    page.querySelector('#aiw-send-btn').addEventListener('click', function() {
      handleLocalPreviewSend(page);
    });

    page.querySelector('#aiw-mic-btn').addEventListener('click', function() {
      notifyToast('语音输入将在后续阶段接入');
    });

    page.querySelector('#aiw-voice-btn').addEventListener('click', function() {
      notifyToast('实时语音对话将在后续阶段接入');
    });

    page.querySelector('#aiw-attach-btn').addEventListener('click', function() {
      setAttachOpen(page, true);
    });

    page.querySelector('#aiw-attach-backdrop').addEventListener('click', function() {
      setAttachOpen(page, false);
    });

    page.querySelector('#aiw-chip-deep-think').addEventListener('click', function() {
      _state.deepThinkEnabled = false;
      syncDeepThinkUI(page);
    });

    var ATTACH_LABELS = {
      camera: '拍照',
      photos: '照片',
      files: '文件',
      plugins: '插件'
    };

    page.querySelectorAll('[data-attach]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var type = btn.getAttribute('data-attach');
        if (type === 'deepThink') {
          _state.deepThinkEnabled = !_state.deepThinkEnabled;
          syncDeepThinkUI(page);
          setAttachOpen(page, false);
          notifyToast(_state.deepThinkEnabled ? '已切换「深入思考」UI 状态（模型暂未接入）' : '已关闭深入思考');
          return;
        }
        setAttachOpen(page, false);
        notifyToast('「' + (ATTACH_LABELS[type] || '该附件功能') + '」将在后续阶段接入');
      });
    });
  }

  function closeAiWorkspacePage() {
    detachAppearanceMediaListener();
    var page = document.getElementById(PAGE_ID);
    if (!page) return;
    if (typeof global.closePage === 'function') {
      global.closePage(PAGE_ID);
    } else {
      page.remove();
    }
  }

  async function showAiWorkspacePage() {
    var existing = document.getElementById(PAGE_ID);
    if (existing) existing.remove();

    _state.sidebarOpen = false;
    _state.attachOpen = false;
    _state.moreNavOpen = false;
    _state.searchQuery = '';

    await loadWorkspaceState();

    var page = document.createElement('div');
    page.id = PAGE_ID;
    page.className = 'full-page';
    applyWorkspaceAppearance(page, _state.appearance);
    page.innerHTML = buildPageHtml();

    if (typeof global.openPage === 'function') {
      global.openPage(page);
    } else {
      (document.getElementById('app') || document.body).appendChild(page);
    }

    attachAppearanceMediaListener(page);
    renderSidebarChats(page);
    syncDeepThinkUI(page);
    syncComposerButtons(page);
    syncSidebarAccountDom(page);
    updateMainStage(page, null);
    bindEvents(page);
  }

  global.showAiWorkspacePage = showAiWorkspacePage;
  global.showZhiyuPage = showAiWorkspacePage;
})(window);
