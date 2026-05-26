const path = require("node:path");
const net = require("node:net");
const tls = require("node:tls");
const { readFileSync } = require("node:fs");

const ROOT_DIR = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT_DIR, ".env");

function loadEnvFile(filePath) {
  let content;

  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
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

  return true;
}

function requireEnv(name) {
  const value = (process.env[name] || "").trim();

  if (!value) {
    throw new Error(`缺少 ${name}`);
  }

  return value;
}

function rejectPlaceholder(name, value) {
  const placeholderValues = new Set([
    "your-address@gmail.com",
    "your-app-password",
    "your-qq-mail-authorization-code",
    "receiver@example.com"
  ]);

  if (placeholderValues.has(value)) {
    throw new Error(`${name} 仍是模板占位值，请改成真实配置`);
  }
}

function getSmtpConfig() {
  const host = requireEnv("SMTP_HOST");
  const port = Number(process.env.SMTP_PORT || 587);
  const user = requireEnv("SMTP_USER");
  const pass = requireEnv("SMTP_PASS");
  const from = (process.env.SMTP_FROM || user).trim();
  const to = (process.env.SMTP_TEST_TO || from).trim();
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";

  rejectPlaceholder("SMTP_USER", user);
  rejectPlaceholder("SMTP_PASS", pass);
  rejectPlaceholder("SMTP_FROM", from);
  rejectPlaceholder("SMTP_TEST_TO", to);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT 必须是 1-65535 之间的端口号");
  }

  if (!from) {
    throw new Error("缺少 SMTP_FROM");
  }

  if (!to) {
    throw new Error("缺少 SMTP_TEST_TO");
  }

  return {
    host,
    port,
    user,
    pass,
    from,
    to,
    secure
  };
}

function createSmtpMessage({ from, to }) {
  const now = new Date().toISOString();

  return [
    `From: ${from}`,
    `To: ${to}`,
    "Subject: SMTP test for vote-book",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `这是一封 SMTP 配置测试邮件。发送时间：${now}`,
    "如果你收到这封邮件，说明图书投票应用的 SMTP 配置可用。"
  ].join("\r\n");
}

function waitForSmtpResponse(socket, command, expectedCodes) {
  return new Promise((resolve, reject) => {
    let responseText = "";

    const cleanup = () => {
      socket.off("data", handleData);
      socket.off("error", handleError);
      socket.off("timeout", handleTimeout);
    };

    const handleError = (error) => {
      cleanup();
      reject(error);
    };

    const handleTimeout = () => {
      cleanup();
      reject(new Error("SMTP 连接超时"));
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
        reject(new Error(`SMTP 返回异常：${lastLine}`));
        return;
      }

      resolve(responseText);
    };

    socket.on("data", handleData);
    socket.on("error", handleError);
    socket.on("timeout", handleTimeout);

    if (command) {
      socket.write(`${command}\r\n`);
    }
  });
}

async function sendTestEmail(config) {
  const tlsOptions = net.isIP(config.host) ? {} : { servername: config.host };
  let socket;

  try {
    socket = config.secure
      ? tls.connect(config.port, config.host, tlsOptions)
      : net.connect(config.port, config.host);
    socket.setTimeout(15000);

    await waitForSmtpResponse(socket, "", [220]);
    await waitForSmtpResponse(socket, `EHLO ${config.host}`, [250]);

    if (!config.secure) {
      await waitForSmtpResponse(socket, "STARTTLS", [220]);
      socket = await new Promise((resolve, reject) => {
        const secureSocket = tls.connect({
          socket,
          ...tlsOptions
        }, () => resolve(secureSocket));
        secureSocket.once("error", reject);
      });
      socket.setTimeout(15000);
      await waitForSmtpResponse(socket, `EHLO ${config.host}`, [250]);
    }

    await waitForSmtpResponse(socket, "AUTH LOGIN", [334]);
    await waitForSmtpResponse(socket, Buffer.from(config.user).toString("base64"), [334]);
    await waitForSmtpResponse(socket, Buffer.from(config.pass).toString("base64"), [235]);
    await waitForSmtpResponse(socket, `MAIL FROM:<${config.from}>`, [250]);
    await waitForSmtpResponse(socket, `RCPT TO:<${config.to}>`, [250, 251]);
    await waitForSmtpResponse(socket, "DATA", [354]);
    await waitForSmtpResponse(socket, `${createSmtpMessage(config)}\r\n.`, [250]);
    await waitForSmtpResponse(socket, "QUIT", [221]);
  } finally {
    if (socket) {
      socket.destroy();
    }
  }
}

async function main() {
  const envLoaded = loadEnvFile(ENV_FILE);
  const config = getSmtpConfig();

  console.log(`SMTP 配置来源：${envLoaded ? ".env + 当前环境变量" : "当前环境变量"}`);
  console.log(`SMTP 主机：${config.host}:${config.port}`);
  console.log(`SMTP TLS：${config.secure ? "直接 TLS" : "STARTTLS"}`);
  console.log(`SMTP 用户：${config.user}`);
  console.log(`发件人：${config.from}`);
  console.log(`测试收件人：${config.to}`);

  await sendTestEmail(config);
  console.log("SMTP 测试邮件发送成功。");
}

main().catch((error) => {
  console.error("SMTP 检测失败：", error.message);
  console.error("排查建议：检查 SMTP_HOST/SMTP_PORT/SMTP_SECURE 是否匹配，SMTP_USER 是否完整，SMTP_PASS 是否为授权码或应用专用密码。");
  process.exit(1);
});
