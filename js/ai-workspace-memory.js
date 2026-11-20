// ai-workspace-memory.js — 知屿（AI 工作空间）第五阶段全自动三层记忆引擎
// 1) 短期记忆：近期原始消息 + 阈值触发阶段性摘要（当前任务、关键事实、用户要求、未完成事项）
// 2) 跨窗口记忆：用户级长期记忆 + 其他聊天窗口摘要/片段的语义相关性检索（含同义扩展与可选轻量模型召回）
// 3) 长期记忆：宽松自然语言自动识别、去重与偏好冲突更新、敏感秘密拦截、已删除墓碑防复活
// 4) 持久化后台任务队列：防切换聊天/刷新丢失，支持失败记录与重试
(function(global) {
  'use strict';

  var SHORT_TERM_RECENT_RAW = 6;
  var SHORT_TERM_MIN_MESSAGES = 10;
  var SHORT_TERM_MIN_CHARS = 3200;
  var SHORT_TERM_STEP_MESSAGES = 4;
  var SHORT_TERM_STEP_CHARS = 1400;

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

  // 同义词与语义概念簇：解决“开发什么软件”与“正在做知屿 AI 应用”跨词检索断层
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
      name: 'concept_food_diet',
      terms: ['吃饭', '美食', '菜谱', '食谱', '忌口', '过敏', '香菜', '辣', '素食', '早餐', '午餐', '晚餐', '外卖', '餐厅', '爱吃', '不吃', '改吃']
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

  // 互斥槽位：用于检测饮食/居住地/称呼等变更冲突，避免旧记忆和新记忆并存矛盾
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
        // 关闭跨窗口记忆时，拦截来源于其他聊天窗口自动/手动提取的记忆，仅保留本聊天或无来源的全局条目
        if (!allowCrossChat && mem.sourceChatId && mem.sourceChatId !== chatId) {
          return false;
        }
        return true;
      }
      return false;
    });
  }

  function isTextBlockedByDeletedSigs(text, deletedSigs) {
    if (!text || !Array.isArray(deletedSigs) || !deletedSigs.length) return false;
    var norm = normalizeMemoryText(text);
    if (!norm) return false;

    for (var i = 0; i < deletedSigs.length; i++) {
      var sig = deletedSigs[i];
      if (!sig || !sig.norm) continue;
      if (sig.norm === norm) return true;
      if (sig.content && computeTextSimilarity(text, sig.content) >= 0.65) return true;

      // 提取被删记忆中的非泛化核心特征（如“冰美”+“美式”），防止历史消息原文再次唤醒同一事实
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
            return true;
          }
        }
      }
    }
    return false;
  }

  // ===== 4. 相关性评分与跨窗口检索引擎 =====
  function isMetaMemoryQuery(query) {
    var q = String(query || '').toLowerCase();
    return /(?:你记得|还记得|我之前|之前说过|上次说|关于我|了解我|我的偏好|我的喜好|我的习惯|我的计划|我的项目|我的决定|我的忌口|我的目标|适合我|按我的|根据我的|帮我回忆|我最近在|我正在做|我在开发|我平时|我喜欢喝什么|我喜欢吃什么|我爱喝什么|我用什么|我是做什么的)/.test(q);
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
      if (/偏好|喜欢|爱喝|爱吃|忌口|口味/.test(rawQueryLower)) {
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
        // 跳过纯提问，优先提取含事实陈述的历史片段
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

  async function trySemanticRecallWithModel(query, memoryPool, crossPool, apiConfig) {
    var ai = AI();
    if (!ai || typeof ai.requestChatCompletion !== 'function') return { memIds: [], crossIds: [] };
    if (!apiConfig || !apiConfig.url || !apiConfig.key || !apiConfig.model) return { memIds: [], crossIds: [] };

    var items = [];
    memoryPool.slice(0, 12).forEach(function(m) {
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
        maxTokens: 160,
        messages: [
          {
            role: 'system',
            content: '你是记忆相关性筛选器。从候选列表中挑出与用户当前提问真正相关的条目 ID。绝不挑选无关条目。只输出 JSON：{"ids":[]}'
          },
          {
            role: 'user',
            content: '当前问题：' + query.slice(0, 300) + '\n\n候选列表：\n' + listText + '\n\n请只返回最相关的条目 ID（最多 4 个），例如 {"ids":["mem_1"]}；如均不相关返回 {"ids":[]}。'
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

  // ===== 5. 短期记忆阶段性摘要（全自动，不重复堆叠历史） =====
  function getHistoryCharLength(messages) {
    var total = 0;
    for (var i = 0; i < (Array.isArray(messages) ? messages.length : 0); i++) {
      total += String((messages[i] && messages[i].content) || '').length;
    }
    return total;
  }

  function needsShortTermSummary(chat) {
    if (!chat || !Array.isArray(chat.messages)) return false;
    var msgs = chat.messages.filter(function(m) {
      return m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim();
    });
    if (msgs.length <= SHORT_TERM_RECENT_RAW) return false;

    var targetUpTo = msgs.length - SHORT_TERM_RECENT_RAW;
    var alreadyUpTo = Math.max(0, Number(chat.summaryUpToCount) || 0);
    if (targetUpTo <= alreadyUpTo) return false;

    var totalChars = getHistoryCharLength(msgs);
    if (msgs.length < SHORT_TERM_MIN_MESSAGES && totalChars < SHORT_TERM_MIN_CHARS) {
      return false;
    }

    var deltaMsgs = msgs.slice(alreadyUpTo, targetUpTo);
    var deltaChars = getHistoryCharLength(deltaMsgs);
    if (deltaMsgs.length >= SHORT_TERM_STEP_MESSAGES || deltaChars >= SHORT_TERM_STEP_CHARS) {
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

    var chat = await store.getChat(opts.chatId);
    if (!chat || !Array.isArray(chat.messages)) return null;

    var cleanMsgs = chat.messages.filter(function(m) {
      return m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim();
    });
    var targetUpTo = Math.max(0, cleanMsgs.length - SHORT_TERM_RECENT_RAW);
    var prevUpTo = Math.max(0, Number(chat.summaryUpToCount) || 0);
    if (targetUpTo <= prevUpTo) return chat;

    var deltaMsgs = cleanMsgs.slice(prevUpTo, targetUpTo);
    if (!deltaMsgs.length) return chat;

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
          maxTokens: 420,
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
        nextSummary = String((res && res.content) || '').trim();
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
    var emptyResult = {
      memories: [],
      crossChatContexts: [],
      shortTermSummary: '',
      summaryUpToCount: 0,
      useShortTermHistory: true,
      maxRecentMessages: 14,
      settings: { shortTermContext: true, crossChatMemory: true, useMemory: true, autoMemory: true }
    };
    if (!store) return emptyResult;

    var settings = await store.getMemorySettings();
    emptyResult.settings = settings;

    var activeChat = opts.activeChat || null;
    var historyMessages = Array.isArray(opts.historyMessages) ? opts.historyMessages : [];
    var shortTermEnabled = settings.shortTermContext !== false;

    if (!shortTermEnabled) {
      emptyResult.useShortTermHistory = false;
      emptyResult.shortTermSummary = '';
      emptyResult.summaryUpToCount = 0;
      emptyResult.maxRecentMessages = 0;
    } else if (activeChat) {
      emptyResult.useShortTermHistory = true;
      emptyResult.shortTermSummary = String(activeChat.summary || '').trim();
      emptyResult.summaryUpToCount = Math.max(0, Number(activeChat.summaryUpToCount) || 0);
      emptyResult.maxRecentMessages = 14;
    }

    var query = String(opts.query || '').trim();
    if (!query) return emptyResult;

    var userId = String(opts.userId || 'local_user').trim() || 'local_user';
    var chatId = String(opts.chatId || (activeChat && activeChat.id) || '').trim();
    var projectId = String(opts.projectId || (activeChat && activeChat.projectId) || '').trim();
    var allowCrossChat = settings.crossChatMemory !== false;

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
    if (settings.useMemory && typeof store.listMemories === 'function') {
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
    var maxResults = Math.max(1, Math.min(8, Number(opts.maxResults) || 5));
    var maxChars = Math.max(200, Number(opts.maxChars) || 900);
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
    if (allowCrossChat) {
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
      var usedCrossChars = 0;
      for (var k = 0; k < scoredCross.length && chosenCross.length < 3; k++) {
        var cItem = scoredCross[k].item;
        if (usedCrossChars + cItem.content.length > 600 && chosenCross.length > 0) continue;
        chosenCross.push(cItem);
        usedCrossChars += cItem.content.length;
      }
    }

    // 语义兜底：当问题像个人上下文/跨窗口询问、词面与概念簇未命中、且候选池存在数据时，尝试一次轻量模型相关性挑选
    if (
      chosenMemories.length === 0 &&
      chosenCross.length === 0 &&
      looksPersonalOrContextualQuery(query) &&
      (accessibleMemories.length > 0 || crossCandidates.length > 0) &&
      opts.apiConfig
    ) {
      var semanticPicked = await trySemanticRecallWithModel(query, accessibleMemories, crossCandidates, opts.apiConfig);
      if (semanticPicked.memIds.length) {
        semanticPicked.memIds.forEach(function(id) {
          var foundM = accessibleMemories.find(function(m) { return m.id === id; });
          if (foundM && chosenMemories.length < maxResults) chosenMemories.push(foundM);
        });
      }
      if (semanticPicked.crossIds.length) {
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

  // ===== 7. 自动记忆候选识别、冲突替换、墓碑拦截与去重写入 =====
  function isPureQuestionWithoutFact(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return true;
    var clauses = trimmed.split(/[，。；！!\n]+/).map(function(s) { return s.trim(); }).filter(Boolean);
    if (!clauses.length) return true;

    var hasDeclarativeFactClause = false;
    for (var i = 0; i < clauses.length; i++) {
      var cl = clauses[i];
      var isQuestionClause = /[？?]$/.test(cl) || /(?:什么|哪个|哪些|哪里|谁|几|怎么|如何|为什么|吗|呢)$/.test(cl.replace(/[？?]+$/, ''));
      if (!isQuestionClause) {
        if (/(?:我|我们|本人|以后|今后).{0,10}(?:喜欢|爱喝|爱吃|偏好|习惯|讨厌|不吃|不喝|忌口|过敏|改喝|改吃|改成|换成|不再|打算|计划|准备|决定|正在|在开发|在做|在学|用|叫|名字|住|养)/.test(cl) ||
            /(?:记住|记一下|记下来|别忘了|不要忘了|帮我记)/.test(cl)) {
          hasDeclarativeFactClause = true;
          break;
        }
      }
    }
    return !hasDeclarativeFactClause && (/[？?]/.test(trimmed) || /(?:推荐一款|推荐个|是什么|怎么做|如何理解)/.test(trimmed));
  }

  function analyzeMemoryCandidate(userText) {
    var text = String(userText || '').trim();
    if (text.length < 4) return { shouldExtract: false, reason: 'too_short' };

    if (containsSensitiveSecret(text)) {
      return { shouldExtract: false, blockedSecret: true, reason: 'sensitive_secret' };
    }

    if (isPureQuestionWithoutFact(text)) {
      return { shouldExtract: false, reason: 'pure_question' };
    }

    // 显式记住要求
    if (/(?:记住|记一下|记下来|别忘了|不要忘了|帮我记|以后都|从今以后|从现在开始)/.test(text)) {
      return { shouldExtract: true, reason: 'explicit_save' };
    }

    // 自然语言第一人称偏好、习惯、计划、项目、决定、身份与偏好变更（兼容“我特别喜欢”“我正在开发”“我改成喝…”）
    if (/(?:^|[，。；\s])(?:我|我们|本人|目前|最近|其实).{0,12}(?:喜欢|爱喝|爱吃|常喝|常吃|偏好|习惯|通常|一般|每天|讨厌|不喜欢|不吃|不喝|忌口|过敏|改喝|改吃|改成|换成|不再|打算|计划|准备|决定|确定选择|正在|在开发|在做|在学|在写|负责|用的|常用|叫|名字|我是做|职业|住在|来自|养了|目标)/.test(text)) {
      return { shouldExtract: true, reason: 'personal_fact' };
    }

    // 对 AI 回复方式的明确长期约束
    if (/(?:以后|今后|之后|每次回答|跟我对话).{0,10}(?:用|简短|详细|分点|清单|列表|中文|英文|先给结论)/.test(text)) {
      return { shouldExtract: true, reason: 'response_preference' };
    }

    // 较长且包含个人背景或行动计划的语句
    if (text.length >= 26 && /(?:我|我们)/.test(text) && /(?:喜欢|习惯|计划|项目|开发|设计|决定|偏好|目标|风格|工作|学习|出差|旅游)/.test(text)) {
      return { shouldExtract: true, reason: 'long_personal_context' };
    }

    return { shouldExtract: false, reason: 'chatter_or_factual_qa' };
  }

  function shouldAttemptExtraction(userText) {
    return analyzeMemoryCandidate(userText).shouldExtract;
  }

  function detectMutualSlot(content, category) {
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
    var hasChangeCue = /(?:改成|改为|换成|换喝|改喝|改吃|不再|以前.*现在|转成)/.test(String(content || '') + ' ' + String(rawUserText || ''));

    if (slot) {
      var slotMatches = sameScopeMemories.filter(function(m) {
        return detectMutualSlot(m.content, m.category) === slot;
      });
      if (slotMatches.length > 0) {
        // 同槽位存在多条时，优先按相似度/最近更新匹配，避免错改
        slotMatches.sort(function(a, b) {
          var sa = computeTextSimilarity(content, a.content);
          var sb = computeTextSimilarity(content, b.content);
          if (Math.abs(sb - sa) > 0.05) return sb - sa;
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        // 对于明确的单值槽位（咖啡偏好变更、居住地、称呼）直接合并替换
        if (hasChangeCue || slot === 'coffee_drink' || slot === 'user_location' || slot === 'user_name') {
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
      if (content.length > 260) {
        content = content.slice(0, 260);
      }

      if (containsSensitiveSecret(content)) {
        blockedSecrets++;
        continue;
      }

      // 若命中用户已删除的记忆墓碑，则阻止重新保存（除非用户手动重新新增）
      if (isTextBlockedByDeletedSigs(content, deletedSigs)) {
        blockedDeleted++;
        continue;
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

  // 平衡括号截取 JSON，避免模型在 JSON 后附带多余说明导致 JSON.parse 崩溃
  function extractBalancedJsonSlice(src) {
    var text = String(src || '').trim();
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
    return [];
  }

  async function extractAndSaveFromTurn(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var store = S();
    var ai = AI();
    if (!store || !ai || typeof ai.requestChatCompletion !== 'function') {
      return { added: [], updated: [], skipped: 0, blockedSecrets: 0 };
    }

    var settings = await store.getMemorySettings();
    if (!settings || !settings.autoMemory) {
      return { added: [], updated: [], skipped: 0, blockedSecrets: 0 };
    }

    var userText = String(opts.userText || '').trim();
    var candidateCheck = analyzeMemoryCandidate(userText);
    if (candidateCheck.blockedSecret) {
      return { added: [], updated: [], skipped: 0, blockedSecrets: 1 };
    }
    if (!candidateCheck.shouldExtract && !opts.forceExtract) {
      return { added: [], updated: [], skipped: 0, blockedSecrets: 0 };
    }

    var userId = String(opts.userId || 'local_user').trim() || 'local_user';
    var existing = await store.listMemories({ userId: userId });
    var existingListText = existing.slice(0, 25).map(function(m) {
      return '- id:' + m.id + ' | [' + m.category + '] ' + m.content;
    }).join('\n') || '（暂无已有记忆）';

    var prompt =
      '你是一个高精度的长期记忆提取器。请从下面这轮对话中判断是否包含值得长期保存给未来新对话复用的用户信息。\n' +
      '只提取以下类型：\n' +
      '- 偏好（饮食饮品、工具技术、写作排版风格等）\n' +
      '- 习惯（作息、工作学习方式等）\n' +
      '- 长期计划（学习/旅行/成长目标等）\n' +
      '- 项目（正在开发或进行的长期项目名称与背景）\n' +
      '- 决定（重要长期决定）\n' +
      '- 身份信息（用户自报称呼、职业、居住地等）\n' +
      '- 备忘（用户明确要求记住的事项）\n\n' +
      '严格禁止保存：密码、API Key、Token、验证码、私钥、银行卡/证件号、临时寒暄或一次性的普通问答。\n' +
      '冲突与更新规则（非常重要）：\n' +
      '1) 如果新信息与已有记忆重复，请跳过。\n' +
      '2) 如果新信息修正、改口或替代了某条已有记忆（例如饮品偏好从冰美式改为热拿铁、项目进度变化、搬家等），必须使用 action="update" 并填写被替代记忆的 targetId！\n\n' +
      '【已有记忆】\n' + existingListText + '\n\n' +
      '【本轮用户输入】\n' + userText.slice(0, 1200) + '\n\n' +
      '【本轮助手回复摘要】\n' + String(opts.assistantText || '').slice(0, 500) + '\n\n' +
      '请只输出合法 JSON 对象，不要包含任何多余说明：\n' +
      '{"memories":[{"action":"add","targetId":"","content":"用第三人称简练概括，例如：用户喜欢喝冰美式咖啡","category":"偏好","importance":4,"scope":"user"}]}';

    var res = await ai.requestChatCompletion({
      apiConfig: opts.apiConfig,
      temperature: 0.1,
      maxTokens: 500,
      messages: [
        { role: 'system', content: '你是只输出纯 JSON 的长期记忆结构化提取器。如果没有值得保存的信息，请输出 {"memories":[]}。' },
        { role: 'user', content: prompt }
      ]
    });

    var candidates = parseExtractorJson(res && res.content);
    return await upsertExtractedMemories(candidates, {
      userId: userId,
      chatId: opts.chatId || '',
      chatTitle: opts.chatTitle || '',
      projectId: opts.projectId || '',
      rawUserText: userText
    });
  }

  // ===== 8. 持久化后台任务队列（自动提取 + 短期摘要，防切换/刷新丢失并支持失败重试） =====
  async function enqueueTurnMemoryTasks(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var store = S();
    if (!store || typeof store.enqueueMemoryTask !== 'function') return [];

    var settings = await store.getMemorySettings();
    var queued = [];

    if (settings.autoMemory && !opts.skipAutoMemory) {
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
          payload: {
            userText: userText.slice(0, 1500),
            assistantText: String(opts.assistantText || '').slice(0, 700)
          }
        });
        queued.push(extTask);
      }
    }

    if (settings.shortTermContext !== false && opts.chatId && typeof store.getChat === 'function') {
      var chat = await store.getChat(opts.chatId);
      if (needsShortTermSummary(chat)) {
        var sumTarget = Math.max(0, chat.messages.length - SHORT_TERM_RECENT_RAW);
        var sumTask = await store.enqueueMemoryTask({
          type: 'summarize_chat',
          turnKey: 'sum:' + String(opts.chatId) + ':' + String(sumTarget),
          chatId: opts.chatId,
          chatTitle: chat.title || opts.chatTitle || '',
          projectId: chat.projectId || opts.projectId || '',
          userId: opts.userId || 'local_user',
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
      // 按创建时间升序处理
      var runnable = tasks.filter(function(t) {
        if (!t) return false;
        if (t.status === 'pending' || t.status === 'running') return true;
        if (t.status === 'failed' && (t.attempts || 0) < (t.maxAttempts || 3)) {
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
          if (task.type === 'extract_memory') {
            var res = await extractAndSaveFromTurn({
              userText: task.payload && task.payload.userText,
              assistantText: task.payload && task.payload.assistantText,
              chatId: task.chatId,
              chatTitle: task.chatTitle,
              projectId: task.projectId,
              userId: task.userId || 'local_user',
              apiConfig: effectiveApi
            });
            var aLen = res && res.added ? res.added.length : 0;
            var uLen = res && res.updated ? res.updated.length : 0;
            addedCount += aLen;
            updatedCount += uLen;
            processed++;
            await store.updateMemoryTask(task.id, {
              status: 'done',
              attempts: (task.attempts || 0) + 1,
              lastError: '',
              resultSummary: (aLen || uLen) ? ('新增 ' + aLen + ' 条，更新 ' + uLen + ' 条') : '无需新增'
            });
          } else if (task.type === 'summarize_chat') {
            var updatedChat = await summarizeChatSegment({
              chatId: task.chatId,
              apiConfig: effectiveApi,
              allowLocalFallback: false
            });
            processed++;
            if (updatedChat && updatedChat.id) summarizedChats.push(updatedChat);
            await store.updateMemoryTask(task.id, {
              status: 'done',
              attempts: (task.attempts || 0) + 1,
              lastError: '',
              resultSummary: updatedChat ? ('已更新至第 ' + updatedChat.summaryUpToCount + ' 条消息摘要') : '无需更新'
            });
          }
        } catch (err) {
          var nextAttempts = (task.attempts || 0) + 1;
          var backoffMs = nextAttempts === 1 ? 5000 : (nextAttempts === 2 ? 15000 : 45000);
          var errMsg = (err && err.message) ? err.message : '记忆任务执行失败';
          var failedTask = await store.updateMemoryTask(task.id, {
            status: 'failed',
            attempts: nextAttempts,
            lastError: errMsg.slice(0, 200),
            nextRetryAt: Date.now() + backoffMs
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
      if (t && t.status === 'failed') {
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
    SHORT_TERM_RECENT_RAW: SHORT_TERM_RECENT_RAW,
    containsSensitiveSecret: containsSensitiveSecret,
    normalizeMemoryText: normalizeMemoryText,
    computeTextSimilarity: computeTextSimilarity,
    filterAccessibleMemories: filterAccessibleMemories,
    retrieveRelevantMemories: retrieveRelevantMemories,
    retrieveWorkspaceContext: retrieveWorkspaceContext,
    needsShortTermSummary: needsShortTermSummary,
    summarizeChatSegment: summarizeChatSegment,
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
