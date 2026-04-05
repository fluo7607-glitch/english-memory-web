const STORAGE_MEMORY = "english_memory_notes_v1";
const STORAGE_VOCAB = "english_memory_vocab_v1";
const STORAGE_SETTINGS = "english_memory_online_settings_v1";
const STORAGE_WRONG_BOOK = "english_memory_wrong_book_v1";

const PREFIXES = {
  "ab-": "离开、相反",
  "ad-": "朝向、加强",
  "anti-": "反对",
  "auto-": "自己、自动",
  "bi-": "两个",
  "co-": "共同",
  "de-": "向下、去除、离开",
  "dis-": "否定、分开",
  "en-": "使……",
  "ex-": "向外、前任",
  "inter-": "在……之间",
  "mis-": "错误",
  "non-": "非",
  "over-": "过度、在上",
  "post-": "之后",
  "pre-": "在前、预先",
  "re-": "再次、向后",
  "sub-": "在下、次级",
  "super-": "超级、在上",
  "trans-": "跨越、转变",
  "tri-": "三个",
  "un-": "不、相反",
  "under-": "在下、不足"
};

const SUFFIXES = {
  "-able": "可……的",
  "-al": "……的；行为",
  "-ance": "性质、状态",
  "-ant": "人/物；……的",
  "-ed": "过去式/过去分词",
  "-en": "使成为",
  "-er": "人/物；比较级",
  "-ful": "充满……的",
  "-ing": "进行中；动名词",
  "-ion": "行为、状态",
  "-ity": "性质",
  "-ive": "倾向于……的",
  "-ize": "使……化",
  "-less": "无……的",
  "-ly": "地；……的",
  "-ment": "结果、行为",
  "-ness": "性质、状态",
  "-ous": "充满……的",
  "-ship": "关系、状态",
  "-tion": "行为、状态",
  "-y": "有……的"
};

const el = {
  wordInput: document.getElementById("wordInput"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  homoBtn: document.getElementById("homoBtn"),
  importBtn: document.getElementById("importBtn"),
  importGaokaoBtn: document.getElementById("importGaokaoBtn"),
  learnStartBtn: document.getElementById("learnStartBtn"),
  learnNextBtn: document.getElementById("learnNextBtn"),
  learnSpeakBtn: document.getElementById("learnSpeakBtn"),
  learnGenerateBtn: document.getElementById("learnGenerateBtn"),
  learnRegenerateBtn: document.getElementById("learnRegenerateBtn"),
  learnWordInfo: document.getElementById("learnWordInfo"),
  vocabFileInput: document.getElementById("vocabFileInput"),
  onlineModeToggle: document.getElementById("onlineModeToggle"),
  proxyUrlInput: document.getElementById("proxyUrlInput"),
  onlineStatusText: document.getElementById("onlineStatusText"),
  resultBox: document.getElementById("resultBox"),
  homoOptions: document.getElementById("homoOptions"),
  storyOptions: document.getElementById("storyOptions"),
  dictStartBtn: document.getElementById("dictStartBtn"),
  dictSpeakBtn: document.getElementById("dictSpeakBtn"),
  dictHintBtn: document.getElementById("dictHintBtn"),
  wrongBookBtn: document.getElementById("wrongBookBtn"),
  dictInput: document.getElementById("dictInput"),
  dictCheckBtn: document.getElementById("dictCheckBtn"),
  dictNextBtn: document.getElementById("dictNextBtn"),
  dictStatus: document.getElementById("dictStatus"),
  saveBtn: document.getElementById("saveBtn")
};

let memoryNotes = loadJSON(STORAGE_MEMORY, {});
let vocabNotes = loadJSON(STORAGE_VOCAB, {});
let wrongBook = loadJSON(STORAGE_WRONG_BOOK, {});
let appSettings = loadJSON(STORAGE_SETTINGS, {
  onlineMode: false,
  proxyUrl: "/enhance"
});
let currentWord = "";
let isGenerating = false;
let currentSuggestionPack = null;
let generationNonce = 0;
let selectedHomo = "";
let selectedStory = "";
const ipaCache = {};
const learnState = { words: [], index: -1, current: "" };
const dictationState = { words: [], index: -1, current: "" };

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}

function saveSettings() {
  saveJSON(STORAGE_SETTINGS, appSettings);
  renderOnlineStatus();
}

function saveWrongBook() {
  saveJSON(STORAGE_WRONG_BOOK, wrongBook);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderOnlineStatus() {
  if (!el.onlineStatusText) return;
  const modeText = appSettings.onlineMode ? "联网增强模式" : "本地模式（未联网）";
  el.onlineStatusText.textContent = `当前：${modeText}`;
}

function fallbackIpa(word) {
  const letters = (word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return "/-/";
  return `/${letters}/`;
}

function normalizeIpa(text) {
  return String(text || "")
    .replaceAll("ɹ", "r")
    .replaceAll("ɝ", "er")
    .replaceAll("ɚ", "er")
    .replaceAll("ː", ":");
}

async function getIpa(word) {
  const w = (word || "").toLowerCase().trim();
  if (!w) return "/-/";
  if (ipaCache[w]) return ipaCache[w];
  try {
    const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`);
    if (resp.ok) {
      const data = await resp.json();
      const first = Array.isArray(data) ? data[0] : null;
      const phonetics = first?.phonetics || [];
      const text = phonetics.find((p) => p?.text)?.text || first?.phonetic;
      if (text && typeof text === "string") {
        const normalized = normalizeIpa(text);
        ipaCache[w] = normalized;
        return normalized;
      }
    }
  } catch {
    // ignore and fallback
  }
  const fb = fallbackIpa(w);
  ipaCache[w] = fb;
  return fb;
}

function getSyllableDivision(word) {
  if (!word) return "请输入单词";
  const cleaned = (word.match(/[a-z]/gi) || []).join("");
  if (!cleaned) return "请输入有效单词";

  const groups = cleaned.match(/[aeiouy]+/gi) || [];
  const syllableCount = Math.max(1, groups.length);
  const chunks = cleaned.match(/[^aeiouy]*[aeiouy]+[^aeiouy]*/gi) || [cleaned];
  const division = chunks.map((x) => x.toLowerCase()).join("·");
  return `${division}  （约 ${syllableCount} 个音节）`;
}

function getSyllableParts(word) {
  const cleaned = (word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return [];
  return cleaned.match(/[^aeiouy]*[aeiouy]+[^aeiouy]*/g) || [cleaned];
}

function getAffixAnalysis(word) {
  const w = (word || "").toLowerCase().trim();
  if (!w) return "请输入单词";

  const parts = [];
  const sortedPrefix = Object.entries(PREFIXES).sort((a, b) => b[0].length - a[0].length);
  const sortedSuffix = Object.entries(SUFFIXES).sort((a, b) => b[0].length - a[0].length);

  for (const [pre, mean] of sortedPrefix) {
    const p = pre.replace("-", "");
    if (w.startsWith(p) && w.length > p.length + 1) {
      parts.push(`前缀 ${pre}（${mean}）`);
      break;
    }
  }

  for (const [suf, mean] of sortedSuffix) {
    const s = suf.replace("-", "");
    if (w.endsWith(s) && w.length > s.length + 1) {
      parts.push(`后缀 ${suf}（${mean}）`);
      break;
    }
  }

  return parts.length ? parts.join(" | ") : "暂无明显词缀（可手动拆词根哦～）";
}

function pickByNonce(arr, nonce) {
  if (!arr.length) return "";
  const idx = Math.abs(nonce) % arr.length;
  return arr[idx];
}

function generateHarmonicSuggestions(word, nonce = 0) {
  const wordLower = (word || "").toLowerCase().trim();
  const suggestions = {
    natural: [],
    cute: [],
    funny: [],
    fullText: "",
    recommendedHomo: "",
    recommendedSentence: "",
    homoCandidates: [],
    storyCandidates: []
  };

  if (!wordLower) {
    suggestions.natural = ["请输入单词后再生成谐音哦～"];
    return suggestions;
  }

  if (wordLower === "hospital") {
    suggestions.natural = ["霍斯皮特儿（hos-pi-tal，重音在霍斯）", "哈斯皮德儿（美式轻读t）"];
    suggestions.cute = ["霍斯皮特儿（小兔兔去霍斯皮特儿治病）", "好斯皮特儿（好舒服的皮特儿医院）"];
    suggestions.funny = ["好死皮特儿（皮肤病去好死皮特儿）", "霍斯批他了（医生霍斯批他了）"];
    suggestions.recommendedHomo = "霍斯皮特儿（重音在“霍斯”，后面轻快读，像“霍斯-皮-特儿”）";
    suggestions.recommendedSentence =
      "小兔兔生病了，头晕晕、皮痒痒、特别（特儿）难受，妈妈说：“别怕，我们去霍斯皮特儿（hospital）！白衣姐姐会给你甜甜的药水和暖暖的抱抱，病好了就能继续蹦蹦跳跳啦～ 🐰🏥✨”";
    suggestions.homoCandidates = [
      "霍斯皮特儿（hos-pi-tal，重音在霍斯）",
      "好斯皮特儿（更柔和口语版）",
      "哈斯皮德儿（偏美式轻读t）"
    ];
    suggestions.storyCandidates = [
      suggestions.recommendedSentence,
      "霍斯小朋友生病了，皮皮也不舒服，大家送他去霍斯皮特儿，医生很快帮他好起来。",
      "把 hospital 拆成 hos-pi-tal，先重读 hos，再轻快读后两段，就像给单词按节拍。"
    ];
    suggestions.fullText = [
      "🐰 好的，我来把 HOSPITAL 的谐音再调得更准确一点！",
      "",
      "根据标准发音（英式：/ˈhɒs.pɪ.təl/，美式：/ˈhɑː.spɪ.t̬əl/），重音在第一个音节 hos 上。",
      "",
      "更精准的音节发音拆分：",
      "- hos（重读，像“霍斯/好斯”）",
      "- pi（轻读，像“皮/批”）",
      "- tal（轻读，像“特儿/头儿”）",
      "",
      "推荐最自然、最准确的谐音：",
      "“霍斯皮特儿” 或 “好斯皮特儿”",
      "",
      "可爱小句子（推荐）：",
      "小兔兔生病了，头晕晕、皮痒痒、特别（特儿）难受，妈妈说：",
      "“别怕，我们去霍斯皮特儿（hospital）！白衣姐姐会给你甜甜的药水和暖暖的抱抱，病好了就能继续蹦蹦跳跳啦～ 🐰🏥✨”",
      "",
      "推荐直接复制：",
      `谐音/有趣方式：${suggestions.recommendedHomo}`,
      `可爱小句子：${suggestions.recommendedSentence}`
    ].join("\n");
    return suggestions;
  }

  const base = getSyllableDivision(wordLower).split("（")[0].replaceAll("·", "");
  const parts = getSyllableParts(wordLower);
  const naturalHomo = toChinesePhonetic(parts);
  const cuteHomo = `小${naturalHomo}`;
  const funnyHomo = `${naturalHomo}，不背就“特困”`;
  const stress = parts.length > 1 ? "通常先重读第1音节，再轻快带过后面音节" : "单音节词，整体重读即可";
  const stories = buildStorySet(wordLower, naturalHomo, nonce);

  suggestions.natural = [`自然贴合：${naturalHomo}（节奏：${parts.join("-")}）`];
  suggestions.cute = [`可爱风：${cuteHomo}${pickByNonce(["（像一个软萌地名）", "（像动画角色名）", "（像你的小昵称）"], nonce)}`];
  suggestions.funny = [`搞笑梗：${funnyHomo}${pickByNonce(["", "，越读越上头", "，笑着就记住了"], nonce + 3)}`];
  suggestions.recommendedHomo = `${naturalHomo}（先重读第1段，再连读后半段）`;
  suggestions.recommendedSentence = stories.natural;
  suggestions.homoCandidates = [
    `${naturalHomo}（自然贴合）`,
    `${cuteHomo}（可爱联想）`,
    `${funnyHomo}（搞笑强化）`
  ];
  suggestions.storyCandidates = [stories.natural, stories.funny, stories.logic];
  suggestions.fullText = [
    `🐰 来把 ${wordLower.toUpperCase()} 的谐音做成“可直接记”的版本：`,
    "",
    `音节参考：${base}`,
    `重音建议：${stress}`,
    "",
    "推荐谐音：",
    `- ${suggestions.recommendedHomo}`,
    "",
    "三种风格：",
    `- ${suggestions.natural[0]}`,
    `- ${suggestions.cute[0]}`,
    `- ${suggestions.funny[0]}`,
    "",
    "语境故事（更容易记住）：",
    `- 自然版：${stories.natural}`,
    `- 搞笑版：${stories.funny}`,
    `- 逻辑版：${stories.logic}`,
    "",
    "推荐直接复制：",
    `谐音/有趣方式：${suggestions.recommendedHomo}`,
    `可爱小句子：${suggestions.recommendedSentence}`
  ].join("\n");
  return suggestions;
}

function buildStorySet(word, homo, nonce = 0) {
  const scene = inferScene(word);
  const naturalTpl = [
    `在${scene.place}里，老师让大家用“${homo}”记 ${word}，边读边做动作，三遍就记住了。`,
    `你在${scene.place}看到这个词，就小声念“${homo}”，再拼一次 ${word}，很快就稳了。`,
    `把 ${word} 和“${homo}”绑在一起，每次经过${scene.place}就复述一次，记忆特别牢。`
  ];
  const funnyTpl = [
    `${scene.role}一紧张就把 ${word} 念成“${homo}”，全班笑成一团，结果大家反而都记牢了。`,
    `${scene.role}把 ${word} 读成“${homo}”，你一边笑一边拼写，居然一次就会了。`,
    `有人把 ${word} 念成“${homo}”闹了笑话，你当场纠正，反而把拼写彻底记住。`
  ];
  const logicTpl = [
    `把 ${word} 拆成节奏“${homo}”，先重读前半，再连读后半；每次在${scene.place}看到相关场景就复述一次，记忆会很稳。`,
    `按“先重后轻”的节奏读 ${word}，对应“${homo}”做口型联想，再默写一遍就形成长期记忆。`,
    `把 ${word} 拆音节，再用“${homo}”做中文锚点；听、说、写三步走，记忆最稳定。`
  ];
  return {
    natural: pickByNonce(naturalTpl, nonce + 1),
    funny: pickByNonce(funnyTpl, nonce + 2),
    logic: pickByNonce(logicTpl, nonce + 3)
  };
}

function buildSixStoryCandidates(word, suggestions, nonce = 0) {
  const base = [];
  const rec = (suggestions?.recommendedSentence || "").trim();
  if (rec) base.push(rec);
  const s1 = buildStorySet(word, suggestions?.recommendedHomo || word, nonce + 11);
  const s2 = buildStorySet(word, suggestions?.recommendedHomo || word, nonce + 17);
  const s3 = buildStorySet(word, suggestions?.recommendedHomo || word, nonce + 23);
  base.push(s1.natural, s1.funny, s1.logic, s2.natural, s2.funny, s2.logic, s3.logic);
  const unique = [...new Set(base.map((x) => String(x).trim()).filter(Boolean))];
  return unique.slice(0, 6);
}

function inferScene(word) {
  if (/port|pass|plane|train|travel/.test(word)) return { place: "出行场景", role: "检票员" };
  if (/school|class|learn|study|book/.test(word)) return { place: "教室", role: "同桌" };
  if (/doctor|hospital|health|nurse/.test(word)) return { place: "医院", role: "护士" };
  if (/shop|market|money|pay|price/.test(word)) return { place: "商店", role: "店员" };
  return { place: "日常生活场景", role: "你的小伙伴" };
}

function renderMemoryOptions(suggestions) {
  const homoItems = (suggestions.homoCandidates && suggestions.homoCandidates.length ? suggestions.homoCandidates : [
    ...(suggestions.natural || []),
    ...(suggestions.cute || []),
    ...(suggestions.funny || []),
    ...(suggestions.recommendedHomo ? [suggestions.recommendedHomo] : [])
  ]).slice(0, 6);
  let storyItems = (suggestions.storyCandidates && suggestions.storyCandidates.length
    ? suggestions.storyCandidates
    : [suggestions.recommendedSentence || ""]).filter(Boolean);
  if (storyItems.length < 6) {
    const word = (learnState.current || currentWord || (el.wordInput?.value || "").trim().toLowerCase()).trim().toLowerCase();
    storyItems = buildSixStoryCandidates(word || "word", suggestions, generationNonce);
  } else {
    storyItems = storyItems.slice(0, 6);
  }

  if (el.homoOptions) {
    el.homoOptions.innerHTML = homoItems
      .map(
        (item, idx) =>
          `<label class="option-item"><input type="radio" name="homoOption" value="${escapeHtml(item)}" ${idx === 0 ? "checked" : ""}>${escapeHtml(item)}</label>`
      )
      .join("");
  }

  if (el.storyOptions) {
    el.storyOptions.innerHTML = storyItems
      .map(
        (item, idx) =>
          `<label class="option-item"><input type="radio" name="storyOption" value="${escapeHtml(item)}" ${idx === 0 ? "checked" : ""}>${escapeHtml(item)}</label>`
      )
      .join("");
  }

  selectedHomo = homoItems[0] || "";
  selectedStory = storyItems[0] || "";
}

function toChinesePhonetic(parts) {
  const blockMap = [
    ["passport", "帕斯波特"],
    ["support", "萨波特"],
    ["report", "瑞波特"],
    ["import", "英波特"],
    ["export", "艾克斯波特"],
    ["tion", "申"],
    ["sion", "炫"],
    ["ture", "彻"],
    ["sure", "浊"],
    ["ment", "门特"],
    ["port", "波特"],
    ["pass", "帕斯"],
    ["part", "帕特"],
    ["per", "珀"],
    ["por", "波"],
    ["tal", "特儿"],
    ["pital", "皮特儿"],
    ["ship", "西普"],
    ["sp", "斯普"],
    ["st", "斯特"],
    ["ing", "英"],
    ["ous", "俄斯"],
    ["able", "诶伯"],
    ["less", "勒斯"],
    ["pre", "普瑞"],
    ["pro", "普若"],
    ["con", "康"],
    ["com", "康"],
    ["dis", "迪斯"],
    ["re", "瑞"],
    ["un", "安"]
  ];

  const charMap = {
    a: "啊", b: "布", c: "克", d: "德", e: "诶", f: "夫", g: "格", h: "赫", i: "伊", j: "杰", k: "克",
    l: "勒", m: "姆", n: "恩", o: "哦", p: "普", q: "克", r: "尔", s: "斯", t: "特", u: "乌", v: "维",
    w: "乌", x: "克斯", y: "伊", z: "兹"
  };

  const convert = (syllable) => {
    let s = syllable.toLowerCase();
    let out = "";

    for (const [en, cn] of blockMap) {
      if (s.includes(en)) {
        s = s.replaceAll(en, `|${cn}|`);
      }
    }

    for (const ch of s) {
      if (ch === "|") continue;
      out += charMap[ch] || ch;
    }

    // 合并重复音，避免过长
    out = out
      .replaceAll("斯斯", "斯")
      .replaceAll("特特", "特")
      .replaceAll("勒勒", "勒")
      .replaceAll("哦哦", "哦")
      .replaceAll("啊啊", "啊")
      .replaceAll("普哦", "坡")
      .replaceAll("普尔", "珀")
      .replaceAll("特尔", "特儿")
      .replaceAll("伊恩", "音");

    return out;
  };

  return parts.map(convert).join("·");
}

async function analyzeWord() {
  const word = el.wordInput.value.trim().toLowerCase();
  if (!word) {
    alert("请先输入一个英语单词呀～");
    return;
  }
  if (!/^[a-z-]+$/.test(word)) {
    alert("请输入纯英文单词（可带连字符）哦～");
    return;
  }

  currentWord = word;
  const syllable = getSyllableDivision(word);
  const ipa = await getIpa(word);
  const affix = getAffixAnalysis(word);
  const meaning = vocabNotes[word] || "（暂无词库释义，点击“导入词库”添加）";
  selectedHomo = "";
  selectedStory = "";
  if (el.homoOptions) el.homoOptions.innerHTML = "";
  if (el.storyOptions) el.storyOptions.innerHTML = "";

  el.resultBox.textContent = [
    `📌 单词：${word}`,
    `🔊 音标：${ipa}`,
    "",
    `🔤 音节划分：${syllable}`,
    `📚 中文释义：${meaning}`,
    `🧩 词缀拆解：${affix}`,
    "",
    "💡 点击「自动生成谐音」获取更贴近发音的谐音建议！"
  ].join("\n");
}

async function fetchOnlineEnhancedSuggestions(word, nonce = 0) {
  const payload = {
    word,
    syllable: getSyllableDivision(word),
    affix: getAffixAnalysis(word),
    meaning: vocabNotes[word] || "",
    nonce
  };

  const resp = await fetch(appSettings.proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    let detail = "";
    try {
      const data = await resp.json();
      detail = data?.error || JSON.stringify(data);
    } catch {
      try {
        detail = await resp.text();
      } catch {
        detail = "";
      }
    }
    throw new Error(`代理请求失败：HTTP ${resp.status}${detail ? ` - ${detail}` : ""}`);
  }

  const data = await resp.json();
  if (!data || !data.suggestions) {
    throw new Error("代理返回格式不正确");
  }
  return data.suggestions;
}

async function autoGenerateHomo(forceRegen = false) {
  if (isGenerating) return;
  const wordFromLookup = (el.wordInput?.value || "").trim().toLowerCase();
  const word = (wordFromLookup || learnState.current || currentWord || "").trim().toLowerCase();
  if (!word) {
    alert("请先输入要查的单词，或先开始背词。");
    return;
  }
  isGenerating = true;
  if (el.homoBtn) {
    el.homoBtn.disabled = true;
    el.homoBtn.textContent = "生成中...";
  }
  if (el.learnGenerateBtn) el.learnGenerateBtn.disabled = true;
  if (el.learnRegenerateBtn) el.learnRegenerateBtn.disabled = true;

  if (forceRegen) generationNonce += 1;

  let suggestions;
  try {
    if (appSettings.onlineMode) {
      try {
        if (el.resultBox) el.resultBox.textContent += "\n\n⏳ 正在联网调用大模型生成更自然的谐音与故事...";
        suggestions = await fetchOnlineEnhancedSuggestions(word, generationNonce);
        if (el.resultBox) el.resultBox.textContent += "\n\n✅ 联网增强已生效。";
      } catch (err) {
        if (el.resultBox) el.resultBox.textContent += `\n\n⚠ 联网增强失败，已回退本地模式：${err.message || err}`;
        suggestions = generateHarmonicSuggestions(word, generationNonce);
      }
    } else {
      suggestions = generateHarmonicSuggestions(word, generationNonce);
    }

    currentSuggestionPack = suggestions;
    renderMemoryOptions(suggestions);

    if (suggestions.fullText) {
      if (el.resultBox) el.resultBox.textContent += `\n\n✨ 自动生成的谐音建议（更贴近真实发音）：\n\n${suggestions.fullText}`;
      return;
    }

    if (el.resultBox) el.resultBox.textContent += [
      "",
      "✨ 自动生成的谐音建议（更贴近真实发音）：",
      "",
      "自然贴合版：",
      ...suggestions.natural.map((x) => `- ${x}`),
      "",
      "可爱风版：",
      ...suggestions.cute.map((x) => `- ${x}`),
      "",
      "搞笑梗版：",
      ...suggestions.funny.map((x) => `- ${x}`)
    ].join("\n");
  } finally {
    isGenerating = false;
    if (el.homoBtn) {
      el.homoBtn.disabled = false;
      el.homoBtn.textContent = "自动生成谐音";
    }
    if (el.learnGenerateBtn) el.learnGenerateBtn.disabled = false;
    if (el.learnRegenerateBtn) el.learnRegenerateBtn.disabled = false;
  }
}

function saveMemory() {
  const w = (learnState.current || currentWord || (el.wordInput?.value || "").trim().toLowerCase()).trim().toLowerCase();
  if (!w) {
    alert("请先开始背词或先查一个单词。");
    return;
  }

  const chosenHomo = (document.querySelector("input[name='homoOption']:checked")?.value || selectedHomo || "").trim();
  const chosenStory = (document.querySelector("input[name='storyOption']:checked")?.value || selectedStory || "").trim();
  if (!chosenHomo || !chosenStory) {
    alert("请先生成候选并至少各选一条（谐音 + 小故事）");
    return;
  }
  memoryNotes[w] = { homo: chosenHomo, sentence: chosenStory };
  saveJSON(STORAGE_MEMORY, memoryNotes);
  alert(`✅ ${w.toUpperCase()} 的记忆已保存`);
}

function parseVocabText(name, content) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) {
    const data = JSON.parse(content);
    const result = {};
    if (Array.isArray(data)) {
      for (const item of data) {
        const word = String(item.word || item.en || "").trim().toLowerCase();
        const meaning = String(item.meaning || item.cn || item.translation || "").trim();
        if (word && meaning) result[word] = meaning;
      }
    } else {
      for (const [k, v] of Object.entries(data)) {
        const word = String(k).trim().toLowerCase();
        const meaning = typeof v === "string" ? v.trim() : String(v?.meaning || v?.cn || v?.translation || "").trim();
        if (word && meaning) result[word] = meaning;
      }
    }
    return result;
  }

  if (lower.endsWith(".csv")) {
    const lines = content.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return {};
    const header = lines[0].split(",").map((x) => x.trim().toLowerCase());
    const wordIdx = header.indexOf("word") >= 0 ? header.indexOf("word") : 0;
    const meaningIdx = header.indexOf("meaning") >= 0 ? header.indexOf("meaning") : 1;
    const result = {};
    for (const row of lines.slice(1)) {
      const cols = row.split(",").map((x) => x.trim());
      if (cols.length <= Math.max(wordIdx, meaningIdx)) continue;
      const word = (cols[wordIdx] || "").toLowerCase();
      const meaning = cols[meaningIdx] || "";
      if (word && meaning) result[word] = meaning;
    }
    return result;
  }

  if (lower.endsWith(".txt")) {
    const result = {};
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      let word = "";
      let meaning = "";
      if (line.includes("=")) {
        [word, meaning] = line.split("=", 2);
      } else if (line.includes(":")) {
        [word, meaning] = line.split(":", 2);
      } else {
        const parts = line.split(/\s+/, 2);
        if (parts.length === 2) {
          [word, meaning] = parts;
        }
      }
      word = String(word).trim().toLowerCase();
      meaning = String(meaning).trim();
      if (word && meaning) result[word] = meaning;
    }
    return result;
  }

  throw new Error("仅支持 .json / .csv / .txt");
}

function importVocab() {
  const file = el.vocabFileInput.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseVocabText(file.name, String(reader.result || ""));
      const count = Object.keys(parsed).length;
      if (!count) {
        alert("没有识别到有效词条，请检查文件格式");
        return;
      }
      vocabNotes = { ...vocabNotes, ...parsed };
      saveJSON(STORAGE_VOCAB, vocabNotes);
      alert(`导入成功：${count} 条`);
    } catch (err) {
      alert(`导入失败：${err.message || err}`);
    } finally {
      el.vocabFileInput.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

async function importGaokaoVocab() {
  try {
    const data = window.GAOKAO_3500_VOCAB;
    if (!data || typeof data !== "object") throw new Error("内置词库格式错误");
    vocabNotes = { ...vocabNotes, ...data };
    saveJSON(STORAGE_VOCAB, vocabNotes);
    alert(`已导入高考常考词库：${Object.keys(data).length} 条`);
    if (!learnState.words.length) startLearn();
  } catch (err) {
    alert(`一键导入失败：${err.message || err}`);
  }
}

function learnPool() {
  return Object.keys(vocabNotes || {}).filter((w) => /^[a-z-]+$/i.test(w));
}

async function renderLearnWord(word) {
  if (!word) {
    if (el.learnWordInfo) el.learnWordInfo.textContent = "词库为空，请先一键导入高考词库。";
    return;
  }
  currentWord = word;
  const meaning = vocabNotes[word] || "（未收录释义）";
  const ipa = await getIpa(word);
  selectedHomo = "";
  selectedStory = "";
  if (el.homoOptions) el.homoOptions.innerHTML = "";
  if (el.storyOptions) el.storyOptions.innerHTML = "";
  if (el.learnWordInfo) {
    el.learnWordInfo.textContent = [
      `当前背词：${word}`,
      `音标：${ipa}`,
      `释义：${meaning}`,
      `音节：${getSyllableDivision(word)}`,
      `词缀：${getAffixAnalysis(word)}`,
      "",
      "点击“生成谐音和故事”可生成候选记忆法。"
    ].join("\n");
  }
}

function startLearn() {
  const pool = learnPool();
  if (!pool.length) {
    renderLearnWord("");
    return;
  }
  shuffle(pool);
  learnState.words = pool;
  learnState.index = 0;
  learnState.current = pool[0];
  void renderLearnWord(learnState.current);
}

function nextLearn() {
  if (!learnState.words.length) {
    startLearn();
    return;
  }
  learnState.index = (learnState.index + 1) % learnState.words.length;
  learnState.current = learnState.words[learnState.index];
  void renderLearnWord(learnState.current);
}

function dictWordPool() {
  const keys = Object.keys(memoryNotes || {}).filter((w) => {
    const n = memoryNotes[w] || {};
    return /^[a-z-]+$/i.test(w) && String(n.homo || "").trim() && String(n.sentence || "").trim();
  });
  return keys.map((w) => w.toLowerCase());
}

function pickBestVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;
  const preferred = [
    "Samantha",
    "Karen",
    "Daniel",
    "Alex",
    "Google US English",
    "Google UK English Female"
  ];
  for (const name of preferred) {
    const v = voices.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return voices.find((x) => (x.lang || "").toLowerCase().startsWith("en")) || voices[0];
}

function speakWord(word) {
  if (!("speechSynthesis" in window)) {
    alert("当前浏览器不支持语音朗读，请换 Chrome/Safari");
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  u.rate = 0.72;
  u.pitch = 1.0;
  u.volume = 1.0;
  const v = pickBestVoice();
  if (v) u.voice = v;
  window.speechSynthesis.speak(u);
}

function startDictation() {
  const pool = dictWordPool();
  if (!pool.length) {
    el.dictStatus.textContent = "还没有可复习词：请先在第一块生成并保存单词记忆（谐音+故事）。";
    return;
  }
  shuffle(pool);
  dictationState.words = pool;
  dictationState.index = 0;
  dictationState.current = pool[0];
  el.dictInput.value = "";
  el.dictStatus.textContent = `已开始听写。共 ${pool.length} 词，当前第 1 题。点“读单词”听发音。`;
  speakWord(dictationState.current);
}

function currentDictWord() {
  return dictationState.current || "";
}

function dictHint() {
  const word = currentDictWord();
  if (!word) {
    el.dictStatus.textContent = "请先点击“开始听写”。";
    return;
  }
  const note = memoryNotes[word] || {};
  const hintParts = [];
  if (note.homo) hintParts.push(`谐音提示：${note.homo}`);
  if (note.sentence) hintParts.push(`故事提示：${note.sentence}`);
  if (!hintParts.length) {
    el.dictStatus.textContent = "该词还没有已保存记忆，请先在第一块生成并保存。";
    return;
  }
  const masked = hintParts.map((line) => maskAnswerInHint(line, word));
  el.dictStatus.textContent = [`当前单词提示：`, ...masked].join("\n");
}

function maskAnswerInHint(text, word) {
  const w = String(word || "").trim();
  if (!w) return String(text || "");
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // 全词匹配（忽略大小写），避免直接露答案
  const reWord = new RegExp(`\\b${escaped}\\b`, "gi");
  let out = String(text || "").replace(reWord, "____");
  // 对连字符/词组中的子串再做一层保底脱敏
  if (w.length >= 4) {
    const reSub = new RegExp(escaped, "gi");
    out = out.replace(reSub, "____");
  }
  return out;
}

function markWrong(word, userInput) {
  const item = wrongBook[word] || { count: 0, lastInput: "", ts: 0 };
  item.count += 1;
  item.lastInput = userInput;
  item.ts = Date.now();
  wrongBook[word] = item;
  saveWrongBook();
}

function checkDictation() {
  const word = currentDictWord();
  if (!word) {
    el.dictStatus.textContent = "请先点击“开始听写”。";
    return;
  }
  const input = (el.dictInput.value || "").trim().toLowerCase();
  if (!input) {
    el.dictStatus.textContent = "请先输入拼写再提交。";
    return;
  }
  if (input === word) {
    el.dictStatus.textContent = `✅ 正确！${word}`;
    return;
  }
  markWrong(word, input);
  el.dictStatus.textContent = `❌ 错误。你的答案：${input}\n正确答案：${word}\n已加入错题本。`;
}

function nextDictation() {
  if (!dictationState.words.length) {
    el.dictStatus.textContent = "请先点击“开始听写”。";
    return;
  }
  if (dictationState.index >= dictationState.words.length - 1) {
    el.dictStatus.textContent = "本轮听写完成！可继续开始新一轮。";
    return;
  }
  dictationState.index += 1;
  dictationState.current = dictationState.words[dictationState.index];
  el.dictInput.value = "";
  el.dictStatus.textContent = `第 ${dictationState.index + 1}/${dictationState.words.length} 题。点击“读单词”听发音。`;
  speakWord(dictationState.current);
}

function openWrongBook() {
  const entries = Object.entries(wrongBook || {}).sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
  if (!entries.length) {
    el.dictStatus.textContent = "错题本为空，继续保持！";
    return;
  }
  const lines = ["错题本（按错误次数排序）："];
  for (const [w, meta] of entries.slice(0, 200)) {
    lines.push(`- ${w}（错 ${meta.count} 次，上次写成：${meta.lastInput || "?"}）`);
  }
  el.dictStatus.textContent = lines.join("\n");
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

if (el.analyzeBtn) el.analyzeBtn.addEventListener("click", analyzeWord);
if (el.homoBtn) el.homoBtn.addEventListener("click", autoGenerateHomo);
if (el.saveBtn) el.saveBtn.addEventListener("click", saveMemory);
if (el.importBtn) el.importBtn.addEventListener("click", () => el.vocabFileInput.click());
if (el.importGaokaoBtn) el.importGaokaoBtn.addEventListener("click", importGaokaoVocab);
if (el.vocabFileInput) el.vocabFileInput.addEventListener("change", importVocab);
if (el.learnStartBtn) el.learnStartBtn.addEventListener("click", startLearn);
if (el.learnNextBtn) el.learnNextBtn.addEventListener("click", nextLearn);
if (el.learnSpeakBtn) el.learnSpeakBtn.addEventListener("click", () => {
  const w = learnState.current || currentWord || (el.wordInput?.value || "").trim().toLowerCase();
  if (!w) {
    alert("请先开始背词或先查一个单词。");
    return;
  }
  speakWord(w);
});
if (el.learnGenerateBtn) el.learnGenerateBtn.addEventListener("click", autoGenerateHomo);
if (el.learnRegenerateBtn) el.learnRegenerateBtn.addEventListener("click", () => autoGenerateHomo(true));

el.wordInput.addEventListener("keydown", (evt) => {
  if (evt.key === "Enter") analyzeWord();
});

if (el.homoOptions) {
  el.homoOptions.addEventListener("change", (evt) => {
    const t = evt.target;
    if (t && t.name === "homoOption") {
      selectedHomo = t.value;
    }
  });
}

if (el.storyOptions) {
  el.storyOptions.addEventListener("change", (evt) => {
    const t = evt.target;
    if (t && t.name === "storyOption") {
      selectedStory = t.value;
    }
  });
}

if (el.dictStartBtn) el.dictStartBtn.addEventListener("click", startDictation);
if (el.dictSpeakBtn) el.dictSpeakBtn.addEventListener("click", () => {
  const word = currentDictWord();
  if (!word) {
    el.dictStatus.textContent = "请先点击“开始听写”。";
    return;
  }
  speakWord(word);
});
if (el.dictHintBtn) el.dictHintBtn.addEventListener("click", dictHint);
if (el.dictCheckBtn) el.dictCheckBtn.addEventListener("click", checkDictation);
if (el.dictNextBtn) el.dictNextBtn.addEventListener("click", nextDictation);
if (el.wrongBookBtn) el.wrongBookBtn.addEventListener("click", openWrongBook);
if (el.dictInput) {
  el.dictInput.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") checkDictation();
  });
}

if (el.onlineModeToggle) {
  el.onlineModeToggle.checked = Boolean(appSettings.onlineMode);
  el.onlineModeToggle.addEventListener("change", () => {
    appSettings.onlineMode = el.onlineModeToggle.checked;
    saveSettings();
  });
}

if (el.proxyUrlInput) {
  el.proxyUrlInput.value = appSettings.proxyUrl || "/enhance";
  el.proxyUrlInput.addEventListener("change", () => {
    appSettings.proxyUrl = el.proxyUrlInput.value.trim() || "/enhance";
    saveSettings();
  });
}

renderOnlineStatus();
if (learnPool().length && !learnState.current) {
  startLearn();
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {};
  window.speechSynthesis.getVoices();
}
