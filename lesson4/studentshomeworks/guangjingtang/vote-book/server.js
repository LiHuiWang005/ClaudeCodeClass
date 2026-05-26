import express from "express";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "127.0.0.1";
const bookDataPath = path.join(__dirname, "data", "book.json");
const userDataPath = path.join(__dirname, "data", "users.json");
const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function readJsonFile(filePath, options = {}) {
  try {
    const file = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(file);

    if (options.expectArray && !Array.isArray(data)) {
      const error = new Error(`${options.name || "Data"} must be an array.`);
      error.status = 500;
      error.publicMessage = options.invalidShapeMessage || "数据格式异常";
      throw error;
    }

    return data;
  } catch (error) {
    if (error.code === "ENOENT") {
      if (options.defaultValue !== undefined) {
        await writeJsonFile(filePath, options.defaultValue, options.writeErrorMessage);
        return options.defaultValue;
      }

      error.status = 500;
      error.publicMessage = options.missingMessage || "数据文件缺失";
      throw error;
    }

    if (error instanceof SyntaxError) {
      error.status = 500;
      error.publicMessage = options.parseMessage || "数据格式异常";
      throw error;
    }

    error.status = error.status || 500;
    error.publicMessage = error.publicMessage || options.readErrorMessage || "读取数据失败";
    throw error;
  }
}

async function writeJsonFile(filePath, data, publicMessage = "数据保存失败") {
  try {
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  } catch (error) {
    error.status = 500;
    error.publicMessage = publicMessage;
    throw error;
  }
}

async function readBooks() {
  return readJsonFile(bookDataPath, {
    expectArray: true,
    name: "Book data",
    missingMessage: "图书数据文件缺失",
    parseMessage: "图书数据格式异常",
    invalidShapeMessage: "图书数据格式异常",
    readErrorMessage: "读取图书数据失败"
  });
}

async function writeBooks(books) {
  await writeJsonFile(bookDataPath, books, "投票保存失败");
}

async function readUsers() {
  return readJsonFile(userDataPath, {
    expectArray: true,
    name: "User data",
    defaultValue: [],
    missingMessage: "用户数据文件缺失",
    parseMessage: "用户数据格式异常",
    invalidShapeMessage: "用户数据格式异常",
    readErrorMessage: "读取用户数据失败",
    writeErrorMessage: "初始化用户数据失败"
  });
}

async function writeUsers(users) {
  await writeJsonFile(userDataPath, users, "用户数据保存失败");
}

function createHttpError(status, publicMessage) {
  const error = new Error(publicMessage);
  error.status = status;
  error.publicMessage = publicMessage;
  return error;
}

function normalizeUsername(username) {
  return String(username || "").trim();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, salt, hash] = String(storedHash || "").split(":");

  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createToken(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    createdAt: new Date().toISOString()
  });
  return token;
}

function getBearerToken(req) {
  const authorization = req.get("authorization") || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return "";
  }

  return token;
}

async function getCurrentUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  const users = await readUsers();
  const user = users.find((item) => item.id === session.userId);

  if (!user) {
    sessions.delete(token);
    return null;
  }

  return toPublicUser(user);
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username
  };
}

function sendError(res, error) {
  const status = error.status || 500;
  res.status(status).json({
    success: false,
    message: error.publicMessage || "服务器错误"
  });
}

app.get("/api/books", async (req, res) => {
  try {
    const books = await readBooks();
    res.json({
      success: true,
      data: books
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/books/:id/vote", async (req, res) => {
  try {
    const currentUser = await getCurrentUser(req);

    if (!currentUser) {
      throw createHttpError(401, "请先登录后再投票");
    }

    const books = await readBooks();
    const book = books.find((item) => item.id === req.params.id);

    if (!book) {
      return res.status(404).json({
        success: false,
        message: "图书不存在"
      });
    }

    book.votes = Number(book.votes || 0) + 1;
    await writeBooks(books);

    res.json({
      success: true,
      data: {
        id: book.id,
        votes: book.votes
      }
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    if (!username) {
      throw createHttpError(400, "用户名不能为空");
    }

    if (password.length < 6) {
      throw createHttpError(400, "密码至少需要 6 位");
    }

    const users = await readUsers();
    const usernameExists = users.some(
      (user) => user.username.toLowerCase() === username.toLowerCase()
    );

    if (usernameExists) {
      throw createHttpError(409, "用户名已存在");
    }

    const user = {
      id: `user-${crypto.randomUUID()}`,
      username,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString()
    };

    users.push(user);
    await writeUsers(users);

    res.status(201).json({
      success: true,
      data: toPublicUser(user)
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    if (!username || !password) {
      throw createHttpError(400, "请输入用户名和密码");
    }

    const users = await readUsers();
    const user = users.find((item) => item.username.toLowerCase() === username.toLowerCase());

    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw createHttpError(401, "用户名或密码错误");
    }

    const token = createToken(user);

    res.json({
      success: true,
      data: {
        token,
        user: toPublicUser(user)
      }
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      throw createHttpError(401, "未登录");
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    sendError(res, error);
  }
});

app.post("/api/auth/logout", (req, res) => {
  const token = getBearerToken(req);

  if (token) {
    sessions.delete(token);
  }

  res.json({
    success: true
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "接口不存在"
  });
});

app.listen(port, host, () => {
  console.log(`Book voting app is running at http://${host}:${port}`);
});
