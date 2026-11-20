// ai-workspace-memory.js — 知屿（AI 工作空间）第五阶段：长期记忆引擎（跨窗口共享、敏感信息过滤、相关性检索与自动去重提取）
(function(global) {
  'use strict';

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
    '用户', '喜欢', '习惯', '比较', '非常', '还是', '已经', '以后', '之后'
  ]);

  var DOMAIN_BUCKETS = [
    {
      name: 'drink',
      cues: ['喝', '茶', '咖啡', '奶茶', '饮品', '饮料', '拿铁', '美式', '果汁', '牛奶', '豆浆', '可乐', '气泡水', '微糖', '无糖', '不加糖', '加冰', '去冰']
    },
    {
      name: 'food',
      cues: ['吃', '菜', '餐', '饭', '面', '肉', '鱼', '汤', '甜', '辣', '酸', '咸', '苦', '忌口', '过敏', '素食', '早餐', '午餐', '晚餐', '夜宵', '外卖', '餐厅', '做饭', '食谱', '菜谱', '口味', '香菜', '葱', '蒜', '折耳根']
    },
    {
      name: 'coding',
      cues: ['代码', '编程', '开发', '项目', '架构', '前端', '后端', '全栈', '接口', '数据库', '部署', '测试', '调试', 'bug', 'typescript', 'javascript', 'react', 'vue', 'python', 'node', 'css', 'html', 'sql', 'git', 'github']
    },
    {
      name: 'schedule',
      cues: ['计划', '规划', '安排', '日程', '周末', '假期', '旅行', '旅游', '出差', '航班', '酒店', '早睡', '早起', '作息', '锻炼', '运动', '健身', '跑步', '时间']
    },
    {
      name: 'study',
      cues: ['学习', '复习', '考试', '考研', '考公', '英语', '日语', '单词', '阅读', '书', '读书', '笔记', '论文', '写作', '作业', '课程']
    },
    {
      name: 'style',
      cues: ['排版', '格式', '风格', '语气', '简短', '详细', '英文', '中文', '双语', '结论', '清单', '列表', '称呼', '名字']
    }
  ];

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

    // 常见 API Key / Token / 私钥格式
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

    // 密码、口令、验证码、密钥等显式秘密表达
    var secretPhrasePatterns = [
      /(?:密码|口令|交易密码|支付密码|登录密码|开机密码|wifi密码|pin\s*码|验证码|校验码|动态码|授权码|安全码|私钥|密钥|秘钥|api\s*key|secret\s*key|access\s*token|password|passcode|otp)\s*(?:是|为|[:：=]|设成|设为|改为)\s*\S+/i,
      /(?:记住|保存|记下|写下)[^。\n]{0,12}(?:密码|口令|验证码|api\s*key|私钥|密钥|秘钥|token|passcode)/i,
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
      .replace(/[\s，。！？、；：“”"'‘’（）()【】\[\],.!?;:~`]+/g, '')
      .trim();
  }

  function extractSearchFeatures(text) {
    var src = String(text || '').toLowerCase();
    var terms = new Set();
    var enTerms = new Set();
    var zhChars = new Set();
    var bigrams = new Set();

    // 英文/数字词
    var enMatches = src.match(/[a-z0-9_+#.-]{2,}/g) || [];
    for (var i = 0; i < enMatches.length; i++) {
      var w = enMatches[i];
      if (!STOP_WORDS_EN.has(w)) {
        terms.add(w);
        enTerms.add(w);
      }
    }

    // 中文连续片段
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

    var domains = new Set();
    for (var d = 0; d < DOMAIN_BUCKETS.length; d++) {
      var bucket = DOMAIN_BUCKETS[d];
      for (var c = 0; c < bucket.cues.length; c++) {
        if (src.indexOf(bucket.cues[c]) !== -1) {
          domains.add(bucket.name);
          break;
        }
      }
    }

    return {
      terms: terms,
      enTerms: enTerms,
      zhChars: zhChars,
      bigrams: bigrams,
      domains: domains
    };
  }

  function computeTextSimilarity(textA, textB) {
    var normA = normalizeMemoryText(textA);
    var normB = normalizeMemoryText(textB);
    if (!normA || !normB) return 0;
    if (normA === normB) return 1;

    // 较短子串高度包含且长度接近时判为高相似
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

  // ===== 3. 作用域与权限过滤（确保绝不混入无权限项目或其他用户记忆） =====
  function filterAccessibleMemories(memories, context) {
    var ctx = context && typeof context === 'object' ? context : {};
    var userId = String(ctx.userId || 'local_user').trim() || 'local_user';
    var chatId = String(ctx.chatId || '').trim();
    var projectId = String(ctx.projectId || '').trim();

    return (Array.isArray(memories) ? memories : []).filter(function(mem) {
      if (!mem || !mem.content) return false;
      var memUserId = String(mem.userId || 'local_user').trim() || 'local_user';
      if (memUserId !== userId) return false;

      var scope = String(mem.scope || 'user').toLowerCase();
      if (scope === 'user') return true;
      if (scope === 'chat') {
        return !!(chatId && mem.sourceChatId && mem.sourceChatId === chatId);
      }
      if (scope === 'project') {
        return !!(projectId && mem.projectId && mem.projectId === projectId);
      }
      return false;
    });
  }

  // ===== 4. 相关性检索引擎（零额外 API 成本，严格过滤无关记忆） =====
  function isMetaMemoryQuery(query) {
    var q = String(query || '').toLowerCase();
    return /(?:你记得|还记得|我之前|之前说过|关于我|了解我|我的偏好|我的喜好|我的习惯|我的计划|我的项目|我的决定|我的忌口|我的目标|适合我|按我的|根据我的|帮我回忆)/.test(q);
  }

  function scoreMemoryRelevance(memory, queryFeatures, metaRecall, rawQueryLower) {
    var memText = String(memory.content || '');
    var memFeatures = extractSearchFeatures(memText + ' ' + String(memory.category || ''));

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

    var domainHits = 0;
    queryFeatures.domains.forEach(function(dom) {
      if (memFeatures.domains.has(dom)) domainHits++;
    });

    var score = 0;
    score += specificBigramHits * 3.2;
    score += genericBigramHits * 0.35;
    score += enTermHits * 1.8;
    score += zhCharHits * 0.35;
    score += domainHits * 1.65;

    // 显式询问个人偏好/记忆时，按类别精准加权
    if (metaRecall) {
      var cat = String(memory.category || '');
      if (rawQueryLower.indexOf('偏好') !== -1 || rawQueryLower.indexOf('喜欢') !== -1 || rawQueryLower.indexOf('喜好') !== -1 || rawQueryLower.indexOf('忌口') !== -1) {
        if (cat === '偏好') score += 3.5;
      } else if (rawQueryLower.indexOf('习惯') !== -1) {
        if (cat === '习惯') score += 3.5;
      } else if (rawQueryLower.indexOf('计划') !== -1 || rawQueryLower.indexOf('目标') !== -1) {
        if (cat === '长期计划') score += 3.5;
      } else if (rawQueryLower.indexOf('项目') !== -1) {
        if (cat === '项目') score += 3.5;
      } else if (rawQueryLower.indexOf('决定') !== -1) {
        if (cat === '决定') score += 3.5;
      } else if (specificBigramHits === 0 && enTermHits === 0 && domainHits === 0) {
        // 泛问“你记得我什么/关于我你知道什么”时，给重要度较高的用户级记忆基础分
        if (memory.scope === 'user' && (memory.importance || 3) >= 3) {
          score += 2.2;
        }
      }
    }

    // 仅当存在相关性信号时，重要度与时间新鲜度才作为排序微调，不让无关记忆混入
    if (score > 0) {
      score += ((Number(memory.importance) || 3) - 3) * 0.25;
      if (memory.scope === 'chat') score += 0.3;
    }

    return {
      score: score,
      hasLexicalOrDomainMatch: (specificBigramHits > 0 || enTermHits > 0 || domainHits > 0)
    };
  }

  async function retrieveRelevantMemories(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var store = S();
    if (!store || typeof store.listMemories !== 'function') return [];

    var settings = await store.getMemorySettings();
    if (!settings || !settings.useMemory) {
      return [];
    }

    var query = String(opts.query || '').trim();
    if (!query) return [];

    var allMemories = await store.listMemories();
    var accessible = filterAccessibleMemories(allMemories, {
      userId: opts.userId || 'local_user',
      chatId: opts.chatId || '',
      projectId: opts.projectId || ''
    });
    if (!accessible.length) return [];

    var maxResults = Math.max(1, Math.min(8, Number(opts.maxResults) || 5));
    var maxChars = Math.max(200, Number(opts.maxChars) || 800);
    var metaRecall = isMetaMemoryQuery(query);
    var rawQueryLower = query.toLowerCase();

    // 若当前问题较短且含指代，适度补充上一条用户提问的特征，但以当前问题为主
    var searchSource = query;
    if (query.length <= 14 && Array.isArray(opts.historyMessages) && opts.historyMessages.length > 0) {
      for (var hi = opts.historyMessages.length - 1; hi >= 0; hi--) {
        if (opts.historyMessages[hi] && opts.historyMessages[hi].role === 'user' && opts.historyMessages[hi].content) {
          searchSource += ' ' + String(opts.historyMessages[hi].content).slice(0, 80);
          break;
        }
      }
    }

    var queryFeatures = extractSearchFeatures(searchSource);
    var minScore = metaRecall ? 2.0 : 2.6;

    var scored = [];
    for (var i = 0; i < accessible.length; i++) {
      var mem = accessible[i];
      var res = scoreMemoryRelevance(mem, queryFeatures, metaRecall, rawQueryLower);
      if (res.score >= minScore && (metaRecall || res.hasLexicalOrDomainMatch)) {
        scored.push({
          memory: mem,
          score: res.score
        });
      }
    }

    scored.sort(function(a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (b.memory.updatedAt || 0) - (a.memory.updatedAt || 0);
    });

    var chosen = [];
    var usedChars = 0;
    for (var j = 0; j < scored.length && chosen.length < maxResults; j++) {
      var item = scored[j].memory;
      var len = String(item.content || '').length + 12;
      if (chosen.length > 0 && usedChars + len > maxChars) continue;
      chosen.push(item);
      usedChars += len;
    }

    return chosen;
  }

  // ===== 5. 自动记忆触发预判与去重写入 =====
  function shouldAttemptExtraction(userText) {
    var text = String(userText || '').trim();
    if (text.length < 4) return false;

    // 显式要求记住
    if (/(?:记住|记一下|记下来|别忘了|不要忘了|帮我记|以后都|从今以后|从现在开始)/.test(text)) {
      return true;
    }

    // 偏好、习惯、计划、项目、决定、身份线索
    if (/(?:我喜欢|我不喜欢|我讨厌|我爱吃|我不吃|我忌口|我过敏|我偏好|我习惯|我通常|我一般|我每天|我的习惯|我的作息|我的计划|长期计划|我打算|我准备|我正在做|我在做|我的项目|我决定|已经决定|确定选择|我叫|我的名字|我是做|我的职业|我住在)/.test(text)) {
      return true;
    }

    // 较长且包含第一人称表达的对话
    if (text.length >= 28 && /(?:我|我们)/.test(text) && /(?:喜欢|习惯|计划|项目|决定|偏好|需要|目标|风格|工作|学习)/.test(text)) {
      return true;
    }

    return false;
  }

  async function upsertExtractedMemories(candidates, context) {
    var store = S();
    if (!store) return { added: [], updated: [], skipped: 0, blockedSecrets: 0 };

    var ctx = context && typeof context === 'object' ? context : {};
    var userId = String(ctx.userId || 'local_user').trim() || 'local_user';
    var chatId = String(ctx.chatId || '').trim();
    var chatTitle = String(ctx.chatTitle || '').trim();
    var projectId = String(ctx.projectId || '').trim();

    var existingAll = await store.listMemories({ userId: userId });
    var added = [];
    var updated = [];
    var skipped = 0;
    var blockedSecrets = 0;

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

      var scope = String(rawItem.scope || 'user').toLowerCase();
      if (scope !== 'user' && scope !== 'chat' && scope !== 'project') scope = 'user';
      if (scope === 'project' && !projectId) scope = 'user';

      var sameScopeMemories = existingAll.filter(function(m) {
        return m.scope === scope && (scope !== 'project' || m.projectId === projectId);
      });

      // 1) 若模型显式指定更新某条 ID
      var matchedTarget = null;
      if (rawItem.action === 'update' && rawItem.targetId) {
        matchedTarget = sameScopeMemories.find(function(m) { return m.id === rawItem.targetId; }) || null;
      }

      // 2) 检查精确重复或高相似记忆
      var normNew = normalizeMemoryText(content);
      var exactMatch = sameScopeMemories.find(function(m) {
        return normalizeMemoryText(m.content) === normNew;
      });
      if (exactMatch) {
        skipped++;
        continue;
      }

      if (!matchedTarget) {
        var bestSim = 0;
        for (var j = 0; j < sameScopeMemories.length; j++) {
          var sim = computeTextSimilarity(content, sameScopeMemories[j].content);
          if (sim > bestSim) {
            bestSim = sim;
            if (sim >= 0.62) {
              matchedTarget = sameScopeMemories[j];
            }
          }
        }
      }

      if (matchedTarget) {
        var upd = await store.updateMemory(matchedTarget.id, {
          content: content,
          category: rawItem.category || matchedTarget.category,
          importance: rawItem.importance != null ? rawItem.importance : matchedTarget.importance,
          sourceChatId: chatId || matchedTarget.sourceChatId,
          sourceChatTitle: chatTitle || matchedTarget.sourceChatTitle
        });
        if (upd) {
          updated.push(upd);
          // 同步内存快照以便同批后续条目的去重
          for (var u = 0; u < existingAll.length; u++) {
            if (existingAll[u].id === upd.id) existingAll[u] = upd;
          }
        }
      } else {
        var created = await store.createMemory({
          content: content,
          category: rawItem.category || '备忘',
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
      blockedSecrets: blockedSecrets
    };
  }

  function parseExtractorJson(rawText) {
    var text = String(rawText || '').trim();
    if (!text) return [];
    var fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) text = fenced[1].trim();
    var firstBrace = text.indexOf('{');
    var firstBracket = text.indexOf('[');
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      text = text.slice(firstBrace);
    } else if (firstBracket !== -1) {
      text = text.slice(firstBracket);
    }
    var parsed = JSON.parse(text);
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

    try {
      var settings = await store.getMemorySettings();
      if (!settings || !settings.autoMemory) {
        return { added: [], updated: [], skipped: 0, blockedSecrets: 0 };
      }

      var userText = String(opts.userText || '').trim();
      if (!shouldAttemptExtraction(userText)) {
        return { added: [], updated: [], skipped: 0, blockedSecrets: 0 };
      }

      // 若用户输入包含敏感信息，阻止整段直接入库，仅做安全提示与过滤
      if (containsSensitiveSecret(userText)) {
        return { added: [], updated: [], skipped: 0, blockedSecrets: 1 };
      }

      var userId = String(opts.userId || 'local_user').trim() || 'local_user';
      var existing = await store.listMemories({ userId: userId });
      var existingListText = existing.slice(0, 20).map(function(m) {
        return '- id:' + m.id + ' | [' + m.category + '] ' + m.content;
      }).join('\n') || '（暂无已有记忆）';

      var prompt =
        '你是一个高精度的长期记忆提取器。请从下面这轮对话中判断是否包含值得长期保存给未来新对话复用的用户信息。\n' +
        '只提取以下类型：\n' +
        '- 偏好（饮食、风格、工具、表达方式等）\n' +
        '- 习惯（作息、工作学习方式等）\n' +
        '- 长期计划（学习/旅行/成长目标等）\n' +
        '- 项目（正在进行的长期项目背景）\n' +
        '- 决定（重要长期决定）\n' +
        '- 身份信息（用户自报称呼、职业背景等）\n' +
        '- 备忘（用户明确要求记住的事项）\n\n' +
        '严格禁止保存：密码、API Key、Token、验证码、私钥、银行卡/证件号、临时寒暄或一次性的普通问答。\n' +
        '如果新信息与已有记忆重复，请跳过；如果新信息修正/更新了某条已有记忆，请使用 action="update" 并填写 targetId。\n\n' +
        '【已有记忆】\n' + existingListText + '\n\n' +
        '【本轮用户输入】\n' + userText.slice(0, 1200) + '\n\n' +
        '【本轮助手回复摘要】\n' + String(opts.assistantText || '').slice(0, 500) + '\n\n' +
        '请只输出合法 JSON 对象，不要包含额外解释：\n' +
        '{"memories":[{"action":"add","targetId":"","content":"用第三人称简练概括，例如：用户喜欢喝不加糖的冰美式咖啡","category":"偏好","importance":4,"scope":"user"}]}';

      var res = await ai.requestChatCompletion({
        apiConfig: opts.apiConfig,
        temperature: 0.1,
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
        projectId: opts.projectId || ''
      });
    } catch (err) {
      console.warn('[AiWorkspaceMemory] auto extraction skipped:', err && err.message ? err.message : err);
      return { added: [], updated: [], skipped: 0, blockedSecrets: 0, error: true };
    }
  }

  global.AiWorkspaceMemory = {
    containsSensitiveSecret: containsSensitiveSecret,
    normalizeMemoryText: normalizeMemoryText,
    computeTextSimilarity: computeTextSimilarity,
    filterAccessibleMemories: filterAccessibleMemories,
    retrieveRelevantMemories: retrieveRelevantMemories,
    shouldAttemptExtraction: shouldAttemptExtraction,
    upsertExtractedMemories: upsertExtractedMemories,
    extractAndSaveFromTurn: extractAndSaveFromTurn
  };
})(typeof window !== 'undefined' ? window : globalThis);
