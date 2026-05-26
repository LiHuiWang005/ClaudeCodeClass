const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { readFileSync, promises: fs } = require("node:fs");

function loadEnvFile(filePath) {
  let content;

  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const name = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || process.env[name] !== undefined) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[name] = value;
  }
}

const ROOT_DIR = __dirname;
loadEnvFile(path.join(ROOT_DIR, ".env"));
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const BOOK_FILE = path.join(ROOT_DIR, "book.json");
const VOTE_FILE = path.join(ROOT_DIR, "vote.json");
const USER_FILE = path.join(ROOT_DIR, "user.json");
const MAX_BODY_SIZE = 1024 * 1024;
const SESSION_COOKIE_NAME = "book_vote_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const VOTE_LIMIT = 3;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_RESET_CODE_LENGTH = 6;
const PASSWORD_RESET_CODE_MAX_ATTEMPTS = 3;
const PASSWORD_RESET_CODE_TTL_SECONDS = 10 * 60;
const PASSWORD_RESET_CODE_RESEND_SECONDS = 60;
const METADATA_FETCH_TIMEOUT_MS = 4500;
const COVER_FETCH_TIMEOUT_MS = 5000;
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const FETCHED_COVER_DIR = path.join(PUBLIC_DIR, "covers", "fetched");
const BOOK_COVER_REFRESH_BATCH_SIZE = 8;
const PASSWORD_SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
};

const scrypt = promisify(crypto.scrypt);

const DEFAULT_BOOKS = [
  {
    id: "book-001",
    title: "深入浅出 Node.js",
    author: "朴灵",
    description: "介绍 Node.js 运行机制、异步编程和服务端开发实践。",
    coverUrl: "/covers/book-001.svg"
  },
  {
    id: "book-002",
    title: "JavaScript 高级程序设计",
    author: "Nicholas C. Zakas",
    description: "系统讲解 JavaScript 语言特性和浏览器端开发基础。",
    coverUrl: "/covers/book-002.svg"
  },
  {
    id: "book-003",
    title: "代码整洁之道",
    author: "Robert C. Martin",
    description: "围绕命名、函数、类和测试讲解可维护代码实践。",
    coverUrl: "/covers/book-003.svg"
  },
  {
    id: "book-004",
    title: "重构",
    author: "Martin Fowler",
    description: "介绍识别代码坏味道并通过小步改造改善设计的方法。",
    coverUrl: "/covers/book-004.svg"
  },
  {
    id: "book-005",
    title: "设计模式",
    author: "Erich Gamma 等",
    description: "总结常见面向对象设计模式及其适用场景。",
    coverUrl: "/covers/book-005.svg"
  },
  {
    id: "book-006",
    title: "程序员修炼之道",
    author: "Andrew Hunt / David Thomas",
    description: "从工程习惯、工具使用和职业实践角度提升开发质量。",
    coverUrl: "/covers/book-006.svg"
  }
];

const EXTRA_BOOK_METADATA = [
  {
    title: "你是孩子的前传",
    author: "陈行甲",
    description: "围绕亲子关系与家庭成长，帮助读者理解孩子行为背后的家庭影响。",
    coverUrl: "/covers/book-007.svg"
  }
];

const BOOK_METADATA_CATALOG = new Map(
  [...DEFAULT_BOOKS, ...EXTRA_BOOK_METADATA].flatMap((book) => [
    [`${book.title.trim().toLowerCase()}::${book.author.trim().toLowerCase()}`, {
      description: book.description,
      coverUrl: book.coverUrl
    }],
    [book.title.trim().toLowerCase(), {
      description: book.description,
      coverUrl: book.coverUrl
    }]
  ])
);

let dataWriteQueue = Promise.resolve();
let userWriteQueue = Promise.resolve();
const sessions = new Map();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp"
};

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendSuccess(response, data, statusCode = 200, headers = {}) {
  sendJson(response, statusCode, {
    success: true,
    data
  }, headers);
}

function sendError(response, statusCode, code, message, headers = {}) {
  sendJson(response, statusCode, {
    success: false,
    error: {
      code,
      message
    }
  }, headers);
}

function createCodedError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function writeJsonFile(filePath, data) {
  const tempFile = `${filePath}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(tempFile, content, "utf8");
  await fs.rename(tempFile, filePath);
}

function createDefaultBookVotes(books) {
  return books.reduce((bookVotes, book) => {
    bookVotes[book.id] = 0;
    return bookVotes;
  }, {});
}

function createDefaultVoteData(books) {
  return {
    bookVotes: createDefaultBookVotes(books),
    userVotes: {}
  };
}

function assertValidBooks(books) {
  if (!Array.isArray(books)) {
    throw new Error("book.json must be an array");
  }

  for (const book of books) {
    if (
      !book ||
      typeof book.id !== "string" ||
      typeof book.title !== "string" ||
      typeof book.author !== "string" ||
      typeof book.description !== "string" ||
      typeof book.coverUrl !== "string"
    ) {
      throw new Error("book.json contains invalid book item");
    }
  }
}

function assertValidVoteData(voteData) {
  if (!voteData || Array.isArray(voteData) || typeof voteData !== "object") {
    throw new Error("vote.json must be an object");
  }

  if (!voteData.bookVotes || Array.isArray(voteData.bookVotes) || typeof voteData.bookVotes !== "object") {
    throw new Error("vote.json bookVotes must be an object");
  }

  if (!voteData.userVotes || Array.isArray(voteData.userVotes) || typeof voteData.userVotes !== "object") {
    throw new Error("vote.json userVotes must be an object");
  }

  for (const [bookId, voteCount] of Object.entries(voteData.bookVotes)) {
    if (typeof bookId !== "string" || !Number.isInteger(voteCount) || voteCount < 0) {
      throw new Error("vote.json contains invalid vote count");
    }
  }

  for (const [userId, records] of Object.entries(voteData.userVotes)) {
    if (typeof userId !== "string" || !Array.isArray(records)) {
      throw new Error("vote.json contains invalid user vote records");
    }

    for (const record of records) {
      if (
        !record ||
        typeof record.bookId !== "string" ||
        typeof record.votedAt !== "string"
      ) {
        throw new Error("vote.json contains invalid user vote record");
      }
    }
  }
}

function normalizeVoteData(votes, books) {
  if (!votes || Array.isArray(votes) || typeof votes !== "object") {
    throw new Error("vote.json must be an object");
  }

  if ("bookVotes" in votes || "userVotes" in votes) {
    const voteData = {
      bookVotes: {
        ...createDefaultBookVotes(books),
        ...(votes.bookVotes || {})
      },
      userVotes: votes.userVotes || {}
    };
    assertValidVoteData(voteData);
    return voteData;
  }

  const voteData = {
    bookVotes: {
      ...createDefaultBookVotes(books),
      ...votes
    },
    userVotes: {}
  };
  assertValidVoteData(voteData);
  return voteData;
}

function getUserVoteStats(userId, voteData) {
  const usedVotes = userId && voteData.userVotes[userId]
    ? voteData.userVotes[userId].length
    : 0;

  return {
    voteLimit: VOTE_LIMIT,
    usedVotes,
    remainingVotes: Math.max(VOTE_LIMIT - usedVotes, 0)
  };
}

function enqueueDataWrite(task) {
  const writeTask = dataWriteQueue.then(task);
  dataWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

function validateBookTitle(title) {
  const normalizedTitle = typeof title === "string" ? title.trim() : "";

  if (normalizedTitle.length < 1 || normalizedTitle.length > 80) {
    throw createCodedError("INVALID_BOOK_TITLE", "书名长度需为 1-80 个字符");
  }

  return normalizedTitle;
}

function validateBookAuthor(author) {
  const normalizedAuthor = typeof author === "string" ? author.trim() : "";

  if (normalizedAuthor.length < 1 || normalizedAuthor.length > 80) {
    throw createCodedError("INVALID_BOOK_AUTHOR", "作者长度需为 1-80 个字符");
  }

  return normalizedAuthor;
}

function validateBookDescription(description) {
  const normalizedDescription = typeof description === "string" ? description.trim() : "";

  if (normalizedDescription.length < 1 || normalizedDescription.length > 300) {
    throw createCodedError("INVALID_BOOK_DESCRIPTION", "简介长度需为 1-300 个字符");
  }

  return normalizedDescription;
}

function validateBookCoverUrl(coverUrl) {
  const normalizedCoverUrl = typeof coverUrl === "string" ? coverUrl.trim() : "";

  if (
    normalizedCoverUrl.length < 1 ||
    normalizedCoverUrl.length > 300 ||
    /\s/.test(normalizedCoverUrl) ||
    !/^(\/|https?:\/\/)/.test(normalizedCoverUrl)
  ) {
    throw createCodedError("INVALID_BOOK_COVER_URL", "封面地址需为 1-300 个字符，且以 /、http:// 或 https:// 开头");
  }

  return normalizedCoverUrl;
}

function validateOptionalBookDescription(description) {
  const normalizedDescription = typeof description === "string" ? description.trim() : "";
  return normalizedDescription ? validateBookDescription(normalizedDescription) : "";
}

function validateOptionalBookCoverUrl(coverUrl) {
  const normalizedCoverUrl = typeof coverUrl === "string" ? coverUrl.trim() : "";
  return normalizedCoverUrl ? validateBookCoverUrl(normalizedCoverUrl) : "";
}

function validateBookPayload(payload) {
  const bookPayload = payload && !Array.isArray(payload) && typeof payload === "object" ? payload : {};

  return {
    title: validateBookTitle(bookPayload.title),
    author: validateBookAuthor(bookPayload.author),
    description: validateBookDescription(bookPayload.description),
    coverUrl: validateBookCoverUrl(bookPayload.coverUrl)
  };
}

function validateNewBookPayload(payload) {
  const bookPayload = payload && !Array.isArray(payload) && typeof payload === "object" ? payload : {};

  return {
    title: validateBookTitle(bookPayload.title),
    author: validateBookAuthor(bookPayload.author),
    description: validateOptionalBookDescription(bookPayload.description),
    coverUrl: validateOptionalBookCoverUrl(bookPayload.coverUrl),
    autoFetchMetadata: bookPayload.autoFetchMetadata !== false
  };
}

function getBookMetadataKey(title, author = "") {
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedAuthor = author.trim().toLowerCase();
  return normalizedAuthor ? `${normalizedTitle}::${normalizedAuthor}` : normalizedTitle;
}

function normalizeComparableText(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function getComparableAuthorTokens(author) {
  return String(author || "")
    .split(/[\/,，、&和及等]+/)
    .map((token) => normalizeComparableText(token))
    .filter((token) => token.length >= 2);
}

function getTitleMatchType(candidateTitle, expectedTitle) {
  const normalizedCandidateTitle = normalizeComparableText(candidateTitle);
  const normalizedExpectedTitle = normalizeComparableText(expectedTitle);

  if (!normalizedCandidateTitle || !normalizedExpectedTitle) {
    return "";
  }

  if (normalizedCandidateTitle === normalizedExpectedTitle) {
    return "exact";
  }

  if (
    normalizedCandidateTitle.includes(normalizedExpectedTitle) ||
    normalizedExpectedTitle.includes(normalizedCandidateTitle)
  ) {
    return "partial";
  }

  return "";
}

function isAuthorMatch(candidateAuthors, expectedAuthor) {
  const candidateAuthorText = Array.isArray(candidateAuthors)
    ? candidateAuthors.join(" ")
    : String(candidateAuthors || "");
  const normalizedCandidateAuthor = normalizeComparableText(candidateAuthorText);
  const normalizedExpectedAuthor = normalizeComparableText(expectedAuthor);

  if (!normalizedCandidateAuthor || !normalizedExpectedAuthor) {
    return false;
  }

  if (
    normalizedCandidateAuthor === normalizedExpectedAuthor ||
    normalizedCandidateAuthor.includes(normalizedExpectedAuthor) ||
    normalizedExpectedAuthor.includes(normalizedCandidateAuthor)
  ) {
    return true;
  }

  return getComparableAuthorTokens(expectedAuthor).some((token) => (
    normalizedCandidateAuthor.includes(token)
  ));
}

function getMetadataConfidence(candidateTitle, candidateAuthors, expectedTitle, expectedAuthor) {
  const titleMatchType = getTitleMatchType(candidateTitle, expectedTitle);

  if (!titleMatchType) {
    return "";
  }

  const authorMatched = isAuthorMatch(candidateAuthors, expectedAuthor);

  if (titleMatchType === "exact" && authorMatched) {
    return "high";
  }

  if (titleMatchType === "partial" && authorMatched) {
    return "medium";
  }

  if (titleMatchType === "exact") {
    return "medium";
  }

  return "low";
}

function getConfidenceScore(confidence) {
  if (confidence === "high") {
    return 3;
  }

  if (confidence === "medium") {
    return 2;
  }

  if (confidence === "low") {
    return 1;
  }

  return 0;
}

function decodeHtmlEntities(text) {
  const entityMap = {
    amp: "&",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
    apos: "'"
  };

  return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, entityValue) => {
    if (entityValue.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entityValue.slice(2), 16));
    }

    if (entityValue.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entityValue.slice(1), 10));
    }

    return entityMap[entityValue.toLowerCase()] || entity;
  });
}

function normalizeFetchedDescription(description) {
  const normalizedDescription = decodeHtmlEntities(description)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedDescription) {
    return "";
  }

  if (normalizedDescription.length <= 300) {
    return normalizedDescription;
  }

  return `${normalizedDescription.slice(0, 299)}…`;
}

function normalizeRemoteCoverUrl(coverUrl) {
  const normalizedCoverUrl = String(coverUrl || "").trim();

  if (!normalizedCoverUrl) {
    return "";
  }

  if (normalizedCoverUrl.startsWith("http://")) {
    return `https://${normalizedCoverUrl.slice("http://".length)}`;
  }

  return normalizedCoverUrl;
}

function extractScriptJson(html, variableName) {
  const marker = `window.${variableName} = `;
  const startIndex = html.indexOf(marker);

  if (startIndex === -1) {
    return null;
  }

  const jsonStartIndex = startIndex + marker.length;
  const endIndex = html.indexOf(";\n", jsonStartIndex);
  const rawJson = html.slice(jsonStartIndex, endIndex === -1 ? undefined : endIndex).trim();

  if (!rawJson) {
    return null;
  }

  return JSON.parse(rawJson);
}

function extractMetaContent(html, propertyName) {
  const escapedPropertyName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta\\s+[^>]*(?:property|name)=["']${escapedPropertyName}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i"
  );
  const match = pattern.exec(html);
  return match ? decodeHtmlEntities(match[1]).trim() : "";
}

function extractIntroDescription(html) {
  const introMatches = [...html.matchAll(/<div class="intro">([\s\S]*?)<\/div>/g)];
  const introHtml = introMatches.length > 1
    ? introMatches[1][1]
    : introMatches[0]?.[1] || "";

  return normalizeFetchedDescription(introHtml);
}

function getGoogleCoverUrl(imageLinks = {}) {
  return normalizeRemoteCoverUrl(
    imageLinks.extraLarge ||
    imageLinks.large ||
    imageLinks.medium ||
    imageLinks.small ||
    imageLinks.thumbnail ||
    imageLinks.smallThumbnail ||
    ""
  );
}

function createFetchedMetadataCandidate(source, candidate, expectedTitle, expectedAuthor) {
  const confidence = getMetadataConfidence(
    candidate.title,
    candidate.authors,
    expectedTitle,
    expectedAuthor
  );

  if (!confidence) {
    return null;
  }

  const description = normalizeFetchedDescription(candidate.description);
  const coverUrl = normalizeRemoteCoverUrl(candidate.coverUrl);

  if (!description && !coverUrl) {
    return null;
  }

  const warnings = [];
  if (confidence === "low") {
    warnings.push(`${source} 只匹配到相近书名，作者匹配不充分，请在后台核对`);
  }

  return {
    description,
    coverUrl,
    source,
    confidence,
    warnings,
    score: getConfidenceScore(confidence) + (description ? 0.2 : 0) + (coverUrl ? 0.2 : 0)
  };
}

function pickBestMetadataCandidate(candidates) {
  return candidates
    .filter(Boolean)
    .sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score)[0] || null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = METADATA_FETCH_TIMEOUT_MS) {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node.js 版本不支持 fetch，请使用 Node.js 18 或更高版本");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "Referer": "https://book.douban.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 vote-book-metadata-fetcher/1.0",
    ...(options.headers || {})
  };

  try {
    return await fetch(url, {
      ...options,
      headers,
      redirect: "follow",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithTimeout(url, source) {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`${source} 返回 HTTP ${response.status}`);
  }

  return response.json();
}

async function fetchTextWithTimeout(url, source) {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`${source} 返回 HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchGoogleBookMetadata(title, author) {
  const query = encodeURIComponent(`${title} ${author}`);
  const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=5&printType=books`;
  const data = await fetchJsonWithTimeout(url, "Google Books");
  const items = Array.isArray(data.items) ? data.items : [];
  const candidates = items.map((item) => {
    const volumeInfo = item && item.volumeInfo ? item.volumeInfo : {};
    return createFetchedMetadataCandidate("google-books", {
      title: volumeInfo.title || "",
      authors: Array.isArray(volumeInfo.authors) ? volumeInfo.authors : [],
      description: volumeInfo.description || "",
      coverUrl: getGoogleCoverUrl(volumeInfo.imageLinks)
    }, title, author);
  });

  return pickBestMetadataCandidate(candidates);
}

async function fetchDoubanSubjectDescription(subjectUrl) {
  if (!subjectUrl) {
    return "";
  }

  try {
    const subjectHtml = await fetchTextWithTimeout(subjectUrl, "Douban");
    return extractIntroDescription(subjectHtml) || extractMetaContent(subjectHtml, "og:description");
  } catch {
    return "";
  }
}

async function fetchDoubanBookMetadata(title, author) {
  const query = encodeURIComponent(`${title} ${author}`);
  const searchHtml = await fetchTextWithTimeout(
    `https://book.douban.com/subject_search?search_text=${query}`,
    "Douban"
  );
  const searchData = extractScriptJson(searchHtml, "__DATA__");
  const items = Array.isArray(searchData?.items) ? searchData.items : [];
  const candidates = [];

  for (const item of items.slice(0, 6)) {
    const abstractParts = String(item.abstract || "")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    const candidate = createFetchedMetadataCandidate("douban", {
      title: item.title || "",
      authors: abstractParts.slice(0, 3),
      description: "",
      coverUrl: item.cover_url || ""
    }, title, author);

    if (!candidate) {
      continue;
    }

    if (getConfidenceScore(candidate.confidence) >= getConfidenceScore("medium")) {
      candidate.description = await fetchDoubanSubjectDescription(item.url);
      candidate.score += candidate.description ? 0.2 : 0;
    }

    candidates.push(candidate);
  }

  return pickBestMetadataCandidate(candidates);
}

function getOpenLibraryCoverUrl(document) {
  if (document.cover_i) {
    return `https://covers.openlibrary.org/b/id/${document.cover_i}-L.jpg`;
  }

  if (Array.isArray(document.isbn) && document.isbn[0]) {
    return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(document.isbn[0])}-L.jpg`;
  }

  return "";
}

function getOpenLibraryDescription(workData) {
  if (!workData || typeof workData !== "object") {
    return "";
  }

  if (typeof workData.description === "string") {
    return workData.description;
  }

  if (workData.description && typeof workData.description.value === "string") {
    return workData.description.value;
  }

  return "";
}

async function fetchOpenLibraryBookMetadata(title, author) {
  const url = [
    "https://openlibrary.org/search.json",
    `?title=${encodeURIComponent(title)}`,
    `&author=${encodeURIComponent(author)}`,
    "&limit=5",
    "&fields=key,title,author_name,cover_i,isbn"
  ].join("");
  const data = await fetchJsonWithTimeout(url, "Open Library");
  const documents = Array.isArray(data.docs) ? data.docs.slice(0, 5) : [];
  const candidates = [];

  for (const document of documents) {
    const confidence = getMetadataConfidence(
      document.title || "",
      Array.isArray(document.author_name) ? document.author_name : [],
      title,
      author
    );

    if (!confidence) {
      continue;
    }

    let description = "";
    if (typeof document.key === "string" && document.key.startsWith("/works/")) {
      try {
        const workData = await fetchJsonWithTimeout(`https://openlibrary.org${document.key}.json`, "Open Library");
        description = getOpenLibraryDescription(workData);
      } catch {
        description = "";
      }
    }

    candidates.push(createFetchedMetadataCandidate("open-library", {
      title: document.title || "",
      authors: Array.isArray(document.author_name) ? document.author_name : [],
      description,
      coverUrl: getOpenLibraryCoverUrl(document)
    }, title, author));
  }

  return pickBestMetadataCandidate(candidates);
}

function fetchLocalBookMetadata(title, author) {
  const exactMatch = BOOK_METADATA_CATALOG.get(getBookMetadataKey(title, author));
  if (exactMatch) {
    return {
      ...exactMatch,
      source: "local-catalog",
      confidence: "high",
      warnings: []
    };
  }

  const titleMatch = BOOK_METADATA_CATALOG.get(getBookMetadataKey(title));
  if (titleMatch) {
    return {
      ...titleMatch,
      source: "local-catalog",
      confidence: "medium",
      warnings: ["本地元数据只匹配到书名，建议核对作者"]
    };
  }

  return null;
}

function mergeBookMetadata(aggregate, nextMetadata) {
  if (!nextMetadata) {
    return;
  }

  if (!aggregate.description && nextMetadata.description) {
    aggregate.description = nextMetadata.description;
  }

  if (!aggregate.coverUrl && nextMetadata.coverUrl) {
    aggregate.coverUrl = nextMetadata.coverUrl;
  }

  if (nextMetadata.source) {
    aggregate.sources.add(nextMetadata.source);
  }

  if (getConfidenceScore(nextMetadata.confidence) > getConfidenceScore(aggregate.confidence)) {
    aggregate.confidence = nextMetadata.confidence;
  }

  if (Array.isArray(nextMetadata.warnings)) {
    aggregate.warnings.push(...nextMetadata.warnings);
  }
}

async function fetchBookMetadata(title, author) {
  const aggregate = {
    description: "",
    coverUrl: "",
    sources: new Set(),
    confidence: "",
    warnings: []
  };
  const providers = [
    ["Douban", fetchDoubanBookMetadata],
    ["Google Books", fetchGoogleBookMetadata],
    ["Open Library", fetchOpenLibraryBookMetadata]
  ];

  for (const [providerName, provider] of providers) {
    if (aggregate.description && aggregate.coverUrl) {
      break;
    }

    try {
      const providerMetadata = await provider(title, author);

      if (providerMetadata) {
        mergeBookMetadata(aggregate, providerMetadata);
      } else {
        aggregate.warnings.push(`${providerName} 未找到匹配的图书信息`);
      }
    } catch (error) {
      aggregate.warnings.push(`${providerName} 抓取失败：${error.name === "AbortError" ? "请求超时" : error.message}`);
    }
  }

  if (!aggregate.description || !aggregate.coverUrl) {
    mergeBookMetadata(aggregate, fetchLocalBookMetadata(title, author));
  }

  return {
    description: aggregate.description,
    coverUrl: aggregate.coverUrl,
    source: Array.from(aggregate.sources).join("+"),
    confidence: aggregate.confidence || "none",
    warnings: aggregate.warnings
  };
}

function getCoverExtension(contentType, coverUrl) {
  const normalizedContentType = String(contentType || "").split(";")[0].trim().toLowerCase();
  const extensionByContentType = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp"
  };

  if (extensionByContentType[normalizedContentType]) {
    return extensionByContentType[normalizedContentType];
  }

  const urlPath = new URL(coverUrl).pathname.toLowerCase();
  const extension = path.extname(urlPath);
  return [".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(extension) ? extension : ".jpg";
}

async function cacheRemoteCoverUrl(coverUrl, title, author) {
  if (!/^https?:\/\//.test(coverUrl)) {
    return coverUrl;
  }

  const response = await fetchWithTimeout(coverUrl, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    }
  }, COVER_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`封面图片返回 HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    throw new Error("封面地址返回的不是图片内容");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength <= 0 || arrayBuffer.byteLength > MAX_COVER_BYTES) {
    throw new Error("封面图片大小不合法");
  }

  await fs.mkdir(FETCHED_COVER_DIR, { recursive: true });

  const extension = getCoverExtension(contentType, coverUrl);
  const hash = crypto
    .createHash("sha1")
    .update(`${title}\n${author}\n${coverUrl}`)
    .digest("hex")
    .slice(0, 16);
  const fileName = `book-cover-${hash}${extension}`;

  await fs.writeFile(path.join(FETCHED_COVER_DIR, fileName), Buffer.from(arrayBuffer));
  return `/covers/fetched/${fileName}`;
}

async function normalizeFetchedCoverForStorage(coverUrl, title, author, warnings) {
  const normalizedCoverUrl = String(coverUrl || "").trim();

  if (!/^https?:\/\//.test(normalizedCoverUrl)) {
    return validateBookCoverUrl(normalizedCoverUrl);
  }

  if (/\s/.test(normalizedCoverUrl) || normalizedCoverUrl.length > 2000) {
    warnings.push("抓取到的远程封面地址不合法，已放弃该封面");
    return "";
  }

  try {
    return await cacheRemoteCoverUrl(normalizedCoverUrl, title, author);
  } catch (error) {
    try {
      const directCoverUrl = validateBookCoverUrl(normalizedCoverUrl);
      warnings.push(`远程封面缓存失败，已直接使用远程封面地址：${error.message}`);
      return directCoverUrl;
    } catch {
      warnings.push(`远程封面缓存失败且地址不适合直接保存，已放弃该封面：${error.message}`);
      return "";
    }
  }
}

function createFallbackBookDescription(title, author) {
  return `《${title}》是${author}创作的一本候选图书。`;
}

function appendMetadataSource(metadata, source) {
  const currentSources = metadata.source && metadata.source !== "manual"
    ? metadata.source.split("+")
    : [];

  if (!currentSources.includes(source)) {
    currentSources.push(source);
  }

  metadata.source = currentSources.join("+") || source;
}

async function completeNewBookFields(payload) {
  const fields = validateNewBookPayload(payload);
  const metadata = {
    descriptionFetched: false,
    coverFetched: false,
    source: "manual",
    confidence: "manual",
    fallbackUsed: false,
    warnings: []
  };
  const shouldFetchMetadata = !fields.description || !fields.coverUrl;
  const fetchedMetadata = shouldFetchMetadata
    ? await fetchBookMetadata(fields.title, fields.author)
    : {
      description: "",
      coverUrl: "",
      source: "manual",
      confidence: "manual",
      warnings: []
    };

  let description = fields.description;
  let coverUrl = fields.coverUrl;

  if (fetchedMetadata.source) {
    metadata.source = fetchedMetadata.source;
    metadata.confidence = fetchedMetadata.confidence || "none";
  }

  if (Array.isArray(fetchedMetadata.warnings)) {
    metadata.warnings.push(...fetchedMetadata.warnings);
  }

  if (!description && fetchedMetadata.description) {
    description = validateBookDescription(fetchedMetadata.description);
    metadata.descriptionFetched = true;
  }

  if (!coverUrl && fetchedMetadata.coverUrl) {
    const fetchedCoverUrl = await normalizeFetchedCoverForStorage(
      fetchedMetadata.coverUrl,
      fields.title,
      fields.author,
      metadata.warnings
    );

    if (fetchedCoverUrl) {
      coverUrl = fetchedCoverUrl;
      metadata.coverFetched = true;
    }
  }

  if (!description) {
    description = createFallbackBookDescription(fields.title, fields.author);
    appendMetadataSource(metadata, "fallback");
    metadata.confidence = metadata.confidence === "manual" ? "none" : metadata.confidence;
    metadata.fallbackUsed = true;
    metadata.warnings.push("未抓取到图书简介，已使用基础简介");
  }

  if (!coverUrl) {
    coverUrl = "/covers/default.svg";
    appendMetadataSource(metadata, "fallback");
    metadata.confidence = metadata.confidence === "manual" ? "none" : metadata.confidence;
    metadata.fallbackUsed = true;
    metadata.warnings.push("未抓取到图书封面，已使用默认封面");
  }

  return {
    bookFields: {
      title: fields.title,
      author: fields.author,
      description,
      coverUrl
    },
    metadata
  };
}

function isLocalGeneratedCover(coverUrl) {
  return /^\/covers\/book-\d+\.svg$/.test(String(coverUrl || "")) ||
    String(coverUrl || "") === "/covers/default.svg";
}

async function refreshBookRealCover(book) {
  const metadata = await fetchBookMetadata(book.title, book.author);
  const warnings = Array.isArray(metadata.warnings) ? [...metadata.warnings] : [];

  if (!metadata.coverUrl) {
    return {
      book,
      updated: false,
      metadata: {
        source: metadata.source || "none",
        confidence: metadata.confidence || "none",
        warnings: [...warnings, "未抓取到真实封面，已保留原封面"]
      }
    };
  }

  const coverUrl = await normalizeFetchedCoverForStorage(
    metadata.coverUrl,
    book.title,
    book.author,
    warnings
  );

  if (!coverUrl || coverUrl === book.coverUrl) {
    return {
      book,
      updated: false,
      metadata: {
        source: metadata.source || "none",
        confidence: metadata.confidence || "none",
        warnings: coverUrl === book.coverUrl ? warnings : [...warnings, "真实封面保存失败，已保留原封面"]
      }
    };
  }

  return {
    book: {
      ...book,
      coverUrl
    },
    updated: true,
    metadata: {
      source: metadata.source || "none",
      confidence: metadata.confidence || "none",
      warnings
    }
  };
}

async function refreshExistingBookRealCovers() {
  const books = await readJsonFile(BOOK_FILE);
  assertValidBooks(books);

  const results = [];
  const nextBooks = [];

  for (const book of books) {
    if (results.length >= BOOK_COVER_REFRESH_BATCH_SIZE) {
      nextBooks.push(book);
      continue;
    }

    if (!isLocalGeneratedCover(book.coverUrl)) {
      nextBooks.push(book);
      results.push({
        id: book.id,
        title: book.title,
        updated: false,
        coverUrl: book.coverUrl,
        metadata: {
          source: "existing",
          confidence: "manual",
          warnings: ["当前封面不是本地生成封面，已跳过"]
        }
      });
      continue;
    }

    const refreshed = await refreshBookRealCover(book);
    nextBooks.push(refreshed.book);
    results.push({
      id: refreshed.book.id,
      title: refreshed.book.title,
      updated: refreshed.updated,
      coverUrl: refreshed.book.coverUrl,
      metadata: refreshed.metadata
    });
  }

  const updatedCount = results.filter((result) => result.updated).length;

  if (updatedCount > 0) {
    await writeJsonFile(BOOK_FILE, nextBooks);
  }

  return {
    updatedCount,
    total: books.length,
    results
  };
}

function generateBookId(books) {
  const maxNumber = books.reduce((maxValue, book) => {
    const match = /^book-(\d+)$/.exec(book.id);
    return match ? Math.max(maxValue, Number(match[1])) : maxValue;
  }, 0);

  return `book-${String(maxNumber + 1).padStart(3, "0")}`;
}

function requireAuthenticatedUser(request, response) {
  const user = getCurrentUser(request);

  if (!user) {
    sendError(response, 401, "UNAUTHORIZED", "请先登录");
    return null;
  }

  return user;
}

function requireAdminUser(request, response) {
  const user = requireAuthenticatedUser(request, response);

  if (!user) {
    return null;
  }

  if (user.role !== "admin") {
    sendError(response, 403, "FORBIDDEN", "没有管理员权限");
    return null;
  }

  return user;
}

function assertValidUsers(users) {
  if (!Array.isArray(users)) {
    throw new Error("user.json must be an array");
  }

  for (const user of users) {
    if (
      !user ||
      typeof user.id !== "string" ||
      typeof user.username !== "string" ||
      (user.email !== undefined && typeof user.email !== "string") ||
      !["user", "admin"].includes(user.role) ||
      typeof user.passwordHash !== "string" ||
      typeof user.passwordSalt !== "string" ||
      (user.recoveryQuestion !== undefined && typeof user.recoveryQuestion !== "string") ||
      (user.recoveryAnswerHash !== undefined && typeof user.recoveryAnswerHash !== "string") ||
      (user.recoveryAnswerSalt !== undefined && typeof user.recoveryAnswerSalt !== "string") ||
      (user.recoveryUpdatedAt !== undefined && typeof user.recoveryUpdatedAt !== "string") ||
      (user.passwordResetCodeHash !== undefined && typeof user.passwordResetCodeHash !== "string") ||
      (user.passwordResetCodeSalt !== undefined && typeof user.passwordResetCodeSalt !== "string") ||
      (user.passwordResetCodeExpiresAt !== undefined && typeof user.passwordResetCodeExpiresAt !== "string") ||
      (user.passwordResetCodeSentAt !== undefined && typeof user.passwordResetCodeSentAt !== "string") ||
      (user.passwordResetCodeEmail !== undefined && typeof user.passwordResetCodeEmail !== "string") ||
      (
        user.passwordResetCodeFailedAttempts !== undefined &&
        (!Number.isInteger(user.passwordResetCodeFailedAttempts) || user.passwordResetCodeFailedAttempts < 0)
      ) ||
      typeof user.createdAt !== "string"
    ) {
      throw new Error("user.json contains invalid user item");
    }
  }
}

function normalizeUsers(users) {
  if (!Array.isArray(users)) {
    throw new Error("user.json must be an array");
  }

  return users.map((user) => ({
    ...user,
    email: typeof user.email === "string" ? user.email : "",
    role: user.role === "admin" ? "admin" : "user",
    recoveryQuestion: typeof user.recoveryQuestion === "string" ? user.recoveryQuestion : "",
    recoveryAnswerHash: typeof user.recoveryAnswerHash === "string" ? user.recoveryAnswerHash : "",
    recoveryAnswerSalt: typeof user.recoveryAnswerSalt === "string" ? user.recoveryAnswerSalt : "",
    recoveryUpdatedAt: typeof user.recoveryUpdatedAt === "string" ? user.recoveryUpdatedAt : "",
    passwordResetCodeHash: typeof user.passwordResetCodeHash === "string" ? user.passwordResetCodeHash : "",
    passwordResetCodeSalt: typeof user.passwordResetCodeSalt === "string" ? user.passwordResetCodeSalt : "",
    passwordResetCodeExpiresAt: typeof user.passwordResetCodeExpiresAt === "string" ? user.passwordResetCodeExpiresAt : "",
    passwordResetCodeSentAt: typeof user.passwordResetCodeSentAt === "string" ? user.passwordResetCodeSentAt : "",
    passwordResetCodeEmail: typeof user.passwordResetCodeEmail === "string" ? user.passwordResetCodeEmail : "",
    passwordResetCodeFailedAttempts: Number.isInteger(user.passwordResetCodeFailedAttempts)
      ? user.passwordResetCodeFailedAttempts
      : 0
  }));
}

async function ensureDataFiles() {
  if (!(await fileExists(BOOK_FILE))) {
    await writeJsonFile(BOOK_FILE, DEFAULT_BOOKS);
  }

  const books = await readJsonFile(BOOK_FILE);
  assertValidBooks(books);

  if (!(await fileExists(VOTE_FILE))) {
    await writeJsonFile(VOTE_FILE, createDefaultVoteData(books));
  }

  const votes = await readJsonFile(VOTE_FILE);
  const normalizedVoteData = normalizeVoteData(votes, books);
  if (JSON.stringify(votes) !== JSON.stringify(normalizedVoteData)) {
    await writeJsonFile(VOTE_FILE, normalizedVoteData);
  }

  if (!(await fileExists(USER_FILE))) {
    await writeJsonFile(USER_FILE, []);
  }

  const users = await readJsonFile(USER_FILE);
  const normalizedUsers = normalizeUsers(users);
  assertValidUsers(normalizedUsers);
  if (JSON.stringify(users) !== JSON.stringify(normalizedUsers)) {
    await writeJsonFile(USER_FILE, normalizedUsers);
  }
}

async function loadBooksWithVotes() {
  const [books, votes] = await Promise.all([
    readJsonFile(BOOK_FILE),
    readJsonFile(VOTE_FILE)
  ]);

  assertValidBooks(books);
  const voteData = normalizeVoteData(votes, books);

  return books.map((book) => ({
    ...book,
    votes: voteData.bookVotes[book.id] || 0
  }));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("REQUEST_BODY_TOO_LARGE"));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("INVALID_JSON_BODY"));
      }
    });

    request.on("error", reject);
  });
}

function normalizeUsername(username) {
  return typeof username === "string" ? username.trim() : "";
}

function validateUsername(username) {
  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/.test(username)) {
    throw createCodedError("INVALID_USERNAME", "用户名需为 2-32 位中文、字母、数字、下划线或短横线");
  }
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function validateEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  if (
    normalizedEmail.length < 3 ||
    normalizedEmail.length > 254 ||
    /\s/.test(normalizedEmail) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    throw createCodedError("INVALID_EMAIL", "邮箱格式不合法");
  }

  return normalizedEmail;
}

function normalizeAccount(account) {
  return typeof account === "string" ? account.trim() : "";
}

function validateAccount(account) {
  const normalizedAccount = normalizeAccount(account);

  if (!normalizedAccount) {
    throw createCodedError("INVALID_ACCOUNT", "请输入用户名或邮箱");
  }

  if (normalizedAccount.includes("@")) {
    return validateEmail(normalizedAccount);
  }

  validateUsername(normalizedAccount);
  return normalizedAccount;
}

function validatePasswordResetAccount(account) {
  const normalizedAccount = normalizeUsername(account);

  try {
    validateUsername(normalizedAccount);
  } catch {
    throw createCodedError("INVALID_ACCOUNT", "请输入要重置密码的用户名");
  }

  return normalizedAccount;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 6 || password.length > 128) {
    throw createCodedError("INVALID_PASSWORD", "密码长度需为 6-128 位");
  }
}

function validatePasswordResetCode(code) {
  const normalizedCode = typeof code === "string" ? code.trim() : "";

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw createCodedError("INVALID_PASSWORD_RESET_CODE", "验证码需为 6 位数字");
  }

  return normalizedCode;
}

function validateRecoveryQuestion(question) {
  const normalizedQuestion = typeof question === "string" ? question.trim() : "";

  if (normalizedQuestion.length < 1 || normalizedQuestion.length > 120) {
    throw createCodedError("INVALID_RECOVERY_QUESTION", "找回问题长度需为 1-120 个字符");
  }

  return normalizedQuestion;
}

function validateRecoveryAnswer(answer) {
  const normalizedAnswer = typeof answer === "string" ? answer.trim() : "";

  if (normalizedAnswer.length < 1 || normalizedAnswer.length > 128) {
    throw createCodedError("INVALID_RECOVERY_ANSWER", "找回答案长度需为 1-128 个字符");
  }

  return normalizedAnswer;
}

function hasRecoveryConfigured(user) {
  return Boolean(
    user &&
    user.recoveryQuestion &&
    user.recoveryAnswerHash &&
    user.recoveryAnswerSalt
  );
}

function hasEmailConfigured(user) {
  return Boolean(user && user.email);
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || "",
    role: user.role || "user",
    emailConfigured: hasEmailConfigured(user),
    recoveryConfigured: hasRecoveryConfigured(user)
  };
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("base64")) {
  const derivedKey = await scrypt(password, salt, PASSWORD_KEY_LENGTH, PASSWORD_SCRYPT_OPTIONS);

  return {
    passwordSalt: salt,
    passwordHash: derivedKey.toString("base64")
  };
}

async function verifyPassword(password, user) {
  const { passwordHash } = await hashPassword(password, user.passwordSalt);
  const expectedHash = Buffer.from(user.passwordHash, "base64");
  const actualHash = Buffer.from(passwordHash, "base64");

  if (expectedHash.length !== actualHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedHash, actualHash);
}

async function hashRecoveryAnswer(answer) {
  const { passwordHash, passwordSalt } = await hashPassword(answer);

  return {
    recoveryAnswerHash: passwordHash,
    recoveryAnswerSalt: passwordSalt
  };
}

async function hashPasswordResetCode(code) {
  const { passwordHash, passwordSalt } = await hashPassword(code);

  return {
    passwordResetCodeHash: passwordHash,
    passwordResetCodeSalt: passwordSalt
  };
}

async function verifyPasswordResetCode(code, user) {
  if (!user.passwordResetCodeHash || !user.passwordResetCodeSalt) {
    throw createCodedError("PASSWORD_RESET_CODE_NOT_FOUND", "验证码不存在或已失效");
  }

  const { passwordHash } = await hashPassword(code, user.passwordResetCodeSalt);
  const expectedHash = Buffer.from(user.passwordResetCodeHash, "base64");
  const actualHash = Buffer.from(passwordHash, "base64");

  if (expectedHash.length !== actualHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedHash, actualHash);
}

async function verifyRecoveryAnswer(answer, user) {
  if (!hasRecoveryConfigured(user)) {
    throw createCodedError("RECOVERY_NOT_CONFIGURED", "用户未设置找回凭证");
  }

  const { passwordHash } = await hashPassword(answer, user.recoveryAnswerSalt);
  const expectedHash = Buffer.from(user.recoveryAnswerHash, "base64");
  const actualHash = Buffer.from(passwordHash, "base64");

  if (expectedHash.length !== actualHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedHash, actualHash);
}

function createPasswordResetCode() {
  const maxValue = 10 ** PASSWORD_RESET_CODE_LENGTH;
  return String(crypto.randomInt(0, maxValue)).padStart(PASSWORD_RESET_CODE_LENGTH, "0");
}

function findUserByAccount(users, account) {
  const normalizedAccount = normalizeAccount(account).toLowerCase();

  return users.find((user) => (
    user.username.toLowerCase() === normalizedAccount ||
    normalizeEmail(user.email) === normalizedAccount
  ));
}

function findUserByUsername(users, username) {
  const normalizedUsername = normalizeUsername(username).toLowerCase();

  return users.find((user) => user.username.toLowerCase() === normalizedUsername);
}

function clearPasswordResetCode(user) {
  return {
    ...user,
    passwordResetCodeHash: "",
    passwordResetCodeSalt: "",
    passwordResetCodeExpiresAt: "",
    passwordResetCodeSentAt: "",
    passwordResetCodeEmail: "",
    passwordResetCodeFailedAttempts: 0
  };
}

function getSmtpConfig() {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const from = (process.env.SMTP_FROM || user || "").trim();
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";

  if (
    !host ||
    !port ||
    !user ||
    !pass ||
    !from ||
    user === "your-address@gmail.com" ||
    pass === "your-app-password" ||
    from === "your-address@gmail.com"
  ) {
    return null;
  }

  return {
    host,
    port,
    user,
    pass,
    from,
    secure
  };
}

function createSmtpMessage({ from, to, subject, text }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text
  ].join("\r\n");
}

function sendSmtpCommand(socket, command, expectedCodes) {
  return new Promise((resolve, reject) => {
    let responseText = "";

    const cleanup = () => {
      socket.off("data", handleData);
      socket.off("error", handleError);
    };

    const handleError = (error) => {
      cleanup();
      reject(error);
    };

    const handleData = (chunk) => {
      responseText += chunk.toString("utf8");
      const lines = responseText.split(/\r?\n/).filter(Boolean);
      const lastLine = lines[lines.length - 1] || "";

      if (!/^\d{3} /.test(lastLine)) {
        return;
      }

      cleanup();
      const statusCode = Number(lastLine.slice(0, 3));

      if (!expectedCodes.includes(statusCode)) {
        reject(new Error(`SMTP 命令失败：${lastLine}`));
        return;
      }

      resolve(responseText);
    };

    socket.on("data", handleData);
    socket.on("error", handleError);

    if (command) {
      socket.write(`${command}\r\n`);
    }
  });
}

async function sendPasswordResetEmail(to, code) {
  const config = getSmtpConfig();

  if (!config) {
    throw createCodedError("EMAIL_SERVICE_NOT_CONFIGURED", "邮件服务未配置");
  }

  const net = require("node:net");
  const tls = require("node:tls");
  const tlsOptions = net.isIP(config.host) ? {} : { servername: config.host };
  let socket;

  try {
    socket = config.secure
      ? tls.connect(config.port, config.host, tlsOptions)
      : net.connect(config.port, config.host);

    socket.setTimeout(10000);
    await sendSmtpCommand(socket, "", [220]);
    await sendSmtpCommand(socket, `EHLO ${config.host}`, [250]);

    if (!config.secure) {
      await sendSmtpCommand(socket, "STARTTLS", [220]);
      socket = await new Promise((resolve, reject) => {
        const secureSocket = tls.connect({
          socket,
          ...tlsOptions
        }, () => resolve(secureSocket));
        secureSocket.once("error", reject);
      });
      socket.setTimeout(10000);
      await sendSmtpCommand(socket, `EHLO ${config.host}`, [250]);
    }

    await sendSmtpCommand(socket, "AUTH LOGIN", [334]);
    await sendSmtpCommand(socket, Buffer.from(config.user).toString("base64"), [334]);
    await sendSmtpCommand(socket, Buffer.from(config.pass).toString("base64"), [235]);
    await sendSmtpCommand(socket, `MAIL FROM:<${config.from}>`, [250]);
    await sendSmtpCommand(socket, `RCPT TO:<${to}>`, [250, 251]);
    await sendSmtpCommand(socket, "DATA", [354]);
    await sendSmtpCommand(socket, `${createSmtpMessage({
      from: config.from,
      to,
      subject: "图书投票应用找回密码验证码",
      text: `你的找回密码验证码是：${code}\n\n验证码 10 分钟内有效，输错 3 次后失效。若非本人操作，请忽略本邮件。`
    })}\r\n.`, [250]);
    await sendSmtpCommand(socket, "QUIT", [221]);
  } catch (error) {
    if (error.code === "EMAIL_SERVICE_NOT_CONFIGURED") {
      throw error;
    }

    throw createCodedError("EMAIL_SEND_FAILED", error.message || "邮件发送失败");
  } finally {
    if (socket) {
      socket.destroy();
    }
  }
}

function createSession(user) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  sessions.set(sessionId, {
    userId: user.id,
    username: user.username,
    role: user.role || "user",
    createdAt: new Date().toISOString()
  });
  return sessionId;
}

function createSessionCookie(sessionId) {
  return `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

function createClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(request) {
  const cookieHeader = request.headers.cookie;

  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(";").reduce((cookies, item) => {
    const separatorIndex = item.indexOf("=");

    if (separatorIndex === -1) {
      return cookies;
    }

    const name = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    cookies[name] = value;
    return cookies;
  }, {});
}

function getSessionId(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (!sessionId || !/^[a-f0-9]{64}$/.test(sessionId)) {
    return "";
  }

  return sessionId;
}

function getCurrentUser(request) {
  const sessionId = getSessionId(request);
  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  return {
    id: session.userId,
    username: session.username,
    role: session.role || "user"
  };
}

async function createUser(username, email, password, recoveryQuestion, recoveryAnswer, role = "user") {
  const writeTask = userWriteQueue.then(async () => {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);

    const usernameExists = normalizedUsers.some((user) => (
      user.username.toLowerCase() === username.toLowerCase()
    ));

    if (usernameExists) {
      throw createCodedError("USERNAME_EXISTS", "用户名已存在");
    }

    const emailExists = normalizedUsers.some((user) => (
      normalizeEmail(user.email) === email
    ));

    if (emailExists) {
      throw createCodedError("EMAIL_EXISTS", "邮箱已被其他用户使用");
    }

    const passwordData = await hashPassword(password);
    const recoveryData = await hashRecoveryAnswer(recoveryAnswer);
    const now = new Date().toISOString();
    const user = {
      id: `user-${crypto.randomBytes(8).toString("hex")}`,
      username,
      email,
      role,
      passwordHash: passwordData.passwordHash,
      passwordSalt: passwordData.passwordSalt,
      recoveryQuestion,
      recoveryAnswerHash: recoveryData.recoveryAnswerHash,
      recoveryAnswerSalt: recoveryData.recoveryAnswerSalt,
      recoveryUpdatedAt: now,
      createdAt: now
    };

    await writeJsonFile(USER_FILE, [...normalizedUsers, user]);
    return toPublicUser(user);
  });

  userWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

async function updateUserRecoverySettings(userId, email, recoveryQuestion, recoveryAnswer) {
  const writeTask = userWriteQueue.then(async () => {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);
    const currentUser = normalizedUsers.find((user) => user.id === userId);

    if (!currentUser) {
      throw createCodedError("USER_NOT_FOUND", "用户不存在");
    }

    const emailExists = normalizedUsers.some((user) => (
      user.id !== userId && normalizeEmail(user.email) === email
    ));

    if (emailExists) {
      throw createCodedError("EMAIL_EXISTS", "邮箱已被其他用户使用");
    }

    const isEmailChanged = normalizeEmail(currentUser.email) !== email;
    const recoveryData = await hashRecoveryAnswer(recoveryAnswer);
    const nextUsers = normalizedUsers.map((user) => (
      user.id === userId
        ? {
          ...(isEmailChanged ? clearPasswordResetCode(user) : user),
          email,
          recoveryQuestion,
          recoveryAnswerHash: recoveryData.recoveryAnswerHash,
          recoveryAnswerSalt: recoveryData.recoveryAnswerSalt,
          recoveryUpdatedAt: new Date().toISOString()
        }
        : user
    ));

    await writeJsonFile(USER_FILE, nextUsers);

    return {
      emailUpdated: true,
      recoveryUpdated: true
    };
  });

  userWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

async function resetUserPassword(username, recoveryAnswer, newPassword) {
  const writeTask = userWriteQueue.then(async () => {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);
    const userIndex = normalizedUsers.findIndex((user) => (
      user.username.toLowerCase() === username.toLowerCase()
    ));

    if (userIndex === -1) {
      throw createCodedError("USER_NOT_FOUND", "用户不存在");
    }

    const user = normalizedUsers[userIndex];
    const isRecoveryAnswerValid = await verifyRecoveryAnswer(recoveryAnswer, user);

    if (!isRecoveryAnswerValid) {
      throw createCodedError("INVALID_RECOVERY_ANSWER", "找回答案错误");
    }

    const passwordData = await hashPassword(newPassword);
    const nextUsers = normalizedUsers.map((item) => (
      item.id === user.id
        ? {
          ...item,
          passwordHash: passwordData.passwordHash,
          passwordSalt: passwordData.passwordSalt
        }
        : item
    ));

    await writeJsonFile(USER_FILE, nextUsers);

    return {
      passwordReset: true
    };
  });

  userWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

async function requestPasswordResetCode(account, email) {
  const users = await readJsonFile(USER_FILE);
  const normalizedUsers = normalizeUsers(users);
  assertValidUsers(normalizedUsers);
  const user = findUserByUsername(normalizedUsers, account);

  if (!user) {
    throw createCodedError("USER_NOT_FOUND", "用户不存在");
  }

  const now = Date.now();
  const lastSentAt = Date.parse(user.passwordResetCodeSentAt || "");

  if (Number.isFinite(lastSentAt) && now - lastSentAt < PASSWORD_RESET_CODE_RESEND_SECONDS * 1000) {
    const retryAfterSeconds = Math.ceil((PASSWORD_RESET_CODE_RESEND_SECONDS * 1000 - (now - lastSentAt)) / 1000);
    const error = createCodedError("PASSWORD_RESET_CODE_TOO_FREQUENT", "验证码发送过于频繁");
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }

  const code = createPasswordResetCode();
  const codeData = await hashPasswordResetCode(code);
  const expiresAt = new Date(now + PASSWORD_RESET_CODE_TTL_SECONDS * 1000).toISOString();
  const sentAt = new Date(now).toISOString();

  await sendPasswordResetEmail(email, code);

  const writeTask = userWriteQueue.then(async () => {
    const latestUsers = normalizeUsers(await readJsonFile(USER_FILE));
    assertValidUsers(latestUsers);
    const latestUser = findUserByUsername(latestUsers, account);

    if (!latestUser) {
      throw createCodedError("USER_NOT_FOUND", "用户不存在");
    }

    const nextUsers = latestUsers.map((item) => (
      item.id === latestUser.id
        ? {
          ...item,
          passwordResetCodeHash: codeData.passwordResetCodeHash,
          passwordResetCodeSalt: codeData.passwordResetCodeSalt,
          passwordResetCodeExpiresAt: expiresAt,
          passwordResetCodeSentAt: sentAt,
          passwordResetCodeEmail: email,
          passwordResetCodeFailedAttempts: 0
        }
        : item
    ));

    await writeJsonFile(USER_FILE, nextUsers);

    return {
      codeSent: true,
      expiresInSeconds: PASSWORD_RESET_CODE_TTL_SECONDS,
      retryAfterSeconds: PASSWORD_RESET_CODE_RESEND_SECONDS,
      maxAttempts: PASSWORD_RESET_CODE_MAX_ATTEMPTS
    };
  });

  userWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

async function registerPasswordResetFailure(users, user, errorCode, message) {
  const failedAttempts = user.passwordResetCodeFailedAttempts + 1;
  const locked = failedAttempts >= PASSWORD_RESET_CODE_MAX_ATTEMPTS;
  const nextUsers = users.map((item) => (
    item.id === user.id
      ? locked
        ? clearPasswordResetCode(item)
        : {
          ...item,
          passwordResetCodeFailedAttempts: failedAttempts
        }
      : item
  ));

  await writeJsonFile(USER_FILE, nextUsers);

  const error = createCodedError(
    locked ? "PASSWORD_RESET_CODE_LOCKED" : errorCode,
    locked ? "验证码错误次数过多，已失效" : message
  );
  error.remainingAttempts = Math.max(PASSWORD_RESET_CODE_MAX_ATTEMPTS - failedAttempts, 0);
  throw error;
}

async function resetUserPasswordByCode(account, email, code, newPassword) {
  const writeTask = userWriteQueue.then(async () => {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);
    const user = findUserByUsername(normalizedUsers, account);

    if (!user) {
      throw createCodedError("USER_NOT_FOUND", "用户不存在");
    }

    if (!user.passwordResetCodeHash || !user.passwordResetCodeSalt || !user.passwordResetCodeEmail) {
      throw createCodedError("PASSWORD_RESET_CODE_NOT_FOUND", "验证码不存在或已失效");
    }

    const expiresAt = Date.parse(user.passwordResetCodeExpiresAt || "");
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      const nextUsers = normalizedUsers.map((item) => (
        item.id === user.id ? clearPasswordResetCode(item) : item
      ));
      await writeJsonFile(USER_FILE, nextUsers);
      throw createCodedError("PASSWORD_RESET_CODE_EXPIRED", "验证码已过期");
    }

    if (user.passwordResetCodeFailedAttempts >= PASSWORD_RESET_CODE_MAX_ATTEMPTS) {
      const nextUsers = normalizedUsers.map((item) => (
        item.id === user.id ? clearPasswordResetCode(item) : item
      ));
      await writeJsonFile(USER_FILE, nextUsers);
      throw createCodedError("PASSWORD_RESET_CODE_LOCKED", "验证码错误次数过多，已失效");
    }

    if (normalizeEmail(user.passwordResetCodeEmail) !== email) {
      await registerPasswordResetFailure(
        normalizedUsers,
        user,
        "INVALID_PASSWORD_RESET_EMAIL",
        "接收邮箱与验证码不匹配"
      );
    }

    const isCodeValid = await verifyPasswordResetCode(code, user);

    if (!isCodeValid) {
      await registerPasswordResetFailure(
        normalizedUsers,
        user,
        "INVALID_PASSWORD_RESET_CODE",
        "验证码错误"
      );
    }

    const passwordData = await hashPassword(newPassword);
    const nextUsers = normalizedUsers.map((item) => (
      item.id === user.id
        ? clearPasswordResetCode({
          ...item,
          passwordHash: passwordData.passwordHash,
          passwordSalt: passwordData.passwordSalt
        })
        : item
    ));

    await writeJsonFile(USER_FILE, nextUsers);

    return {
      passwordReset: true
    };
  });

  userWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

async function changeUserPassword(userId, currentPassword, newPassword) {
  const writeTask = userWriteQueue.then(async () => {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);
    const userIndex = normalizedUsers.findIndex((user) => user.id === userId);

    if (userIndex === -1) {
      throw createCodedError("USER_NOT_FOUND", "用户不存在");
    }

    const user = normalizedUsers[userIndex];
    const isCurrentPasswordValid = await verifyPassword(currentPassword, user);

    if (!isCurrentPasswordValid) {
      throw createCodedError("INVALID_CURRENT_PASSWORD", "当前密码错误");
    }

    const passwordData = await hashPassword(newPassword);
    const nextUsers = normalizedUsers.map((item) => (
      item.id === userId
        ? {
          ...item,
          passwordHash: passwordData.passwordHash,
          passwordSalt: passwordData.passwordSalt
        }
        : item
    ));

    await writeJsonFile(USER_FILE, nextUsers);

    return {
      passwordChanged: true
    };
  });

  userWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

async function handleGetBooks(response) {
  try {
    const books = await loadBooksWithVotes();
    sendSuccess(response, books);
  } catch (error) {
    console.error("Failed to load books:", error);
    sendError(response, 500, "DATA_READ_ERROR", "图书数据读取失败");
  }
}

async function addVote(bookId, user) {
  return enqueueDataWrite(async () => {
    const books = await readJsonFile(BOOK_FILE);
    assertValidBooks(books);

    const bookExists = books.some((book) => book.id === bookId);
    if (!bookExists) {
      throw createCodedError("BOOK_NOT_FOUND", "图书不存在");
    }

    const votes = await readJsonFile(VOTE_FILE);
    const voteData = normalizeVoteData(votes, books);
    const currentRecords = voteData.userVotes[user.id] || [];

    if (currentRecords.length >= VOTE_LIMIT) {
      throw createCodedError("VOTE_LIMIT_REACHED", "每个用户最多可投 3 票");
    }

    const nextRecords = [
      ...currentRecords,
      {
        bookId,
        votedAt: new Date().toISOString()
      }
    ];

    const nextVoteData = {
      bookVotes: {
        ...voteData.bookVotes,
        [bookId]: (voteData.bookVotes[bookId] || 0) + 1
      },
      userVotes: {
        ...voteData.userVotes,
        [user.id]: nextRecords
      }
    };

    await writeJsonFile(VOTE_FILE, nextVoteData);
    const stats = getUserVoteStats(user.id, nextVoteData);

    return {
      bookId,
      votes: nextVoteData.bookVotes[bookId],
      userVoteCount: stats.usedVotes,
      remainingVotes: stats.remainingVotes
    };
  });
}

async function handlePostVotes(request, response) {
  const user = requireAuthenticatedUser(request, response);

  if (!user) {
    return;
  }

  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  if (!payload || typeof payload.bookId !== "string" || payload.bookId.trim() === "") {
    sendError(response, 400, "INVALID_BOOK_ID", "缺少有效的图书 ID");
    return;
  }

  try {
    const result = await addVote(payload.bookId, user);
    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "BOOK_NOT_FOUND") {
      sendError(response, 404, "BOOK_NOT_FOUND", "图书不存在");
      return;
    }

    if (error.code === "VOTE_LIMIT_REACHED") {
      sendError(response, 403, "VOTE_LIMIT_REACHED", "每个用户最多可投 3 票");
      return;
    }

    console.error("Failed to write vote:", error);
    sendError(response, 500, "DATA_WRITE_ERROR", "投票数据写入失败");
  }
}

async function handleRegister(request, response) {
  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  const username = normalizeUsername(payload.username);
  let email;
  let recoveryQuestion;
  let recoveryAnswer;

  try {
    validateUsername(username);
    email = validateEmail(payload.email);
    validatePassword(payload.password);
    recoveryQuestion = validateRecoveryQuestion(payload.recoveryQuestion);
    recoveryAnswer = validateRecoveryAnswer(payload.recoveryAnswer);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_AUTH_INPUT", error.message || "认证参数不合法");
    return;
  }

  try {
    const user = await createUser(username, email, payload.password, recoveryQuestion, recoveryAnswer);
    sendSuccess(response, user, 201);
  } catch (error) {
    if (error.code === "USERNAME_EXISTS") {
      sendError(response, 409, "USERNAME_EXISTS", "用户名已存在");
      return;
    }

    if (error.code === "EMAIL_EXISTS") {
      sendError(response, 409, "EMAIL_EXISTS", "邮箱已被其他用户使用");
      return;
    }

    console.error("Failed to register user:", error);
    sendError(response, 500, "USER_WRITE_ERROR", "用户数据写入失败");
  }
}

async function handleLogin(request, response) {
  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  const username = normalizeUsername(payload.username);

  try {
    validateUsername(username);
    validatePassword(payload.password);
  } catch {
    sendError(response, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
    return;
  }

  try {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);

    const user = normalizedUsers.find((item) => (
      item.username.toLowerCase() === username.toLowerCase()
    ));

    if (!user || !(await verifyPassword(payload.password, user))) {
      sendError(response, 401, "INVALID_CREDENTIALS", "用户名或密码错误");
      return;
    }

    const sessionId = createSession(user);
    sendSuccess(response, toPublicUser(user), 200, {
      "Set-Cookie": createSessionCookie(sessionId)
    });
  } catch (error) {
    console.error("Failed to login user:", error);
    sendError(response, 500, "USER_READ_ERROR", "用户数据读取失败");
  }
}

async function handleLogout(request, response) {
  const sessionId = getSessionId(request);

  if (sessionId) {
    sessions.delete(sessionId);
  }

  sendSuccess(response, { loggedOut: true }, 200, {
    "Set-Cookie": createClearSessionCookie()
  });
}

async function handleChangePassword(request, response) {
  const user = requireAuthenticatedUser(request, response);

  if (!user) {
    return;
  }

  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  try {
    validatePassword(payload.currentPassword);
    validatePassword(payload.newPassword);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_PASSWORD", error.message || "密码格式不合法");
    return;
  }

  try {
    const result = await changeUserPassword(user.id, payload.currentPassword, payload.newPassword);
    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "INVALID_CURRENT_PASSWORD") {
      sendError(response, 400, "INVALID_CURRENT_PASSWORD", "当前密码错误");
      return;
    }

    if (error.code === "USER_NOT_FOUND") {
      sendError(response, 404, "USER_NOT_FOUND", "用户不存在");
      return;
    }

    console.error("Failed to change password:", error);
    sendError(response, 500, "USER_WRITE_ERROR", "用户数据写入失败");
  }
}

async function handleUpdateRecoverySettings(request, response) {
  const user = requireAuthenticatedUser(request, response);

  if (!user) {
    return;
  }

  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  let recoveryQuestion;
  let recoveryAnswer;
  let email;

  try {
    email = validateEmail(payload.email);
    recoveryQuestion = validateRecoveryQuestion(payload.recoveryQuestion);
    recoveryAnswer = validateRecoveryAnswer(payload.recoveryAnswer);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_RECOVERY_INPUT", error.message || "找回凭证不合法");
    return;
  }

  try {
    const result = await updateUserRecoverySettings(user.id, email, recoveryQuestion, recoveryAnswer);
    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "USER_NOT_FOUND") {
      sendError(response, 404, "USER_NOT_FOUND", "用户不存在");
      return;
    }

    if (error.code === "EMAIL_EXISTS") {
      sendError(response, 409, "EMAIL_EXISTS", "邮箱已被其他用户使用");
      return;
    }

    console.error("Failed to update recovery settings:", error);
    sendError(response, 500, "USER_WRITE_ERROR", "用户数据写入失败");
  }
}

async function handleGetRecoveryQuestion(request, response, usernameQuery) {
  const username = normalizeUsername(usernameQuery);

  try {
    validateUsername(username);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_USERNAME", error.message || "用户名不合法");
    return;
  }

  try {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);
    const user = normalizedUsers.find((item) => (
      item.username.toLowerCase() === username.toLowerCase()
    ));

    if (!user) {
      sendError(response, 404, "USER_NOT_FOUND", "用户不存在");
      return;
    }

    if (!hasRecoveryConfigured(user)) {
      sendError(response, 400, "RECOVERY_NOT_CONFIGURED", "用户未设置找回凭证");
      return;
    }

    sendSuccess(response, {
      username: user.username,
      recoveryQuestion: user.recoveryQuestion
    });
  } catch (error) {
    console.error("Failed to get recovery question:", error);
    sendError(response, 500, "USER_READ_ERROR", "用户数据读取失败");
  }
}

async function handleResetPassword(request, response) {
  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  const username = normalizeUsername(payload.username);
  let recoveryAnswer;

  try {
    validateUsername(username);
    recoveryAnswer = validateRecoveryAnswer(payload.recoveryAnswer);
    validatePassword(payload.newPassword);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_RECOVERY_INPUT", error.message || "找回密码参数不合法");
    return;
  }

  try {
    const result = await resetUserPassword(username, recoveryAnswer, payload.newPassword);
    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "USER_NOT_FOUND") {
      sendError(response, 404, "USER_NOT_FOUND", "用户不存在");
      return;
    }

    if (error.code === "RECOVERY_NOT_CONFIGURED") {
      sendError(response, 400, "RECOVERY_NOT_CONFIGURED", "用户未设置找回凭证");
      return;
    }

    if (error.code === "INVALID_RECOVERY_ANSWER") {
      sendError(response, 400, "INVALID_RECOVERY_ANSWER", "找回答案错误");
      return;
    }

    console.error("Failed to reset password:", error);
    sendError(response, 500, "USER_WRITE_ERROR", "用户数据写入失败");
  }
}

async function handleRequestPasswordResetCode(request, response) {
  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  let account;
  let email;

  try {
    account = validatePasswordResetAccount(payload.account);
    email = validateEmail(payload.email);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_PASSWORD_RESET_INPUT", error.message || "验证码发送参数不合法");
    return;
  }

  try {
    const result = await requestPasswordResetCode(account, email);
    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "USER_NOT_FOUND") {
      sendError(response, 404, "USER_NOT_FOUND", "用户不存在");
      return;
    }

    if (error.code === "PASSWORD_RESET_CODE_TOO_FREQUENT") {
      sendError(response, 429, "PASSWORD_RESET_CODE_TOO_FREQUENT", "验证码发送过于频繁", {
        "Retry-After": String(error.retryAfterSeconds || PASSWORD_RESET_CODE_RESEND_SECONDS)
      });
      return;
    }

    if (error.code === "EMAIL_SERVICE_NOT_CONFIGURED") {
      sendError(response, 500, "EMAIL_SERVICE_NOT_CONFIGURED", "邮件服务未配置");
      return;
    }

    if (error.code === "EMAIL_SEND_FAILED") {
      sendError(response, 502, "EMAIL_SEND_FAILED", "邮件发送失败");
      return;
    }

    console.error("Failed to request password reset code:", error);
    sendError(response, 500, "USER_WRITE_ERROR", "用户数据写入失败");
  }
}

async function handleResetPasswordByCode(request, response) {
  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  let account;
  let email;
  let code;

  try {
    account = validatePasswordResetAccount(payload.account);
    email = validateEmail(payload.email);
    code = validatePasswordResetCode(payload.code);
    validatePassword(payload.newPassword);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_PASSWORD_RESET_INPUT", error.message || "验证码重置参数不合法");
    return;
  }

  try {
    const result = await resetUserPasswordByCode(account, email, code, payload.newPassword);
    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "USER_NOT_FOUND") {
      sendError(response, 404, "USER_NOT_FOUND", "用户不存在");
      return;
    }

    if (error.code === "PASSWORD_RESET_CODE_NOT_FOUND") {
      sendError(response, 400, "PASSWORD_RESET_CODE_NOT_FOUND", "验证码不存在或已失效");
      return;
    }

    if (error.code === "PASSWORD_RESET_CODE_EXPIRED") {
      sendError(response, 400, "PASSWORD_RESET_CODE_EXPIRED", "验证码已过期");
      return;
    }

    if (error.code === "PASSWORD_RESET_CODE_LOCKED") {
      sendError(response, 400, "PASSWORD_RESET_CODE_LOCKED", "验证码错误次数过多，已失效");
      return;
    }

    if (error.code === "INVALID_PASSWORD_RESET_CODE") {
      sendError(response, 400, "INVALID_PASSWORD_RESET_CODE", `验证码错误，还可尝试 ${error.remainingAttempts} 次`);
      return;
    }

    if (error.code === "INVALID_PASSWORD_RESET_EMAIL") {
      sendError(response, 400, "INVALID_PASSWORD_RESET_EMAIL", `接收邮箱与验证码不匹配，还可尝试 ${error.remainingAttempts} 次`);
      return;
    }

    console.error("Failed to reset password by code:", error);
    sendError(response, 500, "USER_WRITE_ERROR", "用户数据写入失败");
  }
}

async function handleGetMe(request, response) {
  const user = getCurrentUser(request);

  if (!user) {
    sendSuccess(response, {
      authenticated: false,
      user: null,
      recoveryConfigured: false,
      voteLimit: VOTE_LIMIT,
      usedVotes: 0,
      remainingVotes: 0
    });
    return;
  }

  try {
    const users = await readJsonFile(USER_FILE);
    const normalizedUsers = normalizeUsers(users);
    assertValidUsers(normalizedUsers);
    const currentUser = normalizedUsers.find((item) => item.id === user.id) || user;
    const books = await readJsonFile(BOOK_FILE);
    assertValidBooks(books);
    const votes = await readJsonFile(VOTE_FILE);
    const voteData = normalizeVoteData(votes, books);
    const stats = getUserVoteStats(user.id, voteData);

    sendSuccess(response, {
      authenticated: true,
      user: toPublicUser(currentUser),
      recoveryConfigured: hasRecoveryConfigured(currentUser),
      ...stats
    });
  } catch (error) {
    console.error("Failed to load current user vote stats:", error);
    sendError(response, 500, "DATA_READ_ERROR", "用户投票状态读取失败");
  }
}

async function handleAdminGetBooks(request, response) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  await handleGetBooks(response);
}

async function handleAdminCreateBook(request, response) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  let completedBook;

  try {
    completedBook = await completeNewBookFields(payload);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_BOOK_PAYLOAD", error.message || "图书信息不合法");
    return;
  }

  try {
    const book = await enqueueDataWrite(async () => {
      const books = await readJsonFile(BOOK_FILE);
      assertValidBooks(books);
      const votes = await readJsonFile(VOTE_FILE);
      const voteData = normalizeVoteData(votes, books);
      const id = generateBookId(books);
      const newBook = {
        id,
        ...completedBook.bookFields
      };
      const nextBooks = [...books, newBook];
      const nextVoteData = {
        ...voteData,
        bookVotes: {
          ...voteData.bookVotes,
          [id]: 0
        }
      };

      await writeJsonFile(BOOK_FILE, nextBooks);
      await writeJsonFile(VOTE_FILE, nextVoteData);

      return {
        ...newBook,
        votes: 0,
        metadata: completedBook.metadata
      };
    });

    sendSuccess(response, book, 201);
  } catch (error) {
    console.error("Failed to create book:", error);
    sendError(response, 500, "BOOK_WRITE_ERROR", "图书数据写入失败");
  }
}

async function handleAdminRefreshBookCovers(request, response) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  try {
    const result = await enqueueDataWrite(refreshExistingBookRealCovers);
    sendSuccess(response, result);
  } catch (error) {
    console.error("Failed to refresh book covers:", error);
    sendError(response, 500, "BOOK_COVER_REFRESH_ERROR", "真实封面刷新失败");
  }
}

async function handleAdminUpdateBook(request, response, bookId) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  let payload;

  try {
    payload = await readRequestBody(request);
  } catch (error) {
    if (error.message === "REQUEST_BODY_TOO_LARGE") {
      sendError(response, 413, "REQUEST_BODY_TOO_LARGE", "请求体过大");
      return;
    }

    sendError(response, 400, "INVALID_JSON_BODY", "请求体不是合法 JSON");
    return;
  }

  let bookFields;

  try {
    bookFields = validateBookPayload(payload);
  } catch (error) {
    sendError(response, 400, error.code || "INVALID_BOOK_PAYLOAD", error.message || "图书信息不合法");
    return;
  }

  try {
    const result = await enqueueDataWrite(async () => {
      const books = await readJsonFile(BOOK_FILE);
      assertValidBooks(books);
      const bookIndex = books.findIndex((book) => book.id === bookId);

      if (bookIndex === -1) {
        throw createCodedError("BOOK_NOT_FOUND", "图书不存在");
      }

      const nextBooks = books.map((book) => (
        book.id === bookId ? { ...book, ...bookFields } : book
      ));
      const votes = await readJsonFile(VOTE_FILE);
      const voteData = normalizeVoteData(votes, nextBooks);

      await writeJsonFile(BOOK_FILE, nextBooks);

      return {
        ...nextBooks[bookIndex],
        votes: voteData.bookVotes[bookId] || 0
      };
    });

    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "BOOK_NOT_FOUND") {
      sendError(response, 404, "BOOK_NOT_FOUND", "图书不存在");
      return;
    }

    console.error("Failed to update book:", error);
    sendError(response, 500, "BOOK_WRITE_ERROR", "图书数据写入失败");
  }
}

async function handleAdminDeleteBook(request, response, bookId) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  try {
    const result = await enqueueDataWrite(async () => {
      const books = await readJsonFile(BOOK_FILE);
      assertValidBooks(books);
      const bookExists = books.some((book) => book.id === bookId);

      if (!bookExists) {
        throw createCodedError("BOOK_NOT_FOUND", "图书不存在");
      }

      const votes = await readJsonFile(VOTE_FILE);
      const voteData = normalizeVoteData(votes, books);
      const nextBooks = books.filter((book) => book.id !== bookId);
      const nextBookVotes = { ...voteData.bookVotes };
      delete nextBookVotes[bookId];

      const nextUserVotes = Object.fromEntries(
        Object.entries(voteData.userVotes).map(([userId, records]) => [
          userId,
          records.filter((record) => record.bookId !== bookId)
        ])
      );

      await writeJsonFile(BOOK_FILE, nextBooks);
      await writeJsonFile(VOTE_FILE, {
        bookVotes: nextBookVotes,
        userVotes: nextUserVotes
      });

      return {
        bookId,
        deleted: true
      };
    });

    sendSuccess(response, result);
  } catch (error) {
    if (error.code === "BOOK_NOT_FOUND") {
      sendError(response, 404, "BOOK_NOT_FOUND", "图书不存在");
      return;
    }

    console.error("Failed to delete book:", error);
    sendError(response, 500, "BOOK_WRITE_ERROR", "图书数据写入失败");
  }
}

async function handleAdminStartVoteRound(request, response) {
  if (!requireAdminUser(request, response)) {
    return;
  }

  try {
    const result = await enqueueDataWrite(async () => {
      const books = await readJsonFile(BOOK_FILE);
      assertValidBooks(books);
      const voteData = createDefaultVoteData(books);
      await writeJsonFile(VOTE_FILE, voteData);

      return {
        roundStarted: true,
        voteLimit: VOTE_LIMIT
      };
    });

    sendSuccess(response, result);
  } catch (error) {
    console.error("Failed to start vote round:", error);
    sendError(response, 500, "VOTE_ROUND_WRITE_ERROR", "新一轮投票写入失败");
  }
}

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    sendError(response, 400, "INVALID_PATH", "资源路径不合法");
    return;
  }

  const publicRoot = path.resolve(PUBLIC_DIR);
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);

  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    sendError(response, 403, "FORBIDDEN", "禁止访问该资源");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath);

    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendError(response, 404, "NOT_FOUND", "资源不存在");
      return;
    }

    console.error("Failed to serve static file:", error);
    sendError(response, 500, "STATIC_FILE_ERROR", "静态资源读取失败");
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/books") {
    await handleGetBooks(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/votes") {
    await handlePostVotes(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/register") {
    await handleRegister(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    await handleLogin(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    await handleLogout(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/change-password") {
    await handleChangePassword(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/recovery-settings") {
    await handleUpdateRecoverySettings(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/recovery-question") {
    await handleGetRecoveryQuestion(request, response, url.searchParams.get("username") || "");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/reset-password") {
    await handleResetPassword(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/password-reset-code") {
    await handleRequestPasswordResetCode(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/reset-password-by-code") {
    await handleResetPasswordByCode(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    await handleGetMe(request, response);
    return;
  }

  if (url.pathname === "/api/admin/books") {
    if (request.method === "GET") {
      await handleAdminGetBooks(request, response);
      return;
    }

    if (request.method === "POST") {
      await handleAdminCreateBook(request, response);
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/admin/books/refresh-covers") {
    await handleAdminRefreshBookCovers(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/vote-rounds") {
    await handleAdminStartVoteRound(request, response);
    return;
  }

  const adminBookMatch = /^\/api\/admin\/books\/([^/]+)$/.exec(url.pathname);
  if (adminBookMatch) {
    const bookId = decodeURIComponent(adminBookMatch[1]);

    if (request.method === "PATCH") {
      await handleAdminUpdateBook(request, response, bookId);
      return;
    }

    if (request.method === "DELETE") {
      await handleAdminDeleteBook(request, response, bookId);
      return;
    }
  }

  if (url.pathname.startsWith("/api/")) {
    sendError(response, 404, "API_NOT_FOUND", "接口不存在");
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendError(response, 405, "METHOD_NOT_ALLOWED", "请求方法不支持");
    return;
  }

  await serveStatic(request, response, url.pathname);
}

async function startServer() {
  await ensureDataFiles();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      console.error("Unhandled request error:", error);
      sendError(response, 500, "INTERNAL_SERVER_ERROR", "服务器内部错误");
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, () => {
      server.off("error", reject);
      console.log(`Book voting app is running at http://localhost:${PORT}`);
      resolve();
    });
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
