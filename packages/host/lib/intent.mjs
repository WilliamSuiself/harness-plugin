// CODE-WORD detection + LLM-free intent parser.
//
// This exists as a DIRECT BYPASS around the LLM when conversation history
// (few-shot "refuse to save" assistant turns) overrides our system prompt.
// If the user message contains ANY code-word → we parse their intent with
// plain-string rules, then the caller (see ./index.mjs) executes the matching
// ./operations.mjs function directly on the host side, without touching the LLM.

// Built-in default code-words. These are always valid unless the user
// explicitly overrides them by configuring custom code-words in the plugin
// config (e.g. the setup UI sets a personal code-phrase).
// Use makeCodeWordDetector(customWords) to get a detector/stripper for a
// combined word list; for the legacy test interface, the default helpers
// below still work with the built-ins alone.
export const CODE_WORDS = [
  '\u54e5\u4eec\u513f', '\u72d7\u72d7', '\u8bb0\u5fc6\u5ba0\u7269', '\ud83d\udc3e', '\ud83d\udc36', '\ud83d\udc31',
  'memorypets', 'memory pets', 'mpets', 'mp>',
];

const DEFAULT_RE = buildCodeWordRegex(CODE_WORDS);

function buildCodeWordRegex(words) {
  const list = Array.isArray(words) && words.length ? words : CODE_WORDS;
  const pattern = list
    .map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp('(' + pattern + ')', 'i');
}

function allWords(customWords) {
  const extra = Array.isArray(customWords) ? customWords.filter(Boolean) : [];
  return extra.length ? [...new Set([...CODE_WORDS, ...extra])] : CODE_WORDS;
}

export function makeCodeWordDetector(customWords) {
  const words = allWords(customWords);
  const re = buildCodeWordRegex(words);
  return {
    words,
    detectCodeWord(text) {
      if (!text) return null;
      const m = String(text).match(re);
      return m ? m[1] : null;
    },
    stripCodeWord(text) {
      return String(text || '')
        .replace(re, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    },
  };
}

// Backwards-compatible shorthands that use only the built-in default words.
export function detectCodeWord(text) {
  if (!text) return null;
  const m = String(text).match(DEFAULT_RE);
  return m ? m[1] : null;
}

export function stripCodeWord(text) {
  return String(text || '')
    .replace(DEFAULT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Heuristic (LLM-free) intent parser. Intent shapes:
//   { intent: 'upsert',  kind, label, value }
//   { intent: 'list',    kind? }
//   { intent: 'status' }
//   { intent: 'remove',  label? }
//   { intent: 'reveal',  label  }
//   { intent: 'help' }   // user only wrote the code-word, nothing else.
export function parseIntent(cleanMessage) {
  const msg = cleanMessage ?? '';
  if (!msg) return { intent: 'help' };
  let match;

  // (1) collect quoted chunks.
  const quotedLabels = [];
  const QUOTED = /['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]([^'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]{1,60})['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]/g;
  while ((match = QUOTED.exec(msg)) !== null) quotedLabels.push(match[1]);

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
    for (let i = 0; i < candidates.length; i++) {
      const s = String(candidates[i] || '');
      let sc = 0;
      if (/\d/.test(s)) sc += 3;
      if (/[-_]/.test(s)) sc += 1;
      if (/^(sk-|ghp_|glsa_|xoxb-)/i.test(s)) sc += 6;
      if (s.length >= 6) sc += 1;
      if (sc > bestScore) { best = s; bestScore = sc; }
    }
    if (best && !value) value = best;
  } else if (quotedLabels.length === 1) {
    const s = String(quotedLabels[0] || '');
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
    const m = phoneRe.exec(msg);
    if (m) {
      value = String(m[1]).replace(/[\s-]/g, '')
        .replace(/^86/, '')
        .replace(/^(\d{11}).*$/, '$1');
    }
  }
  if (!value) { const m = idCardRe.exec(msg); if (m) value = m[1]; }
  if (!value) { const m = secretPrefixRe.exec(msg); if (m) value = m[1]; }

  // Label anchor.
  const labelAnchor = /(?:\u6807\u7b7e|\u5b57\u6bb5\u540d|key|label)\s*(?:\u662f|\u4e3a|\u5c31\u53eb|\u53eb|=|:|\uff1a)\s*['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\s*([^,\uff0c\u3002\n\r'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]{1,40}?)\s*['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?(?:[\s,\uff0c\u3002\uff1b;]|$)/i.exec(msg);
  if (labelAnchor && !label) label = labelAnchor[1].trim();

  // P3 — value field anchor (with anti-filler guard: skip "\u8bf7\u628a\u6211\u7684\u624b\u673a\u53f7" style strings).
  if (!value) {
    const valueAnchor = /(?:value|\u5185\u5bb9|\u503c)\s*(?:\u662f|\u4e3a|=|:|\uff1a)\s*['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\s*([^\uff0c\u3002\n\r'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]{1,200}?)\s*['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?(?:[\s,\uff0c\u3002\uff1b;]|$)/i.exec(msg);
    if (valueAnchor) {
      const v = valueAnchor[1].trim();
      const tooFiller = /^(\u8bf7\u628a|\u628a\u6211|\u628a\u8fd9|\u8fd9(\u6761|\u4e2a))/.test(String(v).slice(0, 10));
      if (v && !tooFiller) value = v;
    }
  }
  if (!value) {
    const m = /(?:\u5b58\u5165|\u5b58\u8d77|\u4fdd\u5b58|\u8bb0\u4f4f|\u66f4\u65b0|\u4fee\u6539|\u6539\u6210|\u53d8\u66f4|\u8bbe\u7f6e)\s+(.{1,100})/i.exec(msg);
    if (m) {
      const tail = m[1];
      // Grab trailing chunk after any of \u662f\u4e3a=:\uff1aor last 20-char segment
      const maybeVal = /(?:\u662f|\u4e3a|=|:|\uff1a)\s*['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\s*([^,\uff0c\u3002\n\r'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]{1,100})\s*['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?$/i.exec(tail);
      if (maybeVal) value = maybeVal[1].trim();
      else value = tail.trim().replace(/['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]/g, '').trim();
    }
  }

  // Kind detection by keywords.
  let kind = null;
  if (/\u51ed\u8bc1|\u5bc6\u94a5|\u5bc6\u7801|token|secret|api[\s_-]?key|bearer|ghp_|sk-|glsa_|xoxb-|\u53e3\u4ee4/i.test(msg)) kind = 'credential';
  else if (/\u5de5\u4f5c|\u516c\u53f8|\u9879\u76ee|\u5355\u4f4d|\u529e\u516c\u5ba4|work|\u7ecf\u7406|team|\u56e2\u961f|\u804c\u4f4d|\u5de5\u4f4d|\u4e3b\u7ba1|manager/i.test(msg)) kind = 'work';
  else if (/\u4e2a\u4eba\u8d44\u6599|profile|\u59d3\u540d|\u624b\u673a|\u7535\u8bdd|\u5730\u5740|\u90ae\u7bb1|\u751f\u65e5|\u8eab\u4efd\u8bc1|\u4f4f\u5740|email|birthday|mail/i.test(msg) || quotedLabels.length) kind = 'profile';

  const kindAnchor = /(?:\u5c5e\u4e8e|\u5206\u7c7b|\u7c7b\u522b|kind|\u7c7b\u578b)\s*(?:\u662f|\u4e3a|:|\uff1a)?\s*['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\s*(\u4e2a\u4eba\u8d44\u6599|\u4e2a\u4eba|profile|\u5de5\u4f5c|\u516c\u53f8|work|\u51ed\u8bc1|\u5bc6\u94a5|credential|secret)\s*['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?/i.exec(msg);
  if (kindAnchor) {
    const kw = kindAnchor[1].toLowerCase();
    if (/\u4e2a\u4eba|profile/.test(kw)) kind = 'profile';
    else if (/\u5de5\u4f5c|\u516c\u53f8|work/.test(kw)) kind = 'work';
    else if (/\u51ed\u8bc1|\u5bc6\u94a5|credential|secret/.test(kw)) kind = 'credential';
  }

  const wantSave = /(\u5b58\u5165|\u5b58\u8d77|\u4fdd\u5b58|\u8bb0\u4f4f|\u66f4\u65b0|\u4fee\u6539|\u6539\u6210|\u53d8\u66f4|\u8bbe\u7f6e|update|upsert|save|store|remember)/i.test(msg);
  const wantChange = /(\u4fee\u6539|\u6539\u6210|\u53d8\u66f4|\u66f4\u65b0|\u6362(?:\u6210|\u4e3a)?|update|modify|change)/i.test(msg);

  // FALLBACK label extraction for update/change sentences.
  // Covers Chinese sentence patterns:
  //   S1: "\u628a <label> \u6539\u6210/\u6362\u6210/\u6539\u4e3a/\u66f4\u65b0\u4e3a/\u8bbe\u7f6e\u4e3a <value>"
  //   S2: "\u5c06 <label> \u6539\u6210 <value>"
  //   S3: "<label> \u6539\u6210 <value>" / "<label> = <value>"
  //   S4: no label keyword, no quotes, no S1 pattern → fallback to value regex
  //
  // NOTE on VALUE MATCHING: parseIntent strips non-digit chars from phone/ID numbers
  // (e.g. "139-0000-9999" → value="13900009999"). To match the original message text we
  // therefore build TWO patterns:
  //   (A) strict — matches exactly the cleaned value
  //   (B) loose  — digits of the value in order, separated by any non-digit chars
  //                 (covers "139-0000-9999", "139.0000.9999", "+86 139 0000 9999", etc.)
  if (!label && (wantSave || wantChange) && value) {
    const strictValue = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let looseValue = strictValue;
    if (/^\d+$/.test(String(value)) && String(value).length >= 5) {
      looseValue = String(value)
        .split('')
        .map((c, i, a) => (i === 0 ? '' : '(?:[^\\d]*)') + String(c))
        .join('');
    }
    const changeVerbs =
      '(?:\u6539\u6210?|\u53d8\u66f4\u4e3a?|\u6362\u6210?|\u66f4\u65b0(?:\u6210|\u4e3a)?|\u6539\u4e3a?|\u8bbe\u7f6e\u4e3a?|\u8c03\u4e3a?|\u8c03\u6210?|\u8bbe\u4e3a|=|:|\uff1a)';
    const mkRe = (vPattern) => [
      new RegExp(
        '[\u628a\u5c06]\\s*["\'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\\s*([\\u4e00-\\u9fa5A-Za-z0-9_\\-\\.\\s]{2,22}?)\\s*["\'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\\s*' +
          changeVerbs +
          '\\s*["\'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\\s*' +
          vPattern,
        'i',
      ),
      new RegExp(
        '^[^\\n\uff0c\u3002,\uff1b;]{0,30}?["\'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\\s*([\\u4e00-\\u9fa5A-Za-z0-9_\\-\\.]{2,22})\\s*["\'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\\s*' +
          changeVerbs +
          '\\s*["\'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\\s*' +
          vPattern,
        'i',
      ),
      new RegExp(
        '([\\u4e00-\\u9fa5A-Za-z0-9_\\-\\.]{2,24})\\s*' +
          changeVerbs +
          '\\s*["\'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\\s*' +
          vPattern,
        'i',
      ),
    ];
    for (const vPat of [looseValue, strictValue]) {
      for (const re of mkRe(vPat)) {
        const mm = re.exec(msg);
        if (mm) {
          label = mm[1].trim();
          break;
        }
      }
      if (label) break;
    }
  }

  // — remove / delete —
  const wantRemove = /(\u5220\u9664|\u79fb\u9664|\u53bb\u6389|\u5fd8\u6389|\u5fd8\u8bb0|\u6e05\u9664|\u5220\u6389|delete|remove|forget|drop)/i.test(msg);
  if (wantRemove) {
    const labelFromDel =
      label ||
      quotedLabels[0] ||
      (/(?:\u5220\u9664|\u79fb\u9664|\u53bb\u6389|\u5fd8\u6389|\u5fd8\u8bb0|\u6e05\u9664|\u5220\u6389|delete|remove|forget)[^,\uff0c\u3002\n\r]{0,60}?["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?([^"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f,\uff0c\u3002\n\r]{1,50})["'\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?/i.exec(msg) || [])[1];
    return { intent: 'remove', label: labelFromDel ? String(labelFromDel).trim() : null };
  }

  // — reveal credential —
  if (
    /(\u89e3\u5bc6|\u5c55\u793a|\u53d6\u51fa|\u544a\u8bc9\u6211|\u663e\u793a|reveal|\u4f7f\u7528|\u8c03\u7528|\u7528\u4e00\u4e0b|bearer|\u8bf7\u6c42).*(?:\u51ed\u8bc1|\u5bc6\u94a5|\u5bc6\u7801|token|key|api[\s_-]?key|secret)/i.test(msg) ||
    /\u7528.*(?:\u5b58\u7684|\u521a\u624d|\u4e4b\u524d|\u4fdd\u5b58).*(?:key|token|\u5bc6\u7801|\u51ed\u8bc1|\u5bc6\u94a5)/i.test(msg)
  ) {
    const l =
      label ||
      quotedLabels[0] ||
      (/(?:\u6807\u7b7e|label|\u540d\u53eb)?\s*['"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]?\s*([^,\uff0c\u3002\n\r'"\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f]{1,50}?)(?:[\u7684\u4e4b]?(?:\u51ed\u8bc1|\u5bc6\u94a5|\u5bc6\u7801|token|key|secret))/i.exec(msg) || [])[1];
    return { intent: 'reveal', label: l ? String(l).trim() : null };
  }

  // — list —
  // Intent: "\u5217\u51fa\u6240\u6709\u8bb0\u5fc6\u6761\u76ee\uff0c\u6211\u5fd8\u4e86\u5de5\u4f5c\u624b\u673a\u53f7" → intent=list with kind=null (list ALL),
  // because although "\u5de5\u4f5c" keyword is present, the user wants ALL to find \u624b\u673a\u53f7.
  // Only set kind filter when the message is PURELY about kind (e.g. "\u5217\u4e00\u4e0b\u51ed\u8bc1\u7c7b\u7684\u6761\u76ee"),
  // or length is short.
  if (/(\u5217\u51fa|\u5217\u4e00\u4e0b|\u5217|\u770b\u4e00\u4e0b|\u67e5\u770b|\u663e\u793a|\u544a\u8bc9\u6211\u6211?\u7684?|\u6709\u54ea\u4e9b|list|enumerate|show|what do you remember)/i.test(msg)) {
    // Heuristic: if the message ALSO contains a "want list + \u5fd8\u4e86XX / \u627e XX / \u67e5\u8be2XX / \u624b\u673a\u53f7 / \u53eb\u4ec0\u4e48" pattern
    // (i.e. the intent is "search in the list by content, not filter by kind"), leave kind=null.
    const wantSearch = /(\u5fd8|\u627e|\u60f3\u77e5\u9053|\u67e5|\u67e5\u8be2|\u641c\u7d22|\u641c\u4e00\u4e0b|\u4ec0\u4e48|\u591a\u5c11|\u54ea\u4e2a|\u54ea\u6761|\u544a\u8bc9\u6211|\u770b\u4e00\u4e0b)/.test(msg);
    let kk = null;
    if (!wantSearch) {
      const k = /(\u4e2a\u4eba|profile|\u5de5\u4f5c|\u516c\u53f8|work|\u51ed\u8bc1|\u5bc6\u94a5|credential)/i.exec(msg);
      if (k) {
        const kw = k[1].toLowerCase();
        if (/\u4e2a\u4eba|profile/.test(kw)) kk = 'profile';
        else if (/\u5de5\u4f5c|\u516c\u53f8|work/.test(kw)) kk = 'work';
        else if (/\u51ed\u8bc1|\u5bc6\u94a5|credential/.test(kw)) kk = 'credential';
      }
    }
    return { intent: 'list', kind: kk };
  }

  // — status / state —
  if (/(\u72b6\u6001|\u662f\u5426|\u89e3\u9501|\u8bbe\u7f6e|\u6709\u6ca1\u6709|status|unlock|state)/i.test(msg)) return { intent: 'status' };

  // — upsert / save final —
  if (wantSave || wantChange || (label && value)) {
    if (!kind && value) kind = 'profile';
    return { intent: 'upsert', kind, label: label || null, value: value || null, wantSave, wantChange };
  }

  return { intent: 'help' };
}
