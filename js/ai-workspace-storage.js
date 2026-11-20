// ai-workspace-storage.js — 知屿（AI 工作空间）第三阶段：配置与预设持久化存储层
// 严格复用现有 WanWanDB 的 db.config 键值表（不修改 db.js 数据库版本，不影响现有业务表），并辅以 localStorage 兜底镜像。
(function(global) {
  'use strict';

  var CACHE_STORAGE_KEY = 'wanwan_aiw_storage_cache_v1';

  var KEYS = {
    PROFILE: 'aiw_profile',
    PERSONALIZATION: 'aiw_personalization',
    APPEARANCE: 'aiw_appearance',
    GENERAL: 'aiw_general',
    PRESET_IDS: 'aiw_preset_ids',
    PRESET_PREFIX: 'aiw_preset:',
    PRESETS_INIT: 'aiw_presets_initialized',
    DEFAULT_PRESET_ID: 'aiw_default_preset_id'
  };

  var ACCENT_PRESETS = [
    { id: 'pink', label: '粉色', color: '#ec4899' },
    { id: 'coral', label: '珊瑚红', color: '#e11d48' },
    { id: 'blue', label: '晴空蓝', color: '#2563eb' },
    { id: 'green', label: '鼠尾草', color: '#059669' },
    { id: 'amber', label: '琥珀金', color: '#d97706' },
    { id: 'ink', label: '极简黑', color: '#27272a' }
  ];

  var DEFAULT_PERSONALIZATION = {
    enabled: true,
    customInstructions: '',
    tone: '温和自然',
    detailLevel: '适中',
    userPreferences: '',
    updatedAt: 0
  };

  var DEFAULT_APPEARANCE = {
    mode: 'system',
    accent: 'pink',
    updatedAt: 0
  };

  var DEFAULT_GENERAL = {
    enterToSend: true,
    autoUseDefaultPreset: true,
    showCharCount: true,
    updatedAt: 0
  };

  var DEFAULT_STARTER_PRESETS = [
    {
      id: 'preset_zhiyu_general',
      name: '知屿 · 通用助手',
      avatarType: 'icon',
      avatarValue: 'fa-solid fa-wand-magic-sparkles',
      description: '温和可靠的全能伙伴，适合日常问答、梳理想法与轻度创作。',
      systemPrompt: '你是「知屿」，弯弯机工作空间中的个人 AI 助手。请以清晰、真诚、富有条理的方式回应用户的提问；在必要时先给出结论，再补充关键步骤与温和的建议。',
      replyStyle: '温和自然',
      detailLevel: '适中',
      isDefault: true
    },
    {
      id: 'preset_zhiyu_writer',
      name: '文字润色与创作编辑',
      avatarType: 'icon',
      avatarValue: 'fa-solid fa-feather-pointed',
      description: '擅长长文润色、结构重排、情绪表达与多种文风改写。',
      systemPrompt: '你是一位审美细腻、文字功底扎实的中文编辑。请帮助用户打磨文稿结构、提炼核心表达并优化语感；在修改时保留作者原本的情绪与个人风格，避免空洞套话。',
      replyStyle: '细腻陪伴',
      detailLevel: '详尽',
      isDefault: false
    },
    {
      id: 'preset_zhiyu_planner',
      name: '冷静结构化顾问',
      avatarType: 'icon',
      avatarValue: 'fa-solid fa-compass',
      description: '聚焦逻辑拆解、计划制定与高效决策，结论直截了当。',
      systemPrompt: '你是一位严谨冷静的结构化顾问。面对复杂问题时，请帮助用户拆解目标、识别关键约束与风险，并给出可执行、分优先级的行动清单。',
      replyStyle: '专业严谨',
      detailLevel: '精简',
      isDefault: false
    }
  ];

  function deepClone(obj) {
    if (obj === undefined || obj === null) return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (_) {
      return Object.assign({}, obj);
    }
  }

  function generatePresetId() {
    return 'preset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function readLocalCache() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(CACHE_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeLocalCacheKey(key, value) {
    try {
      if (!global.localStorage) return;
      var cache = readLocalCache();
      if (value === undefined) {
        delete cache[key];
      } else {
        cache[key] = value;
      }
      global.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache));
    } catch (_) {}
  }

  async function waitForConfigDB(timeoutMs) {
    if (global.db && global.db.config) return global.db;
    var maxWait = typeof timeoutMs === 'number' ? timeoutMs : 1200;
    var started = Date.now();
    while (Date.now() - started < maxWait) {
      if (global.db && global.db.config) return global.db;
      await new Promise(function(resolve) { setTimeout(resolve, 40); });
    }
    return (global.db && global.db.config) ? global.db : null;
  }

  async function dbGetConfig(key) {
    var dbRef = await waitForConfigDB(600);
    if (dbRef && dbRef.config) {
      try {
        var op = function() { return dbRef.config.get(key); };
        var row = typeof global.runWanWanDBRead === 'function'
          ? await global.runWanWanDBRead(op)
          : await op();
        if (row && row.value !== undefined) {
          writeLocalCacheKey(key, row.value);
          return deepClone(row.value);
        }
      } catch (err) {
        console.warn('[AiWorkspaceStorage] dbGetConfig fallback to cache:', key, err);
      }
    }
    var cache = readLocalCache();
    return cache[key] !== undefined ? deepClone(cache[key]) : undefined;
  }

  async function dbPutConfig(key, value) {
    var payload = deepClone(value);
    writeLocalCacheKey(key, payload);
    var dbRef = await waitForConfigDB(1200);
    if (dbRef && dbRef.config) {
      var op = function() {
        return dbRef.config.put({ key: key, value: payload });
      };
      if (typeof global.runWanWanDBIdempotentWrite === 'function') {
        await global.runWanWanDBIdempotentWrite(op);
      } else {
        await op();
      }
    }
    return payload;
  }

  async function dbDeleteConfig(key) {
    writeLocalCacheKey(key, undefined);
    var dbRef = await waitForConfigDB(1200);
    if (dbRef && dbRef.config) {
      var op = function() {
        return dbRef.config.delete(key);
      };
      if (typeof global.runWanWanDBIdempotentWrite === 'function') {
        await global.runWanWanDBIdempotentWrite(op);
      } else {
        await op();
      }
    }
  }

  // ===== 1. 个人资料（优先读取 aiw_profile，兜底只读 db.characters 用户记录） =====
  async function getMainUserFallback() {
    var fallback = { name: '我', avatar: 'img/ava-00.jpg', bio: '本地工作空间' };
    try {
      var dbRef = await waitForConfigDB(500);
      if (!dbRef || !dbRef.characters) return fallback;
      var op = function() {
        return dbRef.characters.where('type').equals('user').first();
      };
      var user = typeof global.runWanWanDBRead === 'function'
        ? await global.runWanWanDBRead(op)
        : await op();
      if (user) {
        fallback.name = String(user.name || user.nick || '我');
        fallback.avatar = String(user.avatar || 'img/ava-00.jpg');
      }
    } catch (_) {}
    return fallback;
  }

  async function getProfile() {
    var saved = await dbGetConfig(KEYS.PROFILE);
    var base = await getMainUserFallback();
    if (!saved || typeof saved !== 'object') {
      return Object.assign({}, base, { updatedAt: 0 });
    }
    return {
      name: String(saved.name || base.name || '我').trim() || '我',
      avatar: String(saved.avatar || base.avatar || 'img/ava-00.jpg'),
      bio: saved.bio != null ? String(saved.bio) : base.bio,
      updatedAt: Number(saved.updatedAt) || 0
    };
  }

  async function saveProfile(patch) {
    var current = await getProfile();
    var next = {
      name: String((patch && patch.name != null ? patch.name : current.name) || '我').trim() || '我',
      avatar: String((patch && patch.avatar != null ? patch.avatar : current.avatar) || 'img/ava-00.jpg'),
      bio: patch && patch.bio != null ? String(patch.bio).trim() : (current.bio || ''),
      updatedAt: Date.now()
    };
    return await dbPutConfig(KEYS.PROFILE, next);
  }

  // ===== 2. 个性化设置 =====
  async function getPersonalization() {
    var saved = await dbGetConfig(KEYS.PERSONALIZATION);
    return Object.assign({}, DEFAULT_PERSONALIZATION, saved && typeof saved === 'object' ? saved : {});
  }

  async function savePersonalization(patch) {
    var current = await getPersonalization();
    var next = {
      enabled: patch && typeof patch.enabled === 'boolean' ? patch.enabled : !!current.enabled,
      customInstructions: patch && patch.customInstructions != null ? String(patch.customInstructions) : current.customInstructions,
      tone: patch && patch.tone != null ? String(patch.tone) : current.tone,
      detailLevel: patch && patch.detailLevel != null ? String(patch.detailLevel) : current.detailLevel,
      userPreferences: patch && patch.userPreferences != null ? String(patch.userPreferences) : current.userPreferences,
      updatedAt: Date.now()
    };
    return await dbPutConfig(KEYS.PERSONALIZATION, next);
  }

  // ===== 3. 外观设置 =====
  async function getAppearance() {
    var saved = await dbGetConfig(KEYS.APPEARANCE);
    var merged = Object.assign({}, DEFAULT_APPEARANCE, saved && typeof saved === 'object' ? saved : {});
    if (['system', 'light', 'dark'].indexOf(merged.mode) === -1) merged.mode = 'system';
    var validAccent = ACCENT_PRESETS.some(function(a) { return a.id === merged.accent; });
    if (!validAccent) merged.accent = 'pink';
    return merged;
  }

  async function saveAppearance(patch) {
    var current = await getAppearance();
    var mode = patch && patch.mode ? String(patch.mode) : current.mode;
    if (['system', 'light', 'dark'].indexOf(mode) === -1) mode = 'system';
    var accent = patch && patch.accent ? String(patch.accent) : current.accent;
    if (!ACCENT_PRESETS.some(function(a) { return a.id === accent; })) accent = 'pink';
    var next = {
      mode: mode,
      accent: accent,
      updatedAt: Date.now()
    };
    return await dbPutConfig(KEYS.APPEARANCE, next);
  }

  // ===== 4. 常规设置 =====
  async function getGeneralSettings() {
    var saved = await dbGetConfig(KEYS.GENERAL);
    return Object.assign({}, DEFAULT_GENERAL, saved && typeof saved === 'object' ? saved : {});
  }

  async function saveGeneralSettings(patch) {
    var current = await getGeneralSettings();
    var next = {
      enterToSend: patch && typeof patch.enterToSend === 'boolean' ? patch.enterToSend : !!current.enterToSend,
      autoUseDefaultPreset: patch && typeof patch.autoUseDefaultPreset === 'boolean' ? patch.autoUseDefaultPreset : !!current.autoUseDefaultPreset,
      showCharCount: patch && typeof patch.showCharCount === 'boolean' ? patch.showCharCount : !!current.showCharCount,
      updatedAt: Date.now()
    };
    return await dbPutConfig(KEYS.GENERAL, next);
  }

  // ===== 5. 预设与提示词中心（每个预设独立存储于 db.config: 'aiw_preset:<id>'） =====
  function normalizePreset(raw, forcedId) {
    var now = Date.now();
    var id = String(forcedId || (raw && raw.id) || generatePresetId());
    return {
      id: id,
      name: String((raw && raw.name) || '未命名预设').trim() || '未命名预设',
      avatarType: (raw && raw.avatarType === 'image') ? 'image' : 'icon',
      avatarValue: String((raw && raw.avatarValue) || 'fa-solid fa-wand-magic-sparkles'),
      description: raw && raw.description != null ? String(raw.description) : '',
      systemPrompt: raw && raw.systemPrompt != null ? String(raw.systemPrompt) : '',
      replyStyle: String((raw && raw.replyStyle) || '温和自然'),
      detailLevel: ['精简', '适中', '详尽'].indexOf(raw && raw.detailLevel) !== -1 ? raw.detailLevel : '适中',
      isDefault: !!(raw && raw.isDefault),
      createdAt: Number(raw && raw.createdAt) || now,
      updatedAt: Number(raw && raw.updatedAt) || now
    };
  }

  async function ensureStarterPresetsInitialized() {
    var initialized = await dbGetConfig(KEYS.PRESETS_INIT);
    if (initialized === true) return;

    var existingIds = await dbGetConfig(KEYS.PRESET_IDS);
    if (Array.isArray(existingIds) && existingIds.length > 0) {
      await dbPutConfig(KEYS.PRESETS_INIT, true);
      return;
    }

    var ids = [];
    var defaultId = '';
    for (var i = 0; i < DEFAULT_STARTER_PRESETS.length; i++) {
      var item = normalizePreset(DEFAULT_STARTER_PRESETS[i], DEFAULT_STARTER_PRESETS[i].id);
      await dbPutConfig(KEYS.PRESET_PREFIX + item.id, item);
      ids.push(item.id);
      if (item.isDefault) defaultId = item.id;
    }
    await dbPutConfig(KEYS.PRESET_IDS, ids);
    if (defaultId) {
      await dbPutConfig(KEYS.DEFAULT_PRESET_ID, defaultId);
    }
    await dbPutConfig(KEYS.PRESETS_INIT, true);
  }

  async function listPresets() {
    await ensureStarterPresetsInitialized();
    var ids = await dbGetConfig(KEYS.PRESET_IDS);
    if (!Array.isArray(ids)) ids = [];
    var defaultId = await dbGetConfig(KEYS.DEFAULT_PRESET_ID);

    var presets = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var item = await dbGetConfig(KEYS.PRESET_PREFIX + id);
      if (item && typeof item === 'object') {
        var norm = normalizePreset(item, id);
        if (defaultId) {
          norm.isDefault = norm.id === defaultId;
        }
        presets.push(norm);
      }
    }
    return presets;
  }

  async function getPreset(id) {
    if (!id) return null;
    await ensureStarterPresetsInitialized();
    var item = await dbGetConfig(KEYS.PRESET_PREFIX + id);
    if (!item || typeof item !== 'object') return null;
    var defaultId = await dbGetConfig(KEYS.DEFAULT_PRESET_ID);
    var norm = normalizePreset(item, id);
    if (defaultId) norm.isDefault = norm.id === defaultId;
    return norm;
  }

  async function getDefaultPreset() {
    var list = await listPresets();
    if (!list.length) return null;
    var found = list.find(function(p) { return p.isDefault; });
    return found || list[0];
  }

  async function setDefaultPreset(id) {
    var presets = await listPresets();
    var target = presets.find(function(p) { return p.id === id; });
    if (!target) return null;

    for (var i = 0; i < presets.length; i++) {
      var item = presets[i];
      var shouldBeDefault = item.id === id;
      if (item.isDefault !== shouldBeDefault) {
        item.isDefault = shouldBeDefault;
        item.updatedAt = Date.now();
        await dbPutConfig(KEYS.PRESET_PREFIX + item.id, item);
      }
    }
    await dbPutConfig(KEYS.DEFAULT_PRESET_ID, id);
    target.isDefault = true;
    return target;
  }

  async function createPreset(data) {
    await ensureStarterPresetsInitialized();
    var ids = await dbGetConfig(KEYS.PRESET_IDS);
    if (!Array.isArray(ids)) ids = [];

    var now = Date.now();
    var preset = normalizePreset(Object.assign({}, data || {}, {
      id: generatePresetId(),
      createdAt: now,
      updatedAt: now
    }));

    // 若目前没有任何预设，自动将新建的设为默认，或尊重显式指定
    if (ids.length === 0 && data && data.isDefault !== false) {
      preset.isDefault = true;
    }

    await dbPutConfig(KEYS.PRESET_PREFIX + preset.id, preset);
    ids.unshift(preset.id);
    await dbPutConfig(KEYS.PRESET_IDS, ids);

    if (preset.isDefault) {
      await setDefaultPreset(preset.id);
    }
    return preset;
  }

  async function updatePreset(id, patch) {
    if (!id) return null;
    var existing = await getPreset(id);
    if (!existing) return null;

    var updated = normalizePreset(Object.assign({}, existing, patch || {}, {
      id: id,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    }), id);

    await dbPutConfig(KEYS.PRESET_PREFIX + id, updated);

    if (patch && typeof patch.isDefault === 'boolean') {
      if (patch.isDefault) {
        await setDefaultPreset(id);
      } else {
        var currentDef = await dbGetConfig(KEYS.DEFAULT_PRESET_ID);
        if (currentDef === id) {
          await dbPutConfig(KEYS.DEFAULT_PRESET_ID, '');
        }
      }
    }
    return await getPreset(id);
  }

  async function duplicatePreset(id) {
    var src = await getPreset(id);
    if (!src) return null;
    var copyData = deepClone(src);
    copyData.name = src.name + '（副本）';
    copyData.isDefault = false;
    delete copyData.id;
    return await createPreset(copyData);
  }

  async function deletePreset(id) {
    if (!id) return false;
    await ensureStarterPresetsInitialized();
    var ids = await dbGetConfig(KEYS.PRESET_IDS);
    if (!Array.isArray(ids)) ids = [];

    var idx = ids.indexOf(id);
    if (idx === -1) return false;

    ids.splice(idx, 1);
    await dbDeleteConfig(KEYS.PRESET_PREFIX + id);
    await dbPutConfig(KEYS.PRESET_IDS, ids);

    var currentDef = await dbGetConfig(KEYS.DEFAULT_PRESET_ID);
    if (currentDef === id) {
      if (ids.length > 0) {
        await setDefaultPreset(ids[0]);
      } else {
        await dbPutConfig(KEYS.DEFAULT_PRESET_ID, '');
      }
    }
    return true;
  }

  // ===== 6. 提示词与预设导入/导出解析 =====
  function buildPresetExportJson(preset) {
    var p = normalizePreset(preset, preset && preset.id);
    return JSON.stringify({
      format: 'wanwan-aiw-preset',
      version: 1,
      exportedAt: new Date().toISOString(),
      preset: {
        name: p.name,
        avatarType: p.avatarType,
        avatarValue: p.avatarValue,
        description: p.description,
        systemPrompt: p.systemPrompt,
        replyStyle: p.replyStyle,
        detailLevel: p.detailLevel
      }
    }, null, 2);
  }

  function parseImportedPromptPayload(rawText, fileName) {
    var text = String(rawText == null ? '' : rawText).trim();
    if (!text) return null;

    // 尝试 JSON 解析（支持完整预设包或普通 JSON 对象）
    if (text.charAt(0) === '{') {
      try {
        var obj = JSON.parse(text);
        var src = obj && obj.preset && typeof obj.preset === 'object' ? obj.preset : obj;
        if (src && (typeof src.systemPrompt === 'string' || typeof src.prompt === 'string' || typeof src.name === 'string')) {
          return {
            kind: 'preset',
            preset: {
              name: String(src.name || '').trim() || '导入的预设',
              avatarType: src.avatarType === 'image' ? 'image' : 'icon',
              avatarValue: String(src.avatarValue || 'fa-solid fa-wand-magic-sparkles'),
              description: String(src.description || ''),
              systemPrompt: String(src.systemPrompt != null ? src.systemPrompt : (src.prompt || '')),
              replyStyle: String(src.replyStyle || '温和自然'),
              detailLevel: ['精简', '适中', '详尽'].indexOf(src.detailLevel) !== -1 ? src.detailLevel : '适中'
            }
          };
        }
      } catch (_) {
        // 回退按纯文本提示词导入
      }
    }

    var fallbackName = fileName ? String(fileName).replace(/\.[^/.]+$/, '').trim() : '';
    return {
      kind: 'prompt',
      name: fallbackName || '导入的提示词',
      systemPrompt: text
    };
  }

  global.AiWorkspaceStorage = {
    KEYS: KEYS,
    ACCENT_PRESETS: ACCENT_PRESETS,
    getProfile: getProfile,
    saveProfile: saveProfile,
    getPersonalization: getPersonalization,
    savePersonalization: savePersonalization,
    getAppearance: getAppearance,
    saveAppearance: saveAppearance,
    getGeneralSettings: getGeneralSettings,
    saveGeneralSettings: saveGeneralSettings,
    listPresets: listPresets,
    getPreset: getPreset,
    getDefaultPreset: getDefaultPreset,
    setDefaultPreset: setDefaultPreset,
    createPreset: createPreset,
    updatePreset: updatePreset,
    duplicatePreset: duplicatePreset,
    deletePreset: deletePreset,
    buildPresetExportJson: buildPresetExportJson,
    parseImportedPromptPayload: parseImportedPromptPayload
  };
})(window);
