// CODE-WORD detection + LLM-free intent parser.
//
// SECURITY: The user's code-word list is a SECRET. It MUST NOT live in this
// source file (or any file in the repo) — doing so would hard-code the
// secret in plain text, where anyone with read access to the repo could
// see it. Instead, code-words are stored encrypted alongside the user's
// vault (see ./paths.mjs + codewords.json) and passed into
// `makeCodeWordDetector(customWords)` from runtime storage.
//
// If `customWords` is empty (or contains only invalid entries), the
// detector MUST return null for any input — i.e. no substring in the user
// message qualifies as a code-word. The host then refuses every
// memorypets_* tool call. This is the safest possible default.
//
// Intent verbs (Chinese + English synonyms). Order does not matter; the regex
// joins them with `|`.
const KW = {
  save: ['存入', '存为', '存起', '保存', '记住', '更新', '修改', '改成', '变更', '设置', '记住', 'update', 'upsert', 'save', 'store', 'remember'],
  change: ['修改', '改成', '变更', '更新', '换成', '换为', 'update', 'modify', 'change'],
  remove: ['删除', '移除', '去掉', '忘掉', '忘记', '清除', '删掉', 'delete', 'remove', 'forget', 'drop'],
  reveal: ['解密', '展示', '取出', '告诉我', '显示', 'reveal', '使用', '调用', '用一下', 'bearer', '请求'],
  list: ['列出', '列一下', '列', '看一下', '查看', '显示', '告诉我我的', '有哪些', 'list', 'enumerate', 'show', 'what do you remember'],
  status: ['状态', '是否', '解锁', '设置', '有没有', 'status', 'unlock', 'state'],
  kindProfile: ['个人资料', 'profile', '姓名', '手机', '电话', '地址', '邮箱', '生日', '身份证', '住址', 'email', 'birthday', 'mail'],
  kindWork: ['工作', '公司', '项目', '单位', '办公室', 'work', '经理', 'team', '团队', '职位', '工位', '主管', 'manager'],
  kindCredential: ['凭证', '密钥', '密码', 'token', 'secret', 'api_key', 'api key', 'bearer', 'ghp_', 'sk-', 'glsa_', 'xoxb-', '口令'],
  searchHint: ['忘', '找', '想知道', '查', '查询', '搜索', '搜一下', '什么', '多少', '哪个', '哪条', '告诉我', '看一下'],
  fillerStart: ['请把', '把我', '把这', '这条', '这个'],
};

function alt(kwArr) {
  return kwArr.map(escapeRegex).join('|');
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. Code-word detection (regex assembly)
// ──────────────────────────────────────────────────────────────────────────────

// Build a regex that matches ANY of the user-provided code-words. If
// `words` is empty or invalid, returns null — meaning "no code-word can
// possibly match". Callers must handle that case (refuse all gated tools).
function buildCodeWordRegex(words) {
  const list = Array.isArray(words) ? words.filter((w) => typeof w === 'string' && w.trim()) : [];
  if (list.length === 0) return null;
  const pattern = list.map((w) => escapeRegex(String(w).trim())).join('|');
  return new RegExp('(' + pattern + ')', 'i');
}

export function makeCodeWordDetector(customWords) {
  // SECURITY: We use ONLY the words passed in (customWords). We do NOT
  // merge any hard-coded defaults — defaults would defeat the entire
  // purpose of letting the user choose their own private list.
  const words = Array.isArray(customWords)
    ? customWords.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim())
    : [];
  const re = buildCodeWordRegex(words);
  return {
    words: words.slice(),
    detectCodeWord(text) {
      if (!text || !re) return null;
      const m = String(text).match(re);
      return m ? m[1] : null;
    },
    stripCodeWord(text) {
      if (!re) return String(text || '').trim();
      return String(text || '')
        .replace(re, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. Intent parser
// ──────────────────────────────────────────────────────────────────────────────

// Heuristic (LLM-free) intent parser. Intent shapes:
//   { intent: 'upsert',  kind, label, value }
//   { intent: 'list',    kind? }
//   { intent: 'status' }
//   { intent: 'remove',  label? }
//   { intent: 'reveal',  label }
//   { intent: 'help' }   // user only wrote the code-word, nothing else.
export function parseIntent(cleanMessage) {
  const msg = cleanMessage ?? '';
  if (!msg) return { intent: 'help' };

  // (1) Collect quoted chunks. Quoted chars cover straight, curly and CJK quotes.
  const QUOTED = /['"“”‘’「」『』]([^'"“”‘’「」『』]{1,60})['"“”‘’「」『』]/g;
  const quotedLabels = [];
  let m;
  while ((m = QUOTED.exec(msg)) !== null) quotedLabels.push(m[1]);

  const phoneRe = /(?:\+?86[\-\s]?)?(1[3-9][\d\-\s]{8,15}\d)/;
  const idCardRe = /\b(\d{17}[\dXx])\b/;
  const secretPrefixRe = /\b((?:sk-|ghp_|glsa_|xoxb-|Bearer\s+)\S{4,})/i;

  let value = null;
  let label = null;

  // P1 — multi-quoted pairs: (label, value) pick; prefer numeric/sk- chunks as value.
  if (quotedLabels.length >= 2) {
    label = label ?? quotedLabels[0];
    const candidates = quotedLabels.slice(1);
    let best = null, bestScore = -Infinity;
    for (const s of candidates) {
      let sc = 0;
      if (/\d/.test(s)) sc += 3;
      if (/[-_]/.test(s)) sc += 1;
      if (/^(sk-|ghp_|glsa_|xoxb-)/i.test(s)) sc += 6;
      if (s.length >= 6) sc += 1;
      if (sc > bestScore) { best = s; bestScore = sc; }
    }
    if (best && !value) value = best;
  } else if (quotedLabels.length === 1) {
    const s = quotedLabels[0];
    const looksLikeValue =
      /^\d+$/.test(s) ||
      /[-_/.]/.test(s) ||
      /^(sk-|ghp_|glsa_|xoxb-)/i.test(s) ||
      (s.length >= 6 && /\d/.test(s));
    if (looksLikeValue) {
      if (!value) value = s;
    } else {
      label = label ?? s;
    }
  }

  // P2 — numeric / token regexes (extract real values, not filler text).
  if (!value) {
    const pm = phoneRe.exec(msg);
    if (pm) {
      value = String(pm[1]).replace(/[\s-]/g, '')
        .replace(/^86/, '')
        .replace(/^(\d{11}).*$/, '$1');
    }
  }
  if (!value) { const im = idCardRe.exec(msg); if (im) value = im[1]; }
  if (!value) { const sm = secretPrefixRe.exec(msg); if (sm) value = sm[1]; }

  // Label anchor: `标签/key/label 是/为 X` (Chinese-friendly separator list).
  const labelAnchor = new RegExp(
    '(?:标签|字段名|key|label)\\s*(?:是|为|就叫|叫|=|:|：)\\s*[\'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\\s*([^,\uff0c\u3002\n\r\'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]{1,40}?)\\s*[\'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?(?:[\\s,\uff0c\u3002\uff1b;]|$)',
    'i',
  );
  const la = labelAnchor.exec(msg);
  if (la && !label) label = la[1].trim();

  // P3 — value field anchor (with anti-filler guard: skip "请把我的手机号" style strings).
  if (!value) {
    const valueAnchor = new RegExp(
      '(?:value|内容|值)\\s*(?:是|为|=|:|：)\\s*[\'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\\s*([^\uff0c\u3002\n\r\'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]{1,200}?)\\s*[\'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?(?:[\\s,\uff0c\u3002\uff1b;]|$)',
      'i',
    );
    const va = valueAnchor.exec(msg);
    if (va) {
      const v = va[1].trim();
      const tooFiller = new RegExp('^(' + alt(KW.fillerStart) + ')').test(String(v).slice(0, 10));
      if (v && !tooFiller) value = v;
    }
  }

  if (!value) {
    const saveHead = new RegExp('(?:' + alt(KW.save) + ')\\s+(.{1,100})', 'i');
    const sh = saveHead.exec(msg);
    if (sh) {
      const tail = sh[1];
      // Grab trailing chunk after any of 是/为/=/:/：or last 20-char segment
      const tailValueRe = /(?:是|为|=|:|：)\s*['"“”‘’「」『』]?\s*([^,，。，。\n\r'"“”‘’「」『』]{1,100})\s*['"“”‘’「」『』]?$/i;
      const tv = tailValueRe.exec(tail);
      if (tv) value = tv[1].trim();
      else value = tail.trim().replace(/['"“”‘’「」『』]/g, '').trim();
    }
  }

  // Kind detection by keywords.
  let kind = null;
  if (new RegExp(alt(KW.kindCredential), 'i').test(msg)) kind = 'credential';
  else if (new RegExp(alt(KW.kindWork), 'i').test(msg)) kind = 'work';
  else if (new RegExp(alt(KW.kindProfile), 'i').test(msg) || quotedLabels.length) kind = 'profile';

  const kindAnchor = /(?:属于|分类|类别|kind|类型)\s*(?:是|为|:|：)?\s*['"“”‘’「」『』]?\s*(个人资料|个人|profile|工作|公司|work|凭证|密钥|credential|secret)\s*['"“”‘’「」『』]?/i.exec(msg);
  if (kindAnchor) {
    const kw = kindAnchor[1].toLowerCase();
    if (/个人|profile/.test(kw)) kind = 'profile';
    else if (/工作|公司|work/.test(kw)) kind = 'work';
    else if (/凭证|密钥|credential|secret/.test(kw)) kind = 'credential';
  }

  const wantSave = new RegExp('(' + alt(KW.save) + ')', 'i').test(msg);
  const wantChange = new RegExp('(' + alt(KW.change) + ')', 'i').test(msg);

  // FALLBACK label extraction for update/change sentences.
  // Covers Chinese sentence patterns:
  //   S1: "把 <label> 改成/换成/改为/更新为/设置为 <value>"
  //   S1s: "把 <label> 存入/存为/保存 <value>"            (save verb before value)
  //   S2: "将 <label> 改成 <value>"
  //   S3: "<label> 改成 <value>" / "<label> = <value>"
  //   S4: no label keyword, no quotes, no S1 pattern → fallback to value regex
  if (!label && (wantSave || wantChange) && value) {
    const strictValue = escapeRegex(String(value));
    let looseValue = strictValue;
    if (/^\d+$/.test(String(value)) && String(value).length >= 5) {
      looseValue = String(value)
        .split('')
        .map((c, i) => (i === 0 ? '' : '(?:[^\\d]*)') + c)
        .join('');
    }
    const changeVerbs =
      '(?:改成?|变更为?|换成?|更新(?:成|为)?|改为?|设置为?|调为?|调成?|设为|=|:|：)';
    // Save-verb pattern used in S1s — note: value can also come AFTER the verb
    // when the user spells it as "把 手机号 138… 存入 profile 主手机号". For the
    // common "把 <LABEL> 存为/存入/保存 <VALUE>" shape, the label sits between
    // 把/将 and the verb.
    const mkRe = (vPattern) => [
      new RegExp(
        '[把将]\\s*["\'“”‘’「」『』]?\\s*([\\u4e00-\\u9fa5A-Za-z0-9_\\-\\.\\s]{2,22}?)\\s*["\'“”‘’「」『』]?\\s*' +
          changeVerbs +
          '\\s*["\'“”‘’「」『』]?\\s*' +
          vPattern,
        'i',
      ),
      new RegExp(
        '^[^\\n，。，；,;]{0,30}?["\'“”‘’「」『』]?\\s*([\\u4e00-\\u9fa5A-Za-z0-9_\\-\\.]{2,22})\\s*["\'“”‘’「」『』]?\\s*' +
          changeVerbs +
          '\\s*["\'“”‘’「」『』]?\\s*' +
          vPattern,
        'i',
      ),
      new RegExp(
        '([\\u4e00-\\u9fa5A-Za-z0-9_\\-\\.]{2,24})\\s*' +
          changeVerbs +
          '\\s*["\'“”‘’「」『』]?\\s*' +
          vPattern,
        'i',
      ),
    ];
    for (const vPat of [looseValue, strictValue]) {
      for (const re of mkRe(vPat)) {
        const mm = re.exec(msg);
        if (mm) { label = mm[1].trim(); break; }
      }
      if (label) break;
    }
  }
  // S1s: 把 <LABEL> 存入/存为/保存 <VALUE>. We only run this when the S1
  // family above failed — saves a few regex passes for the common case.
  // Also handles the "value-before-verb" shape: "把 手机号 138… 存为 主手机号"
  // where the actual human-meaningful label sits AFTER the save verb.
  if (!label && wantSave && value) {
    const strictValue = escapeRegex(String(value));
    let looseValue = strictValue;
    if (/^\d+$/.test(String(value)) && String(value).length >= 5) {
      looseValue = String(value)
        .split('')
        .map((c, i) => (i === 0 ? '' : '(?:[^\\d]*)') + c)
        .join('');
    }
    const saveVerbs = '(?:' + KW.save.filter((k) => /[\u4e00-\u9fff]/.test(k)).map(escapeRegex).join('|') + ')';
    // Match a segment AFTER the save verb (followed by content until end or kind
    // anchor). The label ends at the FIRST trailing keyword (kind / 属于 / etc.)
    // or end-of-message.
    const TRAIL = '(?:\\s+(?:profile|work|credential|个人|工作|凭证|密码|密钥|属于|分类|类别|kind|类型)|$)';
    const mkSaveRe = (_vPattern) => [
      // 把/将 <filler> <value> <saveVerb> <LABEL>[TRAIL]
      new RegExp(
        '[把将]\\s*["\'“”‘’「」『』]?\\s*[^\\n，。，；,;]*?' +
          '(?:' + looseValue + '|' + strictValue + ')\\s*' +
          saveVerbs +
          '\\s*["\'“”‘’「」『』]?\\s*([\\u4e00-\\u9fa5A-Za-z0-9_\\-\\.\\s]{2,24}?)' + TRAIL,
        'i',
      ),
    ];
    for (const vPat of [looseValue, strictValue]) {
      for (const re of mkSaveRe(vPat)) {
        const mm = re.exec(msg);
        if (mm) { label = mm[1].trim(); break; }
      }
      if (label) break;
    }
  }

  // — remove / delete —
  if (new RegExp('(' + alt(KW.remove) + ')', 'i').test(msg)) {
    const removeLabelRe = new RegExp(
      '(?:' + alt(KW.remove) + ')[^,，。，。\\n\\r]{0,60}?["\'“”‘’「」『』]?([^"“”‘’「」『』,，。，。\\n\\r]{1,50})["\'“”‘’「」『』]?',
      'i',
    );
    const labelFromDel =
      label ||
      quotedLabels[0] ||
      (removeLabelRe.exec(msg) || [])[1];
    return { intent: 'remove', label: labelFromDel ? String(labelFromDel).trim() : null };
  }

  // — reveal credential —
  if (
    new RegExp('(' + alt(KW.reveal) + ').*(?:凭证|密钥|密码|token|key|api[\\s_-]?key|secret)', 'i').test(msg) ||
    /用.*(?:存的|刚才|之前|保存).*(?:key|token|密码|凭证|密钥)/i.test(msg)
  ) {
    // Strip the leading reveal verb + connector particles so the label regex
    // doesn't accidentally swallow the verb itself. e.g. "显示 GitHub Token 的值"
    // → strip "显示" → match "GitHub Token".
    const stripped = msg.replace(
      new RegExp('^(?:' + alt(KW.reveal) + ')\\s*'),
      '',
    );
    // Match label as everything between optional "label=..." prefix and the
    // closest trailing credential noun ("凭证/密钥/.../secret"). We allow the
    // captured label to INCLUDE a "Token/Key" type-word so "GitHub Token"
    // survives — group1 then becomes "GitHub Token".
    // Two-pass extraction. First try to grab the noun "Token/Key" together with
    // its preceding identifier (e.g. "GitHub Token"). Then fall back to the
    // old lazy-match if that doesn't apply.
    // We allow group1 to end with a noun-word OR plain chars (no required stop
    // word), then OUTSIDE the group require end-of-string / 的/之 / trailing
    // punctuation. This way "GitHub Token 的值" matches group1="GitHub Token".
    const revealLabelPrimary = /(?:标签|label|名叫)?\s*['"“”‘’「」『』]?\s*((?:[^,，.,\n\r'"“”‘’「」『』]\s*){1,40}?(?:token|key|api[\s_-]?key|secret|凭证|密钥|密码))(?=\s*(?:[的之]|值|内容|是)|$|,)/i;
    const revealLabelRe = /(?:标签|label|名叫)?\s*['"“”‘’「」『』]?\s*([^,，。，\n\r'"“”‘’「」『』]{1,50}?)\s*(?:[的之])?\s*(?:凭证|密钥|密码|token|key|api[\s_-]?key|secret)/i;
    const l =
      label ||
      quotedLabels[0] ||
      (revealLabelPrimary.exec(stripped) || [])[1] ||
      (revealLabelRe.exec(stripped) || [])[1];
    return { intent: 'reveal', label: l ? String(l).trim() : null };
  }

  // — list —
  // Intent: "列出所有记忆条目，我忘了工作手机号" → intent=list with kind=null
  // (list ALL), because although "工作" keyword is present, the user wants
  // ALL to find 手机号. Only set kind filter when the message is PURELY about
  // kind (e.g. "列一下凭证类的条目"), or length is short.
  if (new RegExp('(' + alt(KW.list) + ')', 'i').test(msg)) {
    const wantSearch = new RegExp('(' + alt(KW.searchHint) + ')').test(msg);
    let kk = null;
    if (!wantSearch) {
      const k = /(个人|profile|工作|公司|work|凭证|密钥|credential)/i.exec(msg);
      if (k) {
        const kw = k[1].toLowerCase();
        if (/个人|profile/.test(kw)) kk = 'profile';
        else if (/工作|公司|work/.test(kw)) kk = 'work';
        else if (/凭证|密钥|credential/.test(kw)) kk = 'credential';
      }
    }
    return { intent: 'list', kind: kk };
  }

  // — status / state —
  if (new RegExp('(' + alt(KW.status) + ')', 'i').test(msg)) return { intent: 'status' };

  // — upsert / save final —
  if (wantSave || wantChange || (label && value)) {
    if (!kind && value) kind = 'profile';
    return { intent: 'upsert', kind, label: label || null, value: value || null, wantSave, wantChange };
  }

  return { intent: 'help' };
}