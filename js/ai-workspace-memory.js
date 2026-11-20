// ai-workspace-memory.js — 知屿（AI 工作空间）第五阶段全自动三层记忆引擎（修复与优化版）
// 1) 短期记忆：近期原始消息 + 策略/高级参数驱动的阶段性摘要
// 2) 跨窗口记忆：独立用户级长期记忆 + 可独立开关的跨窗口历史参考（支持同义概念扩展与轻量语义召回）
// 3) 长期记忆：
//    - 方式 A：明确记忆指令即时解析与持久落库（不等待流式回答结束，尊重长期记忆开关，绝不伪造成功提示）
//    - 方式 B：普通聊天宽松自然语言自动识别、去重、同类偏好冲突更新、秘密拦截与墓碑防复活
// 4) 持久化后台任务队列：完整状态机（waiting/running/saved/skipped/retry_waiting/failed）、真实写入追踪与重试
(function(global) {
  'use strict';

  var DEFAULT_RECENT_RAW = 6;
  var DEFAULT_TRIGGER_CHARS = 3200;
  var DEFAULT_MAX_RECALL = 5;
  var DEFAULT_MAX_MEM_LENGTH = 260;

  var STOP_CHARS = new Set([
    '的', '了', '吗', '呢', '吧', '啊', '呀', '哦', '哇', '嗯',
    '在', '是', '有', '和', '与', '或', '及', '对', '把', '被', '给', '让',
    '我', '你', '他', '她', '它', '们', '这', '那', '个', '些', '每',
    '什', '么', '怎', '样', '为', '谁', '哪', '里', '几', '多', '少',
    '请', '问', '帮', '助', '一', '下', '可', '以', '能', '否', '会',
    '想', '要', '去', '来', '做', '用', '写', '说', '看', '听', '找',
    '就', '都', '也', '还', '很', '挺', '太', '更', '最', '只', '不', '没'
  ]);

  var STOP_WORDS_EN = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as',
    'and', 'or', 'but', 'if', 'then', 'so', 'do', 'does', 'did',
    'can', 'could', 'will', 'would', 'should', 'may', 'might',
    'i', 'me', 'my', 'you', 'your', 'we', 'our', 'it', 'its', 'this', 'that',
    'what', 'which', 'who', 'how', 'when', 'where', 'why', 'please', 'help'
  ]);

  var GENERIC_BIGRAMS = new Set([
    '推荐', '建议', '需要', '注意', '时候', '平时', '经常', '通常', '一般',
    '可以', '应该', '问题', '方式', '方法', '内容', '使用', '进行', '帮助',
    '用户', '喜欢', '习惯', '比较', '非常', '还是', '已经', '以后', '之后',
    '什么', '最近', '当前', '现在', '一款', '一个', '一种', '东西'
  ]);

  var CONCEPT_CLUSTERS = [
    {
      name: 'concept_software_project',
      terms: ['软件', '应用', 'app', '工具', '程序', '产品', '项目', '系统', '平台', '网站', '网页', '开发', '研发', '制作', '编写', '搭建', '正在做', '在做', 'ai', '助手', '工作空间']
    },
    {
      name: 'concept_coffee_drink',
      terms: ['咖啡', '美式', '冰美式', '热美式', '拿铁', '热拿铁', '冰拿铁', '卡布奇诺', '摩卡', '浓缩', '奶茶', '绿茶', '红茶', '乌龙茶', '饮品', '饮料', '喝什么', '爱喝', '常喝', '改喝']
    },
    {
      name: 'concept_fruit_food',
      terms: ['水果', '草莓', '芒果', '苹果', '香蕉', '葡萄', '西瓜', '橙子', '橘子', '桃子', '樱桃', '蓝莓', '榴莲', '吃饭', '美食', '菜谱', '食谱', '忌口', '过敏', '香菜', '辣', '素食', '早餐', '午餐', '晚餐', '外卖', '餐厅', '爱吃', '不吃', '改吃']
    },
    {
      name: 'concept_coding_tech',
      terms: ['代码', '编程', '前端', '后端', '全栈', 'javascript', 'typescript', 'react', 'vue', 'python', 'node', 'css', 'html', 'sql', 'git', '接口', '数据库', '架构', '部署']
    },
    {
      name: 'concept_schedule_travel',
      terms: ['计划', '规划', '安排', '日程', '出差', '旅行', '旅游', '航班', '酒店', '周末', '下周', '下个月', '锻炼', '运动', '健身', '作息']
    },
    {
      name: 'concept_identity',
      terms: ['叫我', '名字', '称呼', '姓名', '职业', '工作', '岗位', '住在', '城市', '来自']
    },
    {
      name: 'concept_reply_style',
      terms: ['排版', '格式', '风格', '语气', '简短', '详细', '清单', '列表', '先给结论', '中文', '英文']
    }
  ];

  var MUTUAL_SLOTS = [
    {
      name: 'coffee_drink',
      category: '偏好',
      cues: ['美式', '冰美式', '热美式', '拿铁', '热拿铁', '冰拿铁', '卡布奇诺', '摩卡', '咖啡', '意式浓缩', '生椰拿铁']
    },
    {
      name: 'tea_drink',
      category: '偏好',
      cues: ['奶茶', '乌龙茶', '绿茶', '红茶', '花茶', '果茶', '柠檬茶']
    },
    {
      name: 'user_location',
      category: '身份信息',
      cues: ['住在', '居住在', '定居', '搬到', '现居']
    },
    {
      name: 'user_name',
      category: '身份信息',
      cues: ['名字', '叫我', '称呼为', '称为']
    }
  ];

  var _queueRunning = false;
  var _queueRerunRequested = false;

  function S() {
    return global.AiWorkspaceStorage;
  }

  function AI() {
    return global.AiWorkspaceAI;
  }

  function resolveMemoryParams(settings) {
    var store = S();
    var sanitized = (store && typeof store.sanitizeMemorySettings === 'function')
      ? store.sanitizeMemorySettings(settings)
      : (settings || {});
    return {
      shortTermContext: sanitized.shortTermContext !== false,
      crossChatMemory: sanitized.crossChatMemory !== false,
      useMemory: sanitized.useMemory !== false,
      autoMemory: sanitized.autoMemory !== false,
      referenceHistoryChats: sanitized.referenceHistoryChats !== false,
      strategy: sanitized.strategy || 'natural',
      summaryTriggerChars: Number(sanitized.summaryTriggerChars) || DEFAULT_TRIGGER_CHARS,
      recentRawMessagesLimit: Number(sanitized.recentRawMessagesLimit) || DEFAULT_RECENT_RAW,
      maxMemoryRecallCount: Number(sanitized.maxMemoryRecallCount) || DEFAULT_MAX_RECALL,
      maxSingleMemoryLength: Number(sanitized.maxSingleMemoryLength) || DEFAULT_MAX_MEM_LENGTH
    };
  }

  function sanitizeErrorForLog(rawErr) {
    var msg = String((rawErr && rawErr.message) || rawErr || '任务执行失败').trim();
    return msg
      .replace(/\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{8,}\b/gi, 'sk-***')
      .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi, 'Bearer ***')
      .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, 'AIza***')
      .slice(0, 220);
  }

  // ===== 1. 敏感信息与秘密守卫（绝不保存密码、API Key、验证码、私钥等） =====
  function containsSensitiveSecret(text) {
    var src = String(text || '');
    if (!src.trim()) return false;

    var keyPatterns = [
      /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{12,}\b/i,
      /\bAIza[0-9A-Za-z_-]{16,}\b/,
      /\bgh[pousr]_[0-9A-Za-z]{16,}\b/,
      /\bgithub_pat_[0-9A-Za-z_]{16,}\b/,
      /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bBearer\s+[A-Za-z0-9._-]{12,}\b/i,
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/,
      /-----BEGIN\s+[A-Z0-9 ]*PRIVATE\s+KEY-----/i
    ];
    for (var i = 0; i < keyPatterns.length; i++) {
      if (keyPatterns[i].test(src)) return true;
    }

    var secretPhrasePatterns = [
      /(?:密码|口令|交易密码|支付密码|登录密码|开机密码|wifi密码|pin\s*码|验证码|校验码|动态码|授权码|安全码|私钥|密钥|秘钥|api\s*key|secret\s*key|access\s*token|password|passcode|otp)\s*(?:是|为|[:：=]|设成|设为|改为)\s*\S+/i,
      /(?:记住|保存|记下|写下)[^。\n]{0,16}(?:密码|口令|验证码|api\s*key|私钥|密钥|秘钥|token|passcode)/i,
      /(?:验证码|动态码|校验码|otp)[^\d\n]{0,8}\d{4,8}/i,
      /\b(?:pwd|passwd|pass|secret|apikey|api_key)\s*[:=]\s*['"]?\S{4,}/i
    ];
    for (var j = 0; j < secretPhrasePatterns.length; j++) {
      if (secretPhrasePatterns[j].test(src)) return true;
    }

    return false;
  }

  // ===== 2. 文本规范化、分词与相似度计算 =====
  function normalizeMemoryText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/^[-*•\d.)\s]+/, '')
      .replace(/[\s，。！？、；：“”"'‘’（）()【】\[\],.!?;:~`「」]+/g, '')
      .trim();
  }

  function extractSearchFeatures(text) {
    var src = String(text || '').toLowerCase();
    var terms = new Set();
    var enTerms = new Set();
    var zhChars = new Set();
    var bigrams = new Set();

    var enMatches = src.match(/[a-z0-9_+#.-]{2,}/g) || [];
    for (var i = 0; i < enMatches.length; i++) {
      var w = enMatches[i];
      if (!STOP_WORDS_EN.has(w)) {
        terms.add(w);
        enTerms.add(w);
      }
    }

    var zhRuns = src.match(/[\u4e00-\u9fa5]+/g) || [];
    for (var j = 0; j < zhRuns.length; j++) {
      var run = zhRuns[j];
      var filteredChars = [];
      for (var k = 0; k < run.length; k++) {
        var ch = run.charAt(k);
        if (!STOP_CHARS.has(ch)) {
          filteredChars.push(ch);
          terms.add(ch);
          zhChars.add(ch);
        }
      }
      var cleanRun = filteredChars.join('');
      if (cleanRun.length >= 2) {
        for (var g = 0; g <= cleanRun.length - 2; g++) {
          bigrams.add(cleanRun.slice(g, g + 2));
        }
      }
      if (run.length >= 2) {
        for (var rg = 0; rg <= run.length - 2; rg++) {
          var bg = run.slice(rg, rg + 2);
          if (!STOP_CHARS.has(bg.charAt(0)) && !STOP_CHARS.has(bg.charAt(1))) {
            bigrams.add(bg);
          }
        }
      }
    }

    var concepts = new Set();
    for (var c = 0; c < CONCEPT_CLUSTERS.length; c++) {
      var cluster = CONCEPT_CLUSTERS[c];
      for (var t = 0; t < cluster.terms.length; t++) {
        if (src.indexOf(cluster.terms[t]) !== -1) {
          concepts.add(cluster.name);
          break;
        }
      }
    }

    return {
      terms: terms,
      enTerms: enTerms,
      zhChars: zhChars,
      bigrams: bigrams,
      concepts: concepts
    };
  }

  function computeTextSimilarity(textA, textB) {
    var normA = normalizeMemoryText(textA);
    var normB = normalizeMemoryText(textB);
    if (!normA || !normB) return 0;
    if (normA === normB) return 1;

    if ((normA.indexOf(normB) !== -1 || normB.indexOf(normA) !== -1) &&
        Math.min(normA.length, normB.length) / Math.max(normA.length, normB.length) >= 0.72) {
      return 0.85;
    }

    var fa = extractSearchFeatures(textA);
    var fb = extractSearchFeatures(textB);

    var setA = fa.bigrams.size > 0 ? fa.bigrams : fa.terms;
    var setB = fb.bigrams.size > 0 ? fb.bigrams : fb.terms;
    if (setA.size === 0 || setB.size === 0) return 0;

    var inter = 0;
    setA.forEach(function(item) {
      if (setB.has(item)) inter++;
    });
    var union = setA.size + setB.size - inter;
    return union > 0 ? (inter / union) : 0;
  }

  // ===== 3. 作用域、权限与墓碑过滤 =====
  function filterAccessibleMemories(memories, context) {
    var ctx = context && typeof context === 'object' ? context : {};
    var userId = String(ctx.userId || 'local_user').trim() || 'local_user';
    var chatId = String(ctx.chatId || '').trim();
    var projectId = String(ctx.projectId || '').trim();
    var allowCrossChat = ctx.allowCrossChat !== false;

    return (Array.isArray(memories) ? memories : []).filter(function(mem) {
      if (!mem || !mem.content) return false;
      var memUserId = String(mem.userId || 'local_user').trim() || 'local_user';
      if (memUserId !== userId) return false;

      var scope = String(mem.scope || 'user').toLowerCase();
      if (scope === 'chat') {
        return !!(chatId && mem.sourceChatId && mem.sourceChatId === chatId);
      }
      if (scope === 'project') {
        if (!projectId || !mem.projectId || mem.projectId !== projectId) return false;
        if (!allowCrossChat && mem.sourceChatId && mem.sourceChatId !== chatId) return false;
        return true;
      }
      if (scope === 'user') {
        if (!allowCrossChat && mem.sourceChatId && mem.sourceChatId !== chatId) {
          return false;
        }
        return true;
      }
      return false;
    });
  }

  function findBlockingDeletedSignature(text, deletedSigs) {
    if (!text || !Array.isArray(deletedSigs) || !deletedSigs.length) return null;
    var norm = normalizeMemoryText(text);
    if (!norm) return null;

    for (var i = 0; i < deletedSigs.length; i++) {
      var sig = deletedSigs[i];
      if (!sig || !sig.norm) continue;
      if (sig.norm === norm) return sig;
      if (sig.content && computeTextSimilarity(text, sig.content) >= 0.65) return sig;

      if (sig.content) {
        var sigFeat = extractSearchFeatures(sig.content);
        var textFeat = extractSearchFeatures(text);
        var coreBigrams = [];
        sigFeat.bigrams.forEach(function(bg) {
          if (!GENERIC_BIGRAMS.has(bg) && bg !== '用户') coreBigrams.push(bg);
        });
        if (coreBigrams.length >= 2) {
          var matched = 0;
          for (var j = 0; j < coreBigrams.length; j++) {
            if (textFeat.bigrams.has(coreBigrams[j])) matched++;
          }
          if (matched / coreBigrams.length >= 0.65) {
            return sig;
          }
        }
      }
    }
    return null;
  }

  function isTextBlockedByDeletedSigs(text, deletedSigs) {
    return !!findBlockingDeletedSignature(text, deletedSigs);
  }

  // ===== 4. 相关性评分与跨窗口检索引擎 =====
  function isMetaMemoryQuery(query) {
    var q = String(query || '').toLowerCase();
    return /(?:你记得|还记得|我之前|之前说过|上次说|关于我|了解我|我的偏好|我的喜好|我的习惯|我的计划|我的项目|我的决定|我的忌口|我的目标|适合我|按我的|根据我的|帮我回忆|我最近在|我正在做|我在开发|我平时|我喜欢|我最喜欢|我爱喝|我爱吃|我用什么|我是做什么的)/.test(q);
  }

  function looksPersonalOrContextualQuery(query) {
    var q = String(query || '').toLowerCase();
    if (isMetaMemoryQuery(q)) return true;
    return /(?:我|我的|帮我推荐|给我推荐|适合|之前|最近|上次|偏好|习惯|计划|项目|决定|记得)/.test(q);
  }

  function scoreTextRelevance(text, category, queryFeatures, metaRecall, rawQueryLower, extraScope) {
    var memFeatures = extractSearchFeatures(String(text || '') + ' ' + String(category || ''));

    var specificBigramHits = 0;
    var genericBigramHits = 0;
    queryFeatures.bigrams.forEach(function(bg) {
      if (memFeatures.bigrams.has(bg)) {
        if (GENERIC_BIGRAMS.has(bg)) genericBigramHits++;
        else specificBigramHits++;
      }
    });

    var enTermHits = 0;
    queryFeatures.enTerms.forEach(function(t) {
      if (memFeatures.enTerms.has(t)) enTermHits++;
    });

    var zhCharHits = 0;
    queryFeatures.zhChars.forEach(function(t) {
      if (memFeatures.zhChars.has(t)) zhCharHits++;
    });

    var conceptHits = 0;
    queryFeatures.concepts.forEach(function(cName) {
      if (memFeatures.concepts.has(cName)) conceptHits++;
    });

    var score = 0;
    score += specificBigramHits * 3.2;
    score += genericBigramHits * 0.35;
    score += enTermHits * 1.9;
    score += zhCharHits * 0.3;
    score += conceptHits * 2.1;

    if (metaRecall) {
      var cat = String(category || '');
      if (/偏好|喜欢|爱喝|爱吃|忌口|口味|水果/.test(rawQueryLower)) {
        if (cat === '偏好') score += 3.2;
      } else if (/习惯|作息|平时/.test(rawQueryLower)) {
        if (cat === '习惯') score += 3.2;
      } else if (/计划|目标|打算|出差|旅游/.test(rawQueryLower)) {
        if (cat === '长期计划') score += 3.2;
      } else if (/项目|开发|制作|软件|应用|系统/.test(rawQueryLower)) {
        if (cat === '项目') score += 3.5;
      } else if (/决定/.test(rawQueryLower)) {
        if (cat === '决定') score += 3.2;
      } else if (specificBigramHits === 0 && enTermHits === 0 && conceptHits === 0 && extraScope === 'user') {
        score += 2.1;
      }
    }

    return {
      score: score,
      hasLexicalOrConceptMatch: (specificBigramHits > 0 || enTermHits > 0 || conceptHits > 0)
    };
  }

  function sanitizeSnippetByDeletedSigs(rawText, deletedSigs) {
    var src = String(rawText || '').trim();
    if (!src) return '';
    if (!Array.isArray(deletedSigs) || !deletedSigs.length) return src;
    var clauses = src.split(/(?<=[。！？\n；])/);
    var kept = [];
    for (var i = 0; i < clauses.length; i++) {
      var c = clauses[i].trim();
      if (!c) continue;
      if (!isTextBlockedByDeletedSigs(c, deletedSigs)) {
        kept.push(c);
      }
    }
    return kept.join('');
  }

  async function collectCrossChatCandidates(store, opts, deletedSigs) {
    if (!store || typeof store.listChats !== 'function') return [];
    var currentChatId = String(opts.chatId || '').trim();
    var currentProjectId = String(opts.projectId || '').trim();
    var allChats = await store.listChats();
    var candidates = [];

    for (var i = 0; i < allChats.length && i < 20; i++) {
      var chat = allChats[i];
      if (!chat || !chat.id || chat.id === currentChatId) continue;
      if (chat.projectId && currentProjectId && chat.projectId !== currentProjectId) continue;
      if (chat.projectId && !currentProjectId) continue;

      if (chat.summary) {
        var cleanSummary = sanitizeSnippetByDeletedSigs(chat.summary, deletedSigs);
        if (cleanSummary) {
          candidates.push({
            id: 'csum:' + chat.id,
            kind: 'summary',
            chatId: chat.id,
            chatTitle: chat.title || '历史对话',
            content: cleanSummary.slice(0, 320),
            updatedAt: chat.summaryUpdatedAt || chat.updatedAt || 0
          });
        }
      }

      var msgs = Array.isArray(chat.messages) ? chat.messages : [];
      var userSnippets = [];
      for (var m = msgs.length - 1; m >= 0 && userSnippets.length < 3; m--) {
        var msg = msgs[m];
        if (!msg || msg.role !== 'user') continue;
        var text = String(msg.content || '').trim();
        if (text.length < 4 || containsSensitiveSecret(text)) continue;
        if (/[？?]$/.test(text) && !/[，。；！]/.test(text) && !/(?:我|我的).{0,8}(?:喜欢|正在|开发|习惯|打算|计划|决定|改|叫|住)/.test(text)) {
          continue;
        }
        var cleanClause = sanitizeSnippetByDeletedSigs(text, deletedSigs);
        if (cleanClause) {
          userSnippets.unshift(cleanClause.slice(0, 180));
        }
      }
      if (userSnippets.length > 0) {
        candidates.push({
          id: 'cmsg:' + chat.id,
          kind: 'recent',
          chatId: chat.id,
          chatTitle: chat.title || '历史对话',
          content: userSnippets.join('；'),
          updatedAt: chat.updatedAt || 0
        });
      }
    }
    return candidates;
  }

  async function trySemanticRecallWithModel(query, memoryPool, crossPool, apiConfig, maxPick) {
    var ai = AI();
    if (!ai || typeof ai.requestChatCompletion !== 'function') return { memIds: [], crossIds: [] };
    if (!apiConfig || !apiConfig.url || !apiConfig.key || !apiConfig.model) return { memIds: [], crossIds: [] };

    var items = [];
    memoryPool.slice(0, 14).forEach(function(m) {
      items.push({ id: m.id, type: 'mem', text: '[' + (m.category || '记忆') + '] ' + m.content.slice(0, 140) });
    });
    crossPool.slice(0, 8).forEach(function(c) {
      items.push({ id: c.id, type: 'cross', text: '[对话:' + c.chatTitle + '] ' + c.content.slice(0, 140) });
    });
    if (!items.length) return { memIds: [], crossIds: [] };

    try {
      var listText = items.map(function(it) { return it.id + ' => ' + it.text; }).join('\n');
      var res = await ai.requestChatCompletion({
        apiConfig: apiConfig,
        temperature: 0,
        maxTokens: 280,
        allowReasoningFallback: true,
        messages: [
          {
            role: 'system',
            content: '你是记忆相关性筛选器。从候选列表中挑出与用户当前提问真正相关的条目 ID。绝不挑选无关条目。只输出 JSON：{"ids":[]}'
          },
          {
            role: 'user',
            content: '当前问题：' + query.slice(0, 300) + '\n\n候选列表：\n' + listText + '\n\n请只返回最相关的条目 ID（最多 ' + (maxPick || 4) + ' 个），例如 {"ids":["mem_1"]}；如均不相关返回 {"ids":[]}。'
          }
        ]
      });
      var parsed = parseExtractorJsonObject(res && res.content);
      var ids = (parsed && Array.isArray(parsed.ids)) ? parsed.ids.map(String) : [];
      var memSet = new Set(memoryPool.map(function(m) { return m.id; }));
      var crossSet = new Set(crossPool.map(function(c) { return c.id; }));
      return {
        memIds: ids.filter(function(id) { return memSet.has(id); }),
        crossIds: ids.filter(function(id) { return crossSet.has(id); })
      };
    } catch (_) {
      return { memIds: [], crossIds: [] };
    }
  }

  // ===== 5. 短期记忆阶段性摘要（全自动，受策略与高级参数控制） =====
  function getHistoryCharLength(messages) {
    var total = 0;
    for (var i = 0; i < (Array.isArray(messages) ? messages.length : 0); i++) {
      total += String((messages[i] && messages[i].content) || '').length;
    }
    return total;
  }

  function needsShortTermSummary(chat, settings) {
    if (!chat || !Array.isArray(chat.messages)) return false;
    var params = resolveMemoryParams(settings);
    if (!params.shortTermContext) return false;

    var keepRecent = params.recentRawMessagesLimit;
    var triggerChars = params.summaryTriggerChars;
    var minMsgs = keepRecent + 4;
    var stepChars = Math.max(220, Math.round(triggerChars * 0.35));
    var stepMsgs = Math.max(2, Math.min(4, Math.floor(keepRecent / 2)));

    var msgs = chat.messages.filter(function(m) {
      return m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim();
    });
    if (msgs.length <= keepRecent) return false;

    var targetUpTo = msgs.length - keepRecent;
    var alreadyUpTo = Math.max(0, Number(chat.summaryUpToCount) || 0);
    if (targetUpTo <= alreadyUpTo) return false;

    var totalChars = getHistoryCharLength(msgs);
    if (msgs.length < minMsgs && totalChars < triggerChars) {
      return false;
    }

    var deltaMsgs = msgs.slice(alreadyUpTo, targetUpTo);
    var deltaChars = getHistoryCharLength(deltaMsgs);
    if (deltaMsgs.length >= stepMsgs || deltaChars >= stepChars) {
      return true;
    }
    return false;
  }

  function buildLocalFallbackSummary(prevSummary, deltaMessages) {
    var lines = [];
    if (prevSummary) lines.push(prevSummary);
    var userPoints = [];
    var assistantPoints = [];
    for (var i = 0; i < deltaMessages.length; i++) {
      var m = deltaMessages[i];
      var text = String(m.content || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (m.role === 'user') userPoints.push(text.slice(0, 90));
      else assistantPoints.push(text.slice(0, 90));
    }
    if (userPoints.length) {
      lines.push('【用户要求与关键事实】' + userPoints.slice(-4).join('；'));
    }
    if (assistantPoints.length) {
      lines.push('【阶段推进结论】' + assistantPoints.slice(-2).join('；'));
    }
    return lines.join('\n').slice(0, 900);
  }

  async function summarizeChatSegment(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var store = S();
    var ai = AI();
    if (!store || !opts.chatId) return null;

    var settings = opts.settings || await store.getMemorySettings();
    var params = resolveMemoryParams(settings);
    var keepRecent = params.recentRawMessagesLimit;

    var chat = await store.getChat(opts.chatId);
    if (!chat || !Array.isArray(chat.messages)) return null;

    var cleanMsgs = chat.messages.filter(function(m) {
      return m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim();
    });
    var targetUpTo = Math.max(0, cleanMsgs.length - keepRecent);
    var prevUpTo = Math.max(0, Number(chat.summaryUpToCount) || 0);
    if (targetUpTo <= prevUpTo) return null;

    var deltaMsgs = cleanMsgs.slice(prevUpTo, targetUpTo);
    if (!deltaMsgs.length) return null;

    var prevSummary = String(chat.summary || '').trim();
    var dialogueText = deltaMsgs.map(function(m) {
      var roleLabel = m.role === 'user' ? '用户' : '助手';
      var content = String(m.content || '').slice(0, 420);
      return roleLabel + '：' + (containsSensitiveSecret(content) ? '[已脱敏]' : content);
    }).join('\n');

    var nextSummary = '';
    if (ai && typeof ai.requestChatCompletion === 'function' && opts.apiConfig && opts.apiConfig.url && opts.apiConfig.key) {
      try {
        var res = await ai.requestChatCompletion({
          apiConfig: opts.apiConfig,
          temperature: 0.1,
          maxTokens: 600,
          messages: [
            {
              role: 'system',
              content: '你是对话短期工作记忆压缩器。请将已有摘要与新增对话轮次合并成简洁结构化的短期工作记忆，包含：1.当前任务 2.关键事实 3.用户要求 4.未完成事项。绝不包含密码或密钥，不超过 450 字。'
            },
            {
              role: 'user',
              content: (prevSummary ? ('【已有短期摘要】\n' + prevSummary + '\n\n') : '') +
                '【新增较早轮次对话】\n' + dialogueText + '\n\n请输出更新后的短期摘要：'
            }
          ]
        });
        nextSummary = String((res && res.content) || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      } catch (err) {
        if (!opts.allowLocalFallback) {
          throw err;
        }
      }
    }

    if (!nextSummary) {
      nextSummary = buildLocalFallbackSummary(prevSummary, deltaMsgs);
    }

    var updatedChat = await store.saveChat({
      id: chat.id,
      summary: nextSummary.slice(0, 900),
      summaryUpToCount: targetUpTo,
      summaryUpdatedAt: Date.now(),
      updatedAt: chat.updatedAt || Date.now()
    });
    return updatedChat;
  }

  // ===== 6. 统一三层记忆检索入口（供聊天主流程调用） =====
  async function retrieveRelevantMemories(options) {
    var ctx = await retrieveWorkspaceContext(options);
    return ctx.memories;
  }

  async function retrieveWorkspaceContext(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var store = S();
    var defaultParams = resolveMemoryParams({});
    var emptyResult = {
      memories: [],
      crossChatContexts: [],
      shortTermSummary: '',
      summaryUpToCount: 0,
      useShortTermHistory: true,
      maxRecentMessages: defaultParams.recentRawMessagesLimit,
      settings: defaultParams
    };
    if (!store) return emptyResult;

    var rawSettings = await store.getMemorySettings();
    var params = resolveMemoryParams(rawSettings);
    emptyResult.settings = params;

    var activeChat = opts.activeChat || null;
    var historyMessages = Array.isArray(opts.historyMessages) ? opts.historyMessages : [];
    var shortTermEnabled = params.shortTermContext !== false;

    if (!shortTermEnabled) {
      emptyResult.useShortTermHistory = false;
      emptyResult.shortTermSummary = '';
      emptyResult.summaryUpToCount = 0;
      emptyResult.maxRecentMessages = 0;
    } else {
      emptyResult.useShortTermHistory = true;
      emptyResult.shortTermSummary = activeChat ? String(activeChat.summary || '').trim() : '';
      emptyResult.summaryUpToCount = activeChat ? Math.max(0, Number(activeChat.summaryUpToCount) || 0) : 0;
      emptyResult.maxRecentMessages = params.recentRawMessagesLimit;
    }

    var query = String(opts.query || '').trim();
    if (!query) return emptyResult;

    var userId = String(opts.userId || 'local_user').trim() || 'local_user';
    var chatId = String(opts.chatId || (activeChat && activeChat.id) || '').trim();
    var projectId = String(opts.projectId || (activeChat && activeChat.projectId) || '').trim();
    var allowCrossChat = params.crossChatMemory !== false;
    var allowReferenceHistory = allowCrossChat && params.referenceHistoryChats !== false;

    var searchSource = query;
    var isShortFollowUp = query.length <= 8 || (query.length <= 16 && /(?:^|\s|，)(?:那|它|这|这个|那个|继续|顺便|还有|再|换一个|换个|另外|刚才|上面)|(?:呢|吗)[？?]?$/.test(query));
    if (isShortFollowUp && shortTermEnabled && historyMessages.length > 0) {
      for (var hi = historyMessages.length - 1; hi >= 0; hi--) {
        if (historyMessages[hi] && historyMessages[hi].role === 'user' && historyMessages[hi].content) {
          searchSource += ' ' + String(historyMessages[hi].content).slice(0, 80);
          break;
        }
      }
    }

    var queryFeatures = extractSearchFeatures(searchSource);
    var metaRecall = isMetaMemoryQuery(query);
    var rawQueryLower = query.toLowerCase();
    var minScore = metaRecall ? 1.8 : 2.1;

    var accessibleMemories = [];
    if (params.useMemory && typeof store.listMemories === 'function') {
      var allMemories = await store.listMemories();
      accessibleMemories = filterAccessibleMemories(allMemories, {
        userId: userId,
        chatId: chatId,
        projectId: projectId,
        allowCrossChat: allowCrossChat
      });
    }

    var scoredMemories = [];
    for (var i = 0; i < accessibleMemories.length; i++) {
      var mem = accessibleMemories[i];
      var res = scoreTextRelevance(mem.content, mem.category, queryFeatures, metaRecall, rawQueryLower, mem.scope);
      if (res.score > 0) {
        res.score += ((Number(mem.importance) || 3) - 3) * 0.25;
        if (mem.scope === 'chat') res.score += 0.3;
      }
      if (res.score >= minScore && (metaRecall || res.hasLexicalOrConceptMatch)) {
        scoredMemories.push({ memory: mem, score: res.score });
      }
    }

    scoredMemories.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (b.memory.updatedAt || 0) - (a.memory.updatedAt || 0);
    });

    var chosenMemories = [];
    var usedMemChars = 0;
    var maxResults = Math.max(1, Math.min(12, Number(opts.maxResults != null ? opts.maxResults : params.maxMemoryRecallCount) || 5));
    var maxChars = Math.max(240, Number(opts.maxChars) || (maxResults * Math.max(140, params.maxSingleMemoryLength)));
    for (var j = 0; j < scoredMemories.length && chosenMemories.length < maxResults; j++) {
      var item = scoredMemories[j].memory;
      var len = String(item.content || '').length + 12;
      if (chosenMemories.length > 0 && usedMemChars + len > maxChars) continue;
      chosenMemories.push(item);
      usedMemChars += len;
    }

    var deletedSigs = typeof store.listDeletedMemorySignatures === 'function'
      ? await store.listDeletedMemorySignatures()
      : [];

    var crossCandidates = [];
    var chosenCross = [];
    if (allowReferenceHistory) {
      crossCandidates = await collectCrossChatCandidates(store, {
        chatId: chatId,
        projectId: projectId
      }, deletedSigs);

      var scoredCross = [];
      for (var c = 0; c < crossCandidates.length; c++) {
        var cc = crossCandidates[c];
        var cRes = scoreTextRelevance(cc.content + ' ' + cc.chatTitle, '', queryFeatures, metaRecall, rawQueryLower, 'user');
        if (cRes.score >= minScore && (metaRecall || cRes.hasLexicalOrConceptMatch)) {
          scoredCross.push({ item: cc, score: cRes.score });
        }
      }
      scoredCross.sort(function(a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return (b.item.updatedAt || 0) - (a.item.updatedAt || 0);
      });
      var maxCrossCount = params.strategy === 'token_saver' ? 2 : (params.strategy === 'recall_more' ? 4 : 3);
      var usedCrossChars = 0;
      for (var k = 0; k < scoredCross.length && chosenCross.length < maxCrossCount; k++) {
        var cItem = scoredCross[k].item;
        if (usedCrossChars + cItem.content.length > 720 && chosenCross.length > 0) continue;
        chosenCross.push(cItem);
        usedCrossChars += cItem.content.length;
      }
    }

    if (
      chosenMemories.length === 0 &&
      chosenCross.length === 0 &&
      looksPersonalOrContextualQuery(query) &&
      (accessibleMemories.length > 0 || crossCandidates.length > 0) &&
      opts.apiConfig
    ) {
      var semanticPicked = await trySemanticRecallWithModel(query, accessibleMemories, crossCandidates, opts.apiConfig, maxResults);
      if (semanticPicked.memIds.length) {
        semanticPicked.memIds.forEach(function(id) {
          var foundM = accessibleMemories.find(function(m) { return m.id === id; });
          if (foundM && chosenMemories.length < maxResults) chosenMemories.push(foundM);
        });
      }
      if (semanticPicked.crossIds.length && allowReferenceHistory) {
        semanticPicked.crossIds.forEach(function(id) {
          var foundC = crossCandidates.find(function(c) { return c.id === id; });
          if (foundC && chosenCross.length < 3) chosenCross.push(foundC);
        });
      }
    }

    emptyResult.memories = chosenMemories;
    emptyResult.crossChatContexts = chosenCross;
    return emptyResult;
  }

  // ===== 7. 方式 A（用户明确记住指令）与方式 B（普通聊天 AI 自动记忆） =====
  function detectExplicitMemoryCommand(userText) {
    var text = String(userText || '').trim();
    if (!text) return { matched: false };

    var explicitPatterns = [
      /^(?:请|麻烦|麻烦你|请你|帮我|帮忙|请帮我|能帮我|可以帮我)?(?:记住|记一下|记下来|记牢|记录一下|存进记忆|存到记忆|加入记忆|写入记忆|别忘了|不要忘了|帮我记|把下面|把这条)/,
      /(?:帮我记住|请记住|麻烦记住|帮我记一下|请记一下|帮我记下来|记入长期记忆|存入长期记忆|写进长期记忆|添加到长期记忆)/
    ];
    for (var i = 0; i < explicitPatterns.length; i++) {
      if (explicitPatterns[i].test(text)) {
        return { matched: true };
      }
    }
    return { matched: false };
  }

  function inferMemoryCategoryFromText(text) {
    var t = String(text || '');
    if (/(?:喜欢|最喜欢|爱喝|爱吃|最爱|偏好|习惯喝|习惯吃|不喜欢|讨厌|忌口|过敏|改喝|改吃|风格|排版|简短|详尽|清单)/.test(t)) return '偏好';
    if (/(?:每天|每晚|平时|作息|习惯|早起|熬夜|几点睡)/.test(t)) return '习惯';
    if (/(?:计划|打算|准备去|下周|下个月|明年|目标|出差|旅行|考研|备考)/.test(t)) return '长期计划';
    if (/(?:项目|开发|正在做|系统|软件|应用|仓库|产品)/.test(t)) return '项目';
    if (/(?:决定|确定|选定|定下来|不再)/.test(t)) return '决定';
    if (/(?:叫我|我叫|名字|职业|工程师|医生|老师|学生|住在|居住|老家|养了)/.test(t)) return '身份信息';
    return '备忘';
  }

  function convertFirstPersonToThirdPerson(clause) {
    var s = String(clause || '').trim();
    if (!s) return '';
    s = s
      .replace(/我的/g, '用户的')
      .replace(/我们/g, '用户')
      .replace(/本人/g, '用户')
      .replace(/^我/, '用户')
      .replace(/([，,；;\s：:])我/g, '$1用户')
      .replace(/给我/g, '给用户')
      .replace(/叫我/g, '称呼用户')
      .replace(/回复我/g, '回复用户')
      .replace(/对我/g, '对用户');
    if (s.indexOf('用户') === -1) {
      s = '用户备忘：' + s;
    }
    return s;
  }

  function parseDirectExplicitMemoryFact(userText, maxLen) {
    var raw = String(userText || '').trim();
    if (!raw) return null;

    var stripped = raw
      .replace(/^(?:好的|嗯+|对了|那个|喂)?[\s，,。！!]*?(?:请|麻烦|麻烦你|请你|帮我|帮忙|请帮我|能帮我|可以帮我)?\s*(?:一定要|务必)?\s*(?:记住|记一下|记下来|记牢|记录一下|存进长期记忆|存到长期记忆|加入长期记忆|写入长期记忆|存到记忆|加入记忆|别忘了|不要忘了|帮我记一下|帮我记)\s*[：:，,、。\s]*/i, '')
      .replace(/[，,。\s]*(?:记住|记下来|记一下|别忘了|不要忘了)?\s*(?:好吗|好不好|行吗|可以吗|谢谢|感谢|拜托了|知道了吗)[？?！!。.\s]*$/i, '')
      .trim();

    if (!stripped || stripped.length < 2) return null;

    // 若包含指代不明的上下文依赖词，且缺少主语/完整语义，交给模型结合上下文提炼
    if (/^(?:这个|那个|上面|前面|刚才|刚刚|这件事|那件事|上述|以上|下面这些|这些|那些)/.test(stripped) ||
        /(?:上面说的|刚才说的|前面提到的|这个方案|那个方案|这件事)/.test(stripped)) {
      return null;
    }

    // 剥离“我是一个/我最喜欢…”后如仍为纯问句，则不直接落库
    if (/[？?]$/.test(stripped) && !/[，。；！]/.test(stripped)) {
      return null;
    }

    var fact = convertFirstPersonToThirdPerson(stripped);
    fact = fact.replace(/[。！!]+$/, '').trim();
    var limit = Math.max(60, Number(maxLen) || DEFAULT_MAX_MEM_LENGTH);
    if (fact.length > limit) fact = fact.slice(0, limit);

    return {
      action: 'add',
      targetId: '',
      content: fact,
      category: inferMemoryCategoryFromText(stripped),
      importance: 5,
      scope: 'user'
    };
  }

  async function handleExplicitMemoryCommand(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var userText = String(opts.userText || '').trim();
    var detect = detectExplicitMemoryCommand(userText);
    if (!detect.matched) {
      return { isExplicit: false, saved: false, added: [], updated: [] };
    }

    var store = S();
    if (!store) {
      return { isExplicit: true, saved: false, error: '存储模块未就绪', added: [], updated: [] };
    }

    var rawSettings = await store.getMemorySettings();
    var params = resolveMemoryParams(rawSettings);
    var chatId = String(opts.chatId || '');
    var chatTitle = String(opts.chatTitle || '');
    var projectId = String(opts.projectId || '');
    var userId = String(opts.userId || 'local_user').trim() || 'local_user';
    var turnCreatedAt = Date.now();

    // 1) 严格遵守用户设置：若长期记忆已关闭，不得绕过用户设置偷偷保存
    if (!params.useMemory) {
      var skippedTask = await store.enqueueMemoryTask({
        type: 'explicit_memory',
        turnKey: 'exp:' + chatId + ':' + String(opts.userMsgId || turnCreatedAt),
        chatId: chatId,
        chatTitle: chatTitle,
        projectId: projectId,
        userId: userId,
        status: 'skipped',
        attempts: 1,
        memoryWritten: false,
        savedMemoryIds: [],
        resultSummary: '长期记忆开关已关闭，未保存',
        payload: { userText: userText.slice(0, 500) }
      });
      return {
        isExplicit: true,
        saved: false,
        blockedBySetting: true,
        reason: '长期记忆已关闭，本次未保存',
        added: [],
        updated: [],
        task: skippedTask
      };
    }

    // 2) 安全拦截：绝不保存密码、API Key、验证码等敏感秘密
    if (containsSensitiveSecret(userText)) {
      var secretTask = await store.enqueueMemoryTask({
        type: 'explicit_memory',
        turnKey: 'exp:' + chatId + ':' + String(opts.userMsgId || turnCreatedAt),
        chatId: chatId,
        chatTitle: chatTitle,
        projectId: projectId,
        userId: userId,
        status: 'skipped',
        attempts: 1,
        memoryWritten: false,
        savedMemoryIds: [],
        resultSummary: '检测到密码/密钥/验证码等敏感信息，已安全拦截',
        payload: { userText: '[已脱敏敏感指令]' }
      });
      return {
        isExplicit: true,
        saved: false,
        blockedSecret: true,
        reason: '包含密码或密钥等敏感信息，已安全拦截',
        added: [],
        updated: [],
        task: secretTask
      };
    }

    var task = await store.enqueueMemoryTask({
      type: 'explicit_memory',
      turnKey: 'exp:' + chatId + ':' + String(opts.userMsgId || turnCreatedAt),
      chatId: chatId,
      chatTitle: chatTitle,
      projectId: projectId,
      userId: userId,
      status: 'running',
      attempts: 0,
      memoryWritten: false,
      savedMemoryIds: [],
      payload: { userText: userText.slice(0, 1200) }
    });

    try {
      var directItem = parseDirectExplicitMemoryFact(userText, params.maxSingleMemoryLength);
      var writeRes;

      if (directItem) {
        writeRes = await upsertExtractedMemories([directItem], {
          userId: userId,
          chatId: chatId,
          chatTitle: chatTitle,
          projectId: projectId,
          rawUserText: userText,
          maxSingleMemoryLength: params.maxSingleMemoryLength,
          taskCreatedAt: turnCreatedAt,
          allowOverrideOlderTombstone: true
        });
      } else {
        // 指令依赖上下文或结构复杂时，立即调用模型提取（不等待流式回答完成）
        writeRes = await extractAndSaveFromTurn({
          userText: userText,
          assistantText: opts.contextSnippet || '',
          historyMessages: opts.historyMessages || [],
          chatId: chatId,
          chatTitle: chatTitle,
          projectId: projectId,
          userId: userId,
          apiConfig: opts.apiConfig,
          forceExtract: true,
          ignoreAutoMemoryToggle: true,
          taskCreatedAt: turnCreatedAt,
          allowOverrideOlderTombstone: true
        });
      }

      var added = (writeRes && writeRes.added) || [];
      var updated = (writeRes && writeRes.updated) || [];
      var savedIds = added.concat(updated).map(function(m) { return m && m.id; }).filter(Boolean);
      var hasWritten = savedIds.length > 0;

      if (hasWritten) {
        var savedTask = await store.updateMemoryTask(task.id, {
          status: 'saved',
          attempts: 1,
          memoryWritten: true,
          savedMemoryIds: savedIds,
          lastError: '',
          resultSummary: '明确指令已写入 ' + savedIds.length + ' 条长期记忆'
        });
        return {
          isExplicit: true,
          saved: true,
          added: added,
          updated: updated,
          savedIds: savedIds,
          task: savedTask
        };
      }

      var skipMsg = (writeRes && writeRes.blockedSecrets)
        ? '包含敏感信息，已安全拦截'
        : ((writeRes && writeRes.skipped) ? '长期记忆中已存在相同内容' : '未能从指令中提取到可保存的具体内容');
      var skipTask = await store.updateMemoryTask(task.id, {
        status: 'skipped',
        attempts: 1,
        memoryWritten: false,
        savedMemoryIds: [],
        lastError: '',
        resultSummary: skipMsg
      });
      return {
        isExplicit: true,
        saved: false,
        alreadyExists: !!(writeRes && writeRes.skipped),
        reason: skipMsg,
        added: [],
        updated: [],
        task: skipTask
      };
    } catch (err) {
      var errMsg = sanitizeErrorForLog(err);
      var failedTask = await store.updateMemoryTask(task.id, {
        status: 'failed',
        attempts: 1,
        memoryWritten: false,
        savedMemoryIds: [],
        lastError: errMsg,
        resultSummary: '明确记忆保存失败'
      });
      return {
        isExplicit: true,
        saved: false,
        error: errMsg,
        added: [],
        updated: [],
        task: failedTask
      };
    }
  }

  // ===== 8. 方式 B：宽松自然语言候选筛选与偏好冲突替换 =====
  function isPureGreetingOrFiller(text) {
    var trimmed = String(text || '').trim();
    return /^(?:你好|您好|hi+|hello+|hey|在吗|在不在|早上好|早安|中午好|下午好|晚上好|晚安|谢谢|感谢|多谢|好的|好吧|好呀|好滴|嗯+|嗯嗯|哦+|行|行吧|可以|没问题|收到|明白|知道了|了解|哈哈+|呵呵|ok+|yes|no|bye|再见|拜拜)[！!。.~～\s]*$/i.test(trimmed);
  }

  function isClauseQuestion(cl) {
    var c = String(cl || '').trim();
    if (!c) return true;
    if (/[？?]$/.test(c)) return true;
    var bare = c.replace(/[？?！!。.~～]+$/, '').trim();
    if (/(?:吗|呢|嘛)$/.test(bare)) return true;
    if (/(?:什么|哪个|哪些|哪里|哪儿|谁|几岁|几个|多少|怎么|如何|为什么|为何|是不是|能不能|可不可以|有没有|帮我推荐|推荐一款|推荐个|解释一下|什么是)/.test(bare)) {
      // 若同句带强陈述自述（如“我最喜欢草莓，为什么…”已提前拆句，这里是单句检查），
      // 只在不含第一人称偏好声明时判定为问句
      if (!/(?:我|我的|本人).{0,10}(?:喜欢|最喜欢|爱吃|爱喝|偏好|习惯|计划|打算|决定|正在做|在开发|住在|叫)/.test(bare)) {
        return true;
      }
    }
    return false;
  }

  function isPureQuestionWithoutFact(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return true;
    var clauses = trimmed.split(/[，,。；;！!\n]+/).map(function(s) { return s.trim(); }).filter(Boolean);
    if (!clauses.length) return true;

    for (var i = 0; i < clauses.length; i++) {
      var cl = clauses[i];
      if (!isClauseQuestion(cl) && !isPureGreetingOrFiller(cl) && cl.length >= 3) {
        return false;
      }
    }
    return true;
  }

  function analyzeMemoryCandidate(userText) {
    var text = String(userText || '').trim();
    if (text.length < 3) return { shouldExtract: false, reason: 'too_short' };

    if (containsSensitiveSecret(text)) {
      return { shouldExtract: false, blockedSecret: true, reason: 'sensitive_secret' };
    }

    if (isPureGreetingOrFiller(text)) {
      return { shouldExtract: false, reason: 'greeting_or_filler' };
    }

    if (isPureQuestionWithoutFact(text)) {
      return { shouldExtract: false, reason: 'pure_question' };
    }

    if (detectExplicitMemoryCommand(text).matched) {
      return { shouldExtract: true, reason: 'explicit_save' };
    }

    // 只要不是纯寒暄和纯问句，且达到有效表达长度，就交给模型判断是否有长期价值（不再依赖死板的关键词正则）
    return { shouldExtract: true, reason: 'natural_statement' };
  }

  function shouldAttemptExtraction(userText) {
    return analyzeMemoryCandidate(userText).shouldExtract;
  }

  function extractPreferenceSubjectSlot(content) {
    var src = String(content || '').trim();
    var m = src.match(/(?:最喜欢的|最爱吃的|最爱喝的|最爱的|最常喝的|最常吃的|最常用的|偏好的|喜欢的|爱吃的|爱喝的)([\u4e00-\u9fa5A-Za-z0-9]{1,8}?)(?:现在|目前|其实|已经)?(?:是|为|有|改成|改为|换成)/);
    if (m && m[1]) {
      return 'pref_subject:' + m[1].toLowerCase();
    }
    return '';
  }

  function detectMutualSlot(content, category) {
    var dynSlot = extractPreferenceSubjectSlot(content);
    if (dynSlot) return dynSlot;

    var lower = String(content || '').toLowerCase();
    for (var i = 0; i < MUTUAL_SLOTS.length; i++) {
      var slot = MUTUAL_SLOTS[i];
      if (slot.category && category && category !== slot.category && slot.category !== '身份信息') continue;
      for (var c = 0; c < slot.cues.length; c++) {
        if (lower.indexOf(slot.cues[c]) !== -1) {
          return slot.name;
        }
      }
    }
    return '';
  }

  function findContradictionOrMergeTarget(content, category, sameScopeMemories, rawUserText) {
    var slot = detectMutualSlot(content, category);
    var hasChangeCue = /(?:改成|改为|换成|换喝|改喝|改吃|不再|以前.*现在|转成|其实更喜欢|现在更喜欢)/.test(String(content || '') + ' ' + String(rawUserText || ''));

    if (slot) {
      var slotMatches = sameScopeMemories.filter(function(m) {
        return detectMutualSlot(m.content, m.category) === slot;
      });
      if (slotMatches.length > 0) {
        slotMatches.sort(function(a, b) {
          var sa = computeTextSimilarity(content, a.content);
          var sb = computeTextSimilarity(content, b.content);
          if (Math.abs(sb - sa) > 0.05) return sb - sa;
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        if (
          hasChangeCue ||
          slot.indexOf('pref_subject:') === 0 ||
          slot === 'coffee_drink' ||
          slot === 'user_location' ||
          slot === 'user_name'
        ) {
          return slotMatches[0];
        }
      }
    }

    var bestSim = 0;
    var bestTarget = null;
    for (var j = 0; j < sameScopeMemories.length; j++) {
      var sim = computeTextSimilarity(content, sameScopeMemories[j].content);
      if (sim > bestSim) {
        bestSim = sim;
        if (sim >= 0.62) {
          bestTarget = sameScopeMemories[j];
        }
      }
    }
    return bestTarget;
  }

  async function upsertExtractedMemories(candidates, context) {
    var store = S();
    if (!store) return { added: [], updated: [], skipped: 0, blockedSecrets: 0, blockedDeleted: 0 };

    var ctx = context && typeof context === 'object' ? context : {};
    var userId = String(ctx.userId || 'local_user').trim() || 'local_user';
    var chatId = String(ctx.chatId || '').trim();
    var chatTitle = String(ctx.chatTitle || '').trim();
    var projectId = String(ctx.projectId || '').trim();
    var rawUserText = String(ctx.rawUserText || '');
    var settings = await store.getMemorySettings();
    var params = resolveMemoryParams(settings);
    var maxLen = Math.max(60, Number(ctx.maxSingleMemoryLength) || params.maxSingleMemoryLength);
    var taskCreatedAt = Number(ctx.taskCreatedAt) || Date.now();

    var existingAll = await store.listMemories({ userId: userId });
    var deletedSigs = typeof store.listDeletedMemorySignatures === 'function'
      ? await store.listDeletedMemorySignatures()
      : [];

    var added = [];
    var updated = [];
    var skipped = 0;
    var blockedSecrets = 0;
    var blockedDeleted = 0;

    for (var i = 0; i < (Array.isArray(candidates) ? candidates.length : 0); i++) {
      var rawItem = candidates[i];
      if (!rawItem || typeof rawItem !== 'object') continue;
      if (rawItem.action === 'skip') {
        skipped++;
        continue;
      }

      var content = String(rawItem.content || '').trim();
      if (!content || content.length < 2) {
        skipped++;
        continue;
      }
      if (content.length > maxLen) {
        content = content.slice(0, maxLen);
      }

      if (containsSensitiveSecret(content)) {
        blockedSecrets++;
        continue;
      }

      // 墓碑防复活保护：
      // 1) 任何延迟任务若早于删除时间戳，或普通自动提取命中墓碑，一律拦截；
      // 2) 仅当用户之后主动发出新的明确记忆指令（taskCreatedAt > sig.deletedAt 且 allowOverrideOlderTombstone）才清除旧墓碑允许再次保存。
      var hitSig = findBlockingDeletedSignature(content, deletedSigs);
      if (hitSig) {
        var canOverride = !!(ctx.allowOverrideOlderTombstone && taskCreatedAt > (hitSig.deletedAt || 0));
        if (!canOverride) {
          blockedDeleted++;
          continue;
        }
        if (typeof store.removeDeletedMemorySignatureByContent === 'function') {
          await store.removeDeletedMemorySignatureByContent(hitSig.content || content);
          deletedSigs = await store.listDeletedMemorySignatures();
        }
      }

      var scope = String(rawItem.scope || 'user').toLowerCase();
      if (scope !== 'user' && scope !== 'chat' && scope !== 'project') scope = 'user';
      if (scope === 'project' && !projectId) scope = 'user';

      var category = rawItem.category || '备忘';
      var sameScopeMemories = existingAll.filter(function(m) {
        return m.scope === scope && (scope !== 'project' || m.projectId === projectId);
      });

      var matchedTarget = null;
      if (rawItem.action === 'update' && rawItem.targetId) {
        matchedTarget = sameScopeMemories.find(function(m) { return m.id === rawItem.targetId; }) || null;
      }

      var normNew = normalizeMemoryText(content);
      var exactMatch = sameScopeMemories.find(function(m) {
        return normalizeMemoryText(m.content) === normNew;
      });
      if (exactMatch) {
        skipped++;
        continue;
      }

      if (!matchedTarget) {
        matchedTarget = findContradictionOrMergeTarget(content, category, sameScopeMemories, rawUserText);
      }

      if (matchedTarget) {
        var upd = await store.updateMemory(matchedTarget.id, {
          content: content,
          category: category || matchedTarget.category,
          importance: rawItem.importance != null ? rawItem.importance : matchedTarget.importance,
          sourceChatId: chatId || matchedTarget.sourceChatId,
          sourceChatTitle: chatTitle || matchedTarget.sourceChatTitle
        });
        if (upd) {
          updated.push(upd);
          for (var u = 0; u < existingAll.length; u++) {
            if (existingAll[u].id === upd.id) existingAll[u] = upd;
          }
        }
      } else {
        var created = await store.createMemory({
          content: content,
          category: category,
          importance: rawItem.importance != null ? rawItem.importance : 3,
          scope: scope,
          sourceChatId: chatId,
          sourceChatTitle: chatTitle,
          userId: userId,
          projectId: scope === 'project' ? projectId : ''
        });
        if (created) {
          added.push(created);
          existingAll.unshift(created);
        }
      }
    }

    return {
      added: added,
      updated: updated,
      skipped: skipped,
      blockedSecrets: blockedSecrets,
      blockedDeleted: blockedDeleted
    };
  }

  // 先剥离推理模型的 <think>...</think> 块，再截取平衡括号 JSON
  function stripReasoningThinkTags(raw) {
    var s = String(raw || '').trim();
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
    if (/<think>/i.test(s)) {
      var closeIdx = s.toLowerCase().indexOf('</think>');
      if (closeIdx !== -1) s = s.slice(closeIdx + 8);
      else s = s.replace(/<think>[\s\S]*$/gi, '');
    }
    return s.trim();
  }

  function extractBalancedJsonSlice(src) {
    var text = stripReasoningThinkTags(src);
    if (!text) return '';
    var fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) text = fenced[1].trim();

    var firstBrace = text.indexOf('{');
    var firstBracket = text.indexOf('[');
    var startIdx = -1;
    var openChar = '';
    var closeChar = '';

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      openChar = '{';
      closeChar = '}';
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
      openChar = '[';
      closeChar = ']';
    } else {
      return text;
    }

    var depth = 0;
    var inStr = false;
    var escaped = false;
    for (var i = startIdx; i < text.length; i++) {
      var ch = text.charAt(i);
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inStr) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
    return text.slice(startIdx);
  }

  function parseExtractorJsonObject(rawText) {
    var slice = extractBalancedJsonSlice(rawText);
    if (!slice) return null;
    try {
      return JSON.parse(slice);
    } catch (_) {
      return null;
    }
  }

  function parseExtractorJson(rawText) {
    var slice = extractBalancedJsonSlice(rawText);
    if (!slice) return [];
    var parsed = JSON.parse(slice);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.memories)) return parsed.memories;
    if (parsed && typeof parsed.content === 'string') return [parsed];
    return [];
  }

  async function extractAndSaveFromTurn(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var store = S();
    var ai = AI();
    if (!store || !ai || typeof ai.requestChatCompletion !== 'function') {
      return { added: [], updated: [], skipped: 0, blockedSecrets: 0, blockedDeleted: 0 };
    }

    var settings = await store.getMemorySettings();
    var params = resolveMemoryParams(settings);
    if (!params.useMemory) {
      return { added: [], updated: [], skipped: 0, blockedSecrets: 0, blockedDeleted: 0, disabledReason: 'useMemory_off' };
    }
    if (!opts.ignoreAutoMemoryToggle && !params.autoMemory) {
      return { added: [], updated: [], skipped: 0, blockedSecrets: 0, blockedDeleted: 0, disabledReason: 'autoMemory_off' };
    }

    var userText = String(opts.userText || '').trim();
    var candidateCheck = analyzeMemoryCandidate(userText);
    if (candidateCheck.blockedSecret) {
      return { added: [], updated: [], skipped: 0, blockedSecrets: 1, blockedDeleted: 0 };
    }
    if (!candidateCheck.shouldExtract && !opts.forceExtract) {
      return { added: [], updated: [], skipped: 0, blockedSecrets: 0, blockedDeleted: 0 };
    }

    var userId = String(opts.userId || 'local_user').trim() || 'local_user';
    var existing = await store.listMemories({ userId: userId });
    var existingListText = existing.slice(0, 25).map(function(m) {
      return '- id:' + m.id + ' | [' + m.category + '] ' + m.content;
    }).join('\n') || '（暂无已有记忆）';

    var historyContextText = '';
    if (Array.isArray(opts.historyMessages) && opts.historyMessages.length) {
      historyContextText = '\n【近期上下文（供指代消解）】\n' + opts.historyMessages.slice(-4).map(function(m) {
        return (m.role === 'user' ? '用户' : '助手') + '：' + String(m.content || '').slice(0, 200);
      }).join('\n') + '\n';
    }

    var prompt =
      '你是一个高精度的长期记忆提取器。请从下面这轮对话中判断是否包含值得长期保存给未来新对话复用的用户信息。\n' +
      '只提取以下类型：\n' +
      '- 偏好（饮食水果饮品、工具技术、写作排版风格、兴趣爱好等）\n' +
      '- 习惯（作息、工作学习方式等）\n' +
      '- 长期计划（学习/旅行/出差/成长目标等）\n' +
      '- 项目（正在开发或进行的长期项目名称与背景）\n' +
      '- 决定（重要长期决定）\n' +
      '- 身份信息（用户自报称呼、职业、居住地等）\n' +
      '- 备忘（用户明确要求记住的事项）\n\n' +
      '若仅仅是寒暄（如你好/谢谢）、纯通用知识问答或一次性临时琐事，请输出 {"memories":[]}。\n' +
      '严格禁止保存：密码、API Key、Token、验证码、私钥、银行卡/证件号。\n' +
      '冲突与更新规则（非常重要）：\n' +
      '1) 如果新信息与已有记忆重复，请输出 {"memories":[]}。\n' +
      '2) 如果新信息修正、改口或替代了某条已有记忆（例如最喜欢的水果从草莓改为芒果、饮品从冰美式改为热拿铁、搬家等），必须使用 action="update" 并填写被替代记忆的 targetId！\n\n' +
      '【已有记忆】\n' + existingListText + '\n' +
      historyContextText + '\n' +
      '【本轮用户输入】\n' + userText.slice(0, 1200) + '\n\n' +
      '【本轮助手回复摘要】\n' + String(opts.assistantText || '').slice(0, 500) + '\n\n' +
      '请只输出合法 JSON 对象，不要包含任何多余说明：\n' +
      '{"memories":[{"action":"add","targetId":"","content":"用第三人称简练概括，例如：用户最喜欢的水果是草莓","category":"偏好","importance":4,"scope":"user"}]}';

    var res = await ai.requestChatCompletion({
      apiConfig: opts.apiConfig,
      temperature: 0.1,
      maxTokens: 1200,
      allowReasoningFallback: true,
      messages: [
        { role: 'system', content: '你是只输出纯 JSON 的长期记忆结构化提取器。如果没有值得保存的信息，请输出 {"memories":[]}。' },
        { role: 'user', content: prompt }
      ]
    });

    var rawContent = String((res && res.content) || '').trim();
    if (!rawContent) {
      throw new Error('模型未返回有效的提取结果');
    }
    var candidates = parseExtractorJson(rawContent);
    return await upsertExtractedMemories(candidates, {
      userId: userId,
      chatId: opts.chatId || '',
      chatTitle: opts.chatTitle || '',
      projectId: opts.projectId || '',
      rawUserText: userText,
      maxSingleMemoryLength: params.maxSingleMemoryLength,
      taskCreatedAt: opts.taskCreatedAt || Date.now(),
      allowOverrideOlderTombstone: !!opts.allowOverrideOlderTombstone
    });
  }

  // ===== 9. 持久化后台任务队列（自动提取 + 短期摘要，完整状态流转与真实写入追踪） =====
  async function enqueueTurnMemoryTasks(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var store = S();
    if (!store || typeof store.enqueueMemoryTask !== 'function') return [];

    var settings = await store.getMemorySettings();
    var params = resolveMemoryParams(settings);
    var queued = [];

    if (params.useMemory && params.autoMemory && !opts.skipAutoMemory) {
      var userText = String(opts.userText || '').trim();
      var check = analyzeMemoryCandidate(userText);
      if (check.shouldExtract && !check.blockedSecret) {
        var extTask = await store.enqueueMemoryTask({
          type: 'extract_memory',
          turnKey: 'ext:' + String(opts.chatId || '') + ':' + String(opts.userMsgId || Date.now()),
          chatId: opts.chatId || '',
          chatTitle: opts.chatTitle || '',
          projectId: opts.projectId || '',
          userId: opts.userId || 'local_user',
          status: 'pending',
          memoryWritten: false,
          savedMemoryIds: [],
          payload: {
            userText: userText.slice(0, 1500),
            assistantText: String(opts.assistantText || '').slice(0, 700)
          }
        });
        queued.push(extTask);
      }
    }

    if (params.shortTermContext && opts.chatId && typeof store.getChat === 'function') {
      var chat = await store.getChat(opts.chatId);
      if (needsShortTermSummary(chat, params)) {
        var sumTarget = Math.max(0, chat.messages.length - params.recentRawMessagesLimit);
        var sumTask = await store.enqueueMemoryTask({
          type: 'summarize_chat',
          turnKey: 'sum:' + String(opts.chatId) + ':' + String(sumTarget),
          chatId: opts.chatId,
          chatTitle: chat.title || opts.chatTitle || '',
          projectId: chat.projectId || opts.projectId || '',
          userId: opts.userId || 'local_user',
          status: 'pending',
          memoryWritten: false,
          savedMemoryIds: [],
          payload: { targetUpTo: sumTarget }
        });
        queued.push(sumTask);
      }
    }

    return queued;
  }

  async function processMemoryTaskQueue(apiConfig, options) {
    var store = S();
    if (!store || typeof store.listMemoryTasks !== 'function') {
      return { addedCount: 0, updatedCount: 0, summarizedChats: [], failedTasks: [], processed: 0 };
    }
    if (_queueRunning) {
      _queueRerunRequested = true;
      return { busy: true, addedCount: 0, updatedCount: 0, summarizedChats: [], failedTasks: [], processed: 0 };
    }

    _queueRunning = true;
    var addedCount = 0;
    var updatedCount = 0;
    var summarizedChats = [];
    var failedTasks = [];
    var processed = 0;
    var opts = options && typeof options === 'object' ? options : {};

    try {
      var effectiveApi = apiConfig;
      if (!effectiveApi && AI() && typeof AI().resolveEffectiveApiConfig === 'function') {
        effectiveApi = await AI().resolveEffectiveApiConfig();
      }
      var now = Date.now();
      var tasks = await store.listMemoryTasks();
      var runnable = tasks.filter(function(t) {
        if (!t) return false;
        if (t.status === 'pending' || t.status === 'running') return true;
        if ((t.status === 'retry_waiting' || t.status === 'failed') && (t.attempts || 0) < (t.maxAttempts || 3)) {
          return opts.ignoreBackoff || now >= (t.nextRetryAt || 0);
        }
        return false;
      }).sort(function(a, b) {
        return (a.createdAt || 0) - (b.createdAt || 0);
      });

      for (var i = 0; i < runnable.length; i++) {
        var task = runnable[i];
        await store.updateMemoryTask(task.id, { status: 'running' });

        try {
          if (task.type === 'extract_memory' || task.type === 'explicit_memory') {
            var isExplicitTask = task.type === 'explicit_memory';
            var res = await extractAndSaveFromTurn({
              userText: task.payload && task.payload.userText,
              assistantText: task.payload && task.payload.assistantText,
              chatId: task.chatId,
              chatTitle: task.chatTitle,
              projectId: task.projectId,
              userId: task.userId || 'local_user',
              apiConfig: effectiveApi,
              forceExtract: isExplicitTask,
              ignoreAutoMemoryToggle: isExplicitTask,
              taskCreatedAt: task.createdAt || Date.now(),
              allowOverrideOlderTombstone: false
            });
            var addedList = (res && res.added) || [];
            var updatedList = (res && res.updated) || [];
            var savedIds = addedList.concat(updatedList).map(function(m) { return m && m.id; }).filter(Boolean);
            var aLen = addedList.length;
            var uLen = updatedList.length;
            addedCount += aLen;
            updatedCount += uLen;
            processed++;

            if (aLen > 0 || uLen > 0) {
              await store.updateMemoryTask(task.id, {
                status: 'saved',
                attempts: (task.attempts || 0) + 1,
                memoryWritten: true,
                savedMemoryIds: savedIds,
                lastError: '',
                resultSummary: '新增 ' + aLen + ' 条，更新 ' + uLen + ' 条'
              });
            } else {
              var skipReason = '未提取到可保存信息';
              if (res && res.disabledReason === 'useMemory_off') skipReason = '长期记忆已关闭';
              else if (res && res.disabledReason === 'autoMemory_off') skipReason = '自动记忆已关闭';
              else if (res && res.blockedSecrets) skipReason = '含敏感信息，已安全拦截';
              else if (res && res.blockedDeleted) skipReason = '已删除记忆墓碑拦截，未重新恢复';
              else if (res && res.skipped) skipReason = '与已有记忆重复，已跳过';

              await store.updateMemoryTask(task.id, {
                status: 'skipped',
                attempts: (task.attempts || 0) + 1,
                memoryWritten: false,
                savedMemoryIds: [],
                lastError: '',
                resultSummary: skipReason
              });
            }
          } else if (task.type === 'summarize_chat') {
            var currentSettings = await store.getMemorySettings();
            var updatedChat = await summarizeChatSegment({
              chatId: task.chatId,
              settings: currentSettings,
              apiConfig: effectiveApi,
              allowLocalFallback: false
            });
            processed++;
            if (updatedChat && updatedChat.id) {
              summarizedChats.push(updatedChat);
              await store.updateMemoryTask(task.id, {
                status: 'saved',
                attempts: (task.attempts || 0) + 1,
                memoryWritten: true,
                savedMemoryIds: [],
                lastError: '',
                resultSummary: '已更新至第 ' + updatedChat.summaryUpToCount + ' 条消息摘要'
              });
            } else {
              await store.updateMemoryTask(task.id, {
                status: 'skipped',
                attempts: (task.attempts || 0) + 1,
                memoryWritten: false,
                savedMemoryIds: [],
                lastError: '',
                resultSummary: '无需更新摘要'
              });
            }
          }
        } catch (err) {
          var nextAttempts = (task.attempts || 0) + 1;
          var maxAttempts = task.maxAttempts || 3;
          var willRetry = nextAttempts < maxAttempts;
          var backoffMs = nextAttempts === 1 ? 5000 : (nextAttempts === 2 ? 15000 : 45000);
          var errMsg = sanitizeErrorForLog(err);
          var failedTask = await store.updateMemoryTask(task.id, {
            status: willRetry ? 'retry_waiting' : 'failed',
            attempts: nextAttempts,
            memoryWritten: false,
            lastError: errMsg,
            nextRetryAt: willRetry ? (Date.now() + backoffMs) : 0
          });
          failedTasks.push(failedTask || task);
          console.warn('[AiWorkspaceMemory] task failed:', task.type, errMsg);
        }
      }
    } finally {
      _queueRunning = false;
    }

    if (_queueRerunRequested) {
      _queueRerunRequested = false;
      var follow = await processMemoryTaskQueue(apiConfig, options);
      addedCount += follow.addedCount || 0;
      updatedCount += follow.updatedCount || 0;
      processed += follow.processed || 0;
      if (Array.isArray(follow.summarizedChats)) summarizedChats = summarizedChats.concat(follow.summarizedChats);
      if (Array.isArray(follow.failedTasks)) failedTasks = failedTasks.concat(follow.failedTasks);
    }

    return {
      addedCount: addedCount,
      updatedCount: updatedCount,
      summarizedChats: summarizedChats,
      failedTasks: failedTasks,
      processed: processed
    };
  }

  async function retryFailedMemoryTasks(apiConfig) {
    var store = S();
    if (!store || typeof store.listMemoryTasks !== 'function') {
      return { addedCount: 0, updatedCount: 0, summarizedChats: [], failedTasks: [], processed: 0 };
    }
    var tasks = await store.listMemoryTasks();
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (t && (t.status === 'failed' || t.status === 'retry_waiting')) {
        await store.updateMemoryTask(t.id, {
          status: 'pending',
          nextRetryAt: 0,
          maxAttempts: Math.max((t.maxAttempts || 3), (t.attempts || 0) + 2)
        });
      }
    }
    return await processMemoryTaskQueue(apiConfig, { ignoreBackoff: true });
  }

  global.AiWorkspaceMemory = {
    SHORT_TERM_RECENT_RAW: DEFAULT_RECENT_RAW,
    resolveMemoryParams: resolveMemoryParams,
    containsSensitiveSecret: containsSensitiveSecret,
    normalizeMemoryText: normalizeMemoryText,
    computeTextSimilarity: computeTextSimilarity,
    filterAccessibleMemories: filterAccessibleMemories,
    retrieveRelevantMemories: retrieveRelevantMemories,
    retrieveWorkspaceContext: retrieveWorkspaceContext,
    needsShortTermSummary: needsShortTermSummary,
    summarizeChatSegment: summarizeChatSegment,
    detectExplicitMemoryCommand: detectExplicitMemoryCommand,
    parseDirectExplicitMemoryFact: parseDirectExplicitMemoryFact,
    handleExplicitMemoryCommand: handleExplicitMemoryCommand,
    analyzeMemoryCandidate: analyzeMemoryCandidate,
    shouldAttemptExtraction: shouldAttemptExtraction,
    upsertExtractedMemories: upsertExtractedMemories,
    parseExtractorJson: parseExtractorJson,
    extractAndSaveFromTurn: extractAndSaveFromTurn,
    enqueueTurnMemoryTasks: enqueueTurnMemoryTasks,
    processMemoryTaskQueue: processMemoryTaskQueue,
    retryFailedMemoryTasks: retryFailedMemoryTasks
  };
})(typeof window !== 'undefined' ? window : globalThis);
