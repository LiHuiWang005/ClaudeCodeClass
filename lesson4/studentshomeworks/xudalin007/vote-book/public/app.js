const bookListElement = document.querySelector("#bookList");
const statusMessageElement = document.querySelector("#statusMessage");
const refreshButton = document.querySelector("#refreshButton");
const authSummaryText = document.querySelector("#authSummaryText");
const showLoginButton = document.querySelector("#showLoginButton");
const showRegisterButton = document.querySelector("#showRegisterButton");
const showForgotPasswordButton = document.querySelector("#showForgotPasswordButton");
const showChangePasswordButton = document.querySelector("#showChangePasswordButton");
const showRecoverySettingsButton = document.querySelector("#showRecoverySettingsButton");
const showAdminButton = document.querySelector("#showAdminButton");
const logoutButton = document.querySelector("#logoutButton");
const loginForm = document.querySelector("#loginForm");
const registerForm = document.querySelector("#registerForm");
const changePasswordForm = document.querySelector("#changePasswordForm");
const recoverySettingsForm = document.querySelector("#recoverySettingsForm");
const forgotPasswordForm = document.querySelector("#forgotPasswordForm");
const loginUsername = document.querySelector("#loginUsername");
const loginPassword = document.querySelector("#loginPassword");
const registerUsername = document.querySelector("#registerUsername");
const registerEmail = document.querySelector("#registerEmail");
const registerPassword = document.querySelector("#registerPassword");
const registerConfirmPassword = document.querySelector("#registerConfirmPassword");
const registerRecoveryQuestion = document.querySelector("#registerRecoveryQuestion");
const registerRecoveryAnswer = document.querySelector("#registerRecoveryAnswer");
const currentPassword = document.querySelector("#currentPassword");
const newPassword = document.querySelector("#newPassword");
const confirmNewPassword = document.querySelector("#confirmNewPassword");
const recoverySettingsEmail = document.querySelector("#recoverySettingsEmail");
const recoverySettingsQuestion = document.querySelector("#recoverySettingsQuestion");
const recoverySettingsAnswer = document.querySelector("#recoverySettingsAnswer");
const forgotAccount = document.querySelector("#forgotAccount");
const forgotEmail = document.querySelector("#forgotEmail");
const sendPasswordResetCodeButton = document.querySelector("#sendPasswordResetCodeButton");
const passwordResetCodeText = document.querySelector("#passwordResetCodeText");
const loadRecoveryQuestionButton = document.querySelector("#loadRecoveryQuestionButton");
const recoveryQuestionText = document.querySelector("#recoveryQuestionText");
const forgotEmailCode = document.querySelector("#forgotEmailCode");
const forgotRecoveryAnswer = document.querySelector("#forgotRecoveryAnswer");
const forgotNewPassword = document.querySelector("#forgotNewPassword");
const forgotConfirmNewPassword = document.querySelector("#forgotConfirmNewPassword");
const adminPanel = document.querySelector("#adminPanel");
const adminBookList = document.querySelector("#adminBookList");
const adminRefreshButton = document.querySelector("#adminRefreshButton");
const startVoteRoundButton = document.querySelector("#startVoteRoundButton");
const refreshBookCoversButton = document.querySelector("#refreshBookCoversButton");
const adminCreateBookForm = document.querySelector("#adminCreateBookForm");
const adminNewBookTitle = document.querySelector("#adminNewBookTitle");
const adminNewBookAuthor = document.querySelector("#adminNewBookAuthor");
const adminNewBookDescription = document.querySelector("#adminNewBookDescription");
const adminNewBookCoverUrl = document.querySelector("#adminNewBookCoverUrl");

let books = [];
let currentUser = null;
let currentVoteStats = {
  voteLimit: 3,
  usedVotes: 0,
  remainingVotes: 0
};
let loadedRecoveryUsername = "";

function setStatus(message, type = "default") {
  statusMessageElement.textContent = message;
  statusMessageElement.className = "status-message";

  if (type !== "default") {
    statusMessageElement.classList.add(type);
  }
}

function formatMetadataSource(source) {
  const sourceLabels = {
    "fallback": "兜底信息",
    "google-books": "Google Books",
    "local-catalog": "本地元数据",
    "manual": "手动填写",
    "open-library": "Open Library"
  };

  return String(source || "")
    .split("+")
    .filter(Boolean)
    .map((sourceName) => sourceLabels[sourceName] || sourceName)
    .join(" + ");
}

function formatMetadataConfidence(confidence) {
  const confidenceLabels = {
    high: "高",
    medium: "中",
    low: "低",
    none: "无",
    manual: "手动"
  };

  return confidenceLabels[confidence] || confidence;
}

function formatCreateBookStatus(metadata = {}) {
  const warnings = Array.isArray(metadata.warnings) ? metadata.warnings : [];
  const source = formatMetadataSource(metadata.source);
  const confidence = formatMetadataConfidence(metadata.confidence);
  const fetchedFields = [];

  if (metadata.descriptionFetched) {
    fetchedFields.push("简介");
  }

  if (metadata.coverFetched) {
    fetchedFields.push("封面");
  }

  const parts = [];
  if (fetchedFields.length > 0) {
    parts.push(`已补全${fetchedFields.join("和")}`);
  }

  if (source) {
    parts.push(`来源：${source}`);
  }

  if (confidence && !["手动", "无"].includes(confidence)) {
    parts.push(`匹配度：${confidence}`);
  }

  if (warnings.length > 0) {
    parts.push(...warnings);
  }

  return parts.length > 0 ? `图书已新增：${parts.join("；")}` : "图书已新增";
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function useDefaultCoverOnError(image) {
  image.addEventListener("error", () => {
    if (image.dataset.fallbackApplied) {
      return;
    }

    image.dataset.fallbackApplied = "true";
    image.src = "/covers/default.svg";
  });
}

function createBookCard(book) {
  const card = document.createElement("article");
  card.className = "book-card";
  card.dataset.bookId = book.id;

  const coverWrap = document.createElement("div");
  coverWrap.className = "cover-wrap";

  const cover = document.createElement("img");
  cover.src = book.coverUrl;
  cover.alt = `${book.title} 封面`;
  cover.loading = "lazy";
  useDefaultCoverOnError(cover);
  coverWrap.append(cover);

  const content = document.createElement("div");
  content.className = "book-content";

  const titleGroup = document.createElement("div");
  titleGroup.append(
    createTextElement("h3", "book-title", book.title),
    createTextElement("p", "book-author", book.author)
  );

  const description = createTextElement("p", "book-description", book.description);

  const footer = document.createElement("div");
  footer.className = "book-footer";

  const voteCount = document.createElement("div");
  voteCount.className = "vote-count";

  const voteNumber = createTextElement("strong", "vote-number", String(book.votes));
  const voteLabel = createTextElement("span", "", "当前票数");
  voteCount.append(voteNumber, voteLabel);

  const voteButton = document.createElement("button");
  voteButton.className = "vote-button";
  voteButton.type = "button";
  voteButton.dataset.bookId = book.id;

  if (!currentUser) {
    voteButton.textContent = "登录后投票";
  } else if (currentVoteStats.remainingVotes <= 0) {
    voteButton.textContent = "票数已用完";
    voteButton.disabled = true;
  } else {
    voteButton.textContent = "投票";
  }

  footer.append(voteCount, voteButton);
  content.append(titleGroup, description, footer);
  card.append(coverWrap, content);

  return card;
}

function renderBooks() {
  bookListElement.replaceChildren();

  if (books.length === 0) {
    bookListElement.append(createTextElement("div", "empty-state", "暂无图书数据"));
    return;
  }

  const fragment = document.createDocumentFragment();
  books.forEach((book) => {
    fragment.append(createBookCard(book));
  });
  bookListElement.append(fragment);
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    const message = payload.error?.message || "请求失败";
    throw new Error(message);
  }

  return payload.data;
}

function setFormDisabled(form, disabled) {
  form.querySelectorAll("button, input, textarea").forEach((element) => {
    element.disabled = disabled;
  });
}

function hideAuthForms() {
  loginForm.hidden = true;
  registerForm.hidden = true;
  changePasswordForm.hidden = true;
  recoverySettingsForm.hidden = true;
  forgotPasswordForm.hidden = true;
}

function showAuthForm(type) {
  const showLogin = type === "login";
  const showRegister = type === "register";
  const showChangePassword = type === "changePassword";
  const showRecoverySettings = type === "recoverySettings";
  const showForgotPassword = type === "forgotPassword";
  loginForm.hidden = !showLogin;
  registerForm.hidden = !showRegister;
  changePasswordForm.hidden = !showChangePassword;
  recoverySettingsForm.hidden = !showRecoverySettings;
  forgotPasswordForm.hidden = !showForgotPassword;

  if (showLogin) {
    loginUsername.focus();
    return;
  }

  if (showRegister) {
    registerUsername.focus();
    return;
  }

  if (showChangePassword) {
    currentPassword.focus();
    return;
  }

  if (showRecoverySettings) {
    recoverySettingsEmail.value = currentUser?.email || "";
    recoverySettingsEmail.focus();
    return;
  }

  if (showForgotPassword) {
    forgotAccount.focus();
  }
}

function togglePasswordVisibility(button) {
  const input = document.querySelector(`#${button.dataset.togglePassword}`);

  if (!input) {
    return;
  }

  const shouldShowPassword = input.type === "password";
  input.type = shouldShowPassword ? "text" : "password";
  button.textContent = shouldShowPassword ? "隐藏" : "显示";
  button.setAttribute("aria-pressed", String(shouldShowPassword));
}

function renderAuthState() {
  const isLoggedIn = Boolean(currentUser);

  if (isLoggedIn) {
    const roleText = currentUser.role === "admin" ? "管理员" : "普通用户";
    const recoveryText = currentUser.recoveryConfigured ? "已设置找回凭证" : "未设置找回凭证";
    authSummaryText.textContent = `当前用户：${currentUser.username}（${roleText}），剩余票数：${currentVoteStats.remainingVotes}/${currentVoteStats.voteLimit}，${recoveryText}`;
  } else {
    authSummaryText.textContent = "当前未登录，可以浏览图书；登录后才能投票。";
  }

  showLoginButton.hidden = isLoggedIn;
  showRegisterButton.hidden = isLoggedIn;
  showForgotPasswordButton.hidden = isLoggedIn;
  showChangePasswordButton.hidden = !isLoggedIn;
  showRecoverySettingsButton.hidden = !isLoggedIn;
  showAdminButton.hidden = !isLoggedIn || currentUser.role !== "admin";
  logoutButton.hidden = !isLoggedIn;

  if (isLoggedIn) {
    hideAuthForms();
  }

  if (!isLoggedIn || currentUser.role !== "admin") {
    adminPanel.hidden = true;
  }
}

async function loadCurrentUser() {
  try {
    const data = await requestJson("/api/auth/me");
    currentUser = data.authenticated ? data.user : null;
    currentVoteStats = {
      voteLimit: data.voteLimit ?? 3,
      usedVotes: data.usedVotes ?? 0,
      remainingVotes: data.remainingVotes ?? 0
    };
    renderAuthState();
    renderBooks();
  } catch (error) {
    currentUser = null;
    currentVoteStats = {
      voteLimit: 3,
      usedVotes: 0,
      remainingVotes: 0
    };
    renderAuthState();
    renderBooks();
    setStatus(error.message || "登录状态检查失败", "error");
  }
}

function validateUsernameInput(username) {
  const normalizedUsername = username.trim();

  if (!/^[\u4e00-\u9fa5A-Za-z0-9_-]{2,32}$/.test(normalizedUsername)) {
    throw new Error("用户名需为 2-32 位中文、字母、数字、下划线或短横线");
  }

  return normalizedUsername;
}

function validateAuthInput(username, password) {
  const normalizedUsername = validateUsernameInput(username);
  validatePasswordInput(password);

  return normalizedUsername;
}

function validatePasswordInput(password) {
  if (password.length < 6 || password.length > 128) {
    throw new Error("密码长度需为 6-128 位");
  }
}

function validateEmailInput(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("邮箱格式不合法");
  }

  return normalizedEmail;
}

function validateAccountInput(account) {
  const normalizedAccount = String(account || "").trim();

  if (!normalizedAccount) {
    throw new Error("请输入要重置密码的用户名");
  }

  return validateUsernameInput(normalizedAccount);
}

function validateEmailCodeInput(code) {
  const normalizedCode = String(code || "").trim();

  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new Error("验证码需为 6 位数字");
  }

  return normalizedCode;
}

function validateRecoveryQuestionInput(question) {
  const normalizedQuestion = question.trim();

  if (normalizedQuestion.length < 1 || normalizedQuestion.length > 120) {
    throw new Error("找回问题长度需为 1-120 个字符");
  }

  return normalizedQuestion;
}

function validateRecoveryAnswerInput(answer) {
  const normalizedAnswer = answer.trim();

  if (normalizedAnswer.length < 1 || normalizedAnswer.length > 128) {
    throw new Error("找回答案长度需为 1-128 个字符");
  }

  return normalizedAnswer;
}

async function handleRegisterSubmit(event) {
  event.preventDefault();

  let username;
  let email;
  let recoveryQuestion;
  let recoveryAnswer;

  try {
    username = validateAuthInput(registerUsername.value, registerPassword.value);
    email = validateEmailInput(registerEmail.value);
    recoveryQuestion = validateRecoveryQuestionInput(registerRecoveryQuestion.value);
    recoveryAnswer = validateRecoveryAnswerInput(registerRecoveryAnswer.value);

    if (registerPassword.value !== registerConfirmPassword.value) {
      throw new Error("两次输入的密码不一致");
    }
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setFormDisabled(registerForm, true);
  setStatus("正在注册...");

  try {
    await requestJson("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        email,
        password: registerPassword.value,
        recoveryQuestion,
        recoveryAnswer
      })
    });

    registerForm.reset();
    loginUsername.value = username;
    loginPassword.value = "";
    showAuthForm("login");
    setStatus("注册成功，请登录", "success");
  } catch (error) {
    setStatus(error.message || "注册失败", "error");
  } finally {
    setFormDisabled(registerForm, false);
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  let username;

  try {
    username = validateAuthInput(loginUsername.value, loginPassword.value);
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setFormDisabled(loginForm, true);
  setStatus("正在登录...");

  try {
    await requestJson("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password: loginPassword.value
      })
    });

    loginForm.reset();
    await loadCurrentUser();
    setStatus("登录成功", "success");
  } catch (error) {
    setStatus(error.message || "登录失败", "error");
  } finally {
    setFormDisabled(loginForm, false);
  }
}

async function handleLogout() {
  logoutButton.disabled = true;
  setStatus("正在退出登录...");

  try {
    await requestJson("/api/auth/logout", {
      method: "POST"
    });

    currentUser = null;
    currentVoteStats = {
      voteLimit: 3,
      usedVotes: 0,
      remainingVotes: 0
    };
    renderAuthState();
    renderBooks();
    setStatus("已退出登录", "success");
  } catch (error) {
    setStatus(error.message || "退出登录失败", "error");
  } finally {
    logoutButton.disabled = false;
  }
}

async function handleChangePasswordSubmit(event) {
  event.preventDefault();

  if (!currentUser) {
    setStatus("请先登录后再修改密码", "error");
    showAuthForm("login");
    return;
  }

  try {
    validatePasswordInput(currentPassword.value);
    validatePasswordInput(newPassword.value);

    if (newPassword.value !== confirmNewPassword.value) {
      throw new Error("两次输入的新密码不一致");
    }
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setFormDisabled(changePasswordForm, true);
  setStatus("正在修改密码...");

  try {
    await requestJson("/api/auth/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value
      })
    });

    changePasswordForm.reset();
    hideAuthForms();
    setStatus("密码修改成功，请使用新密码登录", "success");
  } catch (error) {
    setStatus(error.message || "密码修改失败", "error");
  } finally {
    setFormDisabled(changePasswordForm, false);
  }
}

async function handleRecoverySettingsSubmit(event) {
  event.preventDefault();

  if (!currentUser) {
    setStatus("请先登录后再设置找回凭证", "error");
    showAuthForm("login");
    return;
  }

  let recoveryQuestion;
  let recoveryAnswer;
  let email;

  try {
    email = validateEmailInput(recoverySettingsEmail.value);
    recoveryQuestion = validateRecoveryQuestionInput(recoverySettingsQuestion.value);
    recoveryAnswer = validateRecoveryAnswerInput(recoverySettingsAnswer.value);
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setFormDisabled(recoverySettingsForm, true);
  setStatus("正在保存找回凭证...");

  try {
    await requestJson("/api/auth/recovery-settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        recoveryQuestion,
        recoveryAnswer
      })
    });

    recoverySettingsForm.reset();
    await loadCurrentUser();
    setStatus("E-mail 和找回凭证已更新", "success");
  } catch (error) {
    setStatus(error.message || "找回凭证保存失败", "error");
  } finally {
    setFormDisabled(recoverySettingsForm, false);
  }
}

async function loadRecoveryQuestion() {
  let username;

  try {
    username = validateUsernameInput(forgotAccount.value);
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  loadRecoveryQuestionButton.disabled = true;
  recoveryQuestionText.textContent = "正在获取找回问题...";
  setStatus("正在获取找回问题...");

  try {
    const data = await requestJson(`/api/auth/recovery-question?username=${encodeURIComponent(username)}`);
    loadedRecoveryUsername = data.username;
    recoveryQuestionText.textContent = `找回问题：${data.recoveryQuestion}`;
    setStatus("找回问题已获取，请填写答案和新密码", "success");
  } catch (error) {
    loadedRecoveryUsername = "";
    recoveryQuestionText.textContent = "未能获取找回问题。";
    setStatus(error.message || "找回问题获取失败", "error");
  } finally {
    loadRecoveryQuestionButton.disabled = false;
  }
}

async function sendPasswordResetCode() {
  let account;
  let email;

  try {
    account = validateAccountInput(forgotAccount.value);
    email = validateEmailInput(forgotEmail.value);
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  sendPasswordResetCodeButton.disabled = true;
  passwordResetCodeText.textContent = "正在发送邮箱验证码...";
  setStatus("正在发送邮箱验证码...");

  try {
    const result = await requestJson("/api/auth/password-reset-code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ account, email })
    });

    passwordResetCodeText.textContent = `验证码已发送至 ${email}，${Math.floor(result.expiresInSeconds / 60)} 分钟内有效，最多可输错 ${result.maxAttempts} 次。`;
    setStatus("验证码已发送，请检查接收邮箱", "success");
  } catch (error) {
    passwordResetCodeText.textContent = "验证码发送失败，可检查邮箱配置或使用找回问题。";
    setStatus(error.message || "验证码发送失败", "error");
  } finally {
    sendPasswordResetCodeButton.disabled = false;
  }
}

async function handleForgotPasswordSubmit(event) {
  event.preventDefault();

  let account;
  let email;

  try {
    account = validateAccountInput(forgotAccount.value);
    validatePasswordInput(forgotNewPassword.value);

    if (forgotNewPassword.value !== forgotConfirmNewPassword.value) {
      throw new Error("两次输入的新密码不一致");
    }
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setFormDisabled(forgotPasswordForm, true);
  setStatus("正在重置密码...");

  try {
    const emailCode = String(forgotEmailCode.value || "").trim();

    if (emailCode) {
      email = validateEmailInput(forgotEmail.value);
      const code = validateEmailCodeInput(emailCode);
      await requestJson("/api/auth/reset-password-by-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          account,
          email,
          code,
          newPassword: forgotNewPassword.value
        })
      });
    } else {
      const username = validateUsernameInput(account);
      const recoveryAnswer = validateRecoveryAnswerInput(forgotRecoveryAnswer.value);

      if (!loadedRecoveryUsername || loadedRecoveryUsername.toLowerCase() !== username.toLowerCase()) {
        throw new Error("请先获取当前用户名的找回问题，或填写邮箱验证码");
      }

      await requestJson("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username,
          recoveryAnswer,
          newPassword: forgotNewPassword.value
        })
      });
    }

    forgotPasswordForm.reset();
    loadedRecoveryUsername = "";
    recoveryQuestionText.textContent = "如无法接收邮件，可只输入用户名后使用找回问题。";
    passwordResetCodeText.textContent = "输入用户名和任意接收邮箱后发送验证码；验证码 10 分钟内有效，输错 3 次后失效。";
    loginUsername.value = account;
    loginPassword.value = "";
    showAuthForm("login");
    setStatus("密码已重置，请使用新密码登录", "success");
  } catch (error) {
    setStatus(error.message || "密码重置失败", "error");
  } finally {
    setFormDisabled(forgotPasswordForm, false);
  }
}

async function loadBooks() {
  refreshButton.disabled = true;
  setStatus("正在加载图书列表...");

  try {
    books = await requestJson("/api/books");
    renderBooks();
    setStatus("图书列表已更新", "success");
  } catch (error) {
    books = [];
    renderBooks();
    setStatus(error.message || "图书列表加载失败", "error");
  } finally {
    refreshButton.disabled = false;
  }
}

function updateBookVotes(bookId, votes) {
  books = books.map((book) => (
    book.id === bookId ? { ...book, votes } : book
  ));

  const card = bookListElement.querySelector(`[data-book-id="${bookId}"]`);
  const voteNumber = card?.querySelector(".vote-number");

  if (voteNumber) {
    voteNumber.textContent = String(votes);
  }
}

async function submitVote(bookId, button) {
  if (!currentUser) {
    setStatus("请先登录后再投票", "error");
    showAuthForm("login");
    return;
  }

  if (currentVoteStats.remainingVotes <= 0) {
    setStatus("每个用户最多可投 3 票", "error");
    renderBooks();
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "投票中...";
  setStatus("正在提交投票...");

  try {
    const result = await requestJson("/api/votes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ bookId })
    });

    updateBookVotes(result.bookId, result.votes);
    currentVoteStats = {
      ...currentVoteStats,
      usedVotes: result.userVoteCount,
      remainingVotes: result.remainingVotes
    };
    renderAuthState();
    renderBooks();
    setStatus("投票成功，票数已更新", "success");
  } catch (error) {
    if (error.message.includes("最多可投")) {
      currentVoteStats.remainingVotes = 0;
      renderAuthState();
      renderBooks();
    }

    setStatus(error.message || "投票失败，请稍后重试", "error");
  } finally {
    button.disabled = currentVoteStats.remainingVotes <= 0;
    button.textContent = originalText;
  }
}

function validateAdminBookFields(fields, options = {}) {
  const requireDetails = options.requireDetails !== false;
  const bookFields = {
    title: String(fields.title || "").trim(),
    author: String(fields.author || "").trim(),
    description: String(fields.description || "").trim(),
    coverUrl: String(fields.coverUrl || "").trim()
  };

  if (!bookFields.title) {
    throw new Error("书名不能为空");
  }

  if (!bookFields.author) {
    throw new Error("作者不能为空");
  }

  if (requireDetails && !bookFields.description) {
    throw new Error("简介不能为空");
  }

  if (bookFields.description.length > 300) {
    throw new Error("简介长度不能超过 300 个字符");
  }

  if (requireDetails && !bookFields.coverUrl) {
    throw new Error("封面地址不能为空");
  }

  if (bookFields.coverUrl && (!/^(\/|https?:\/\/)/.test(bookFields.coverUrl) || /\s/.test(bookFields.coverUrl))) {
    throw new Error("封面地址需以 /、http:// 或 https:// 开头，且不能包含空格");
  }

  return bookFields;
}

function createAdminBookField(labelText, value, datasetKey, options = {}) {
  const label = document.createElement("label");
  label.textContent = labelText;

  const field = document.createElement(options.multiline ? "textarea" : "input");
  if (!options.multiline) {
    field.type = "text";
  }

  field.value = value || "";
  field.maxLength = options.maxLength;
  field.dataset[datasetKey] = "true";

  if (options.rows) {
    field.rows = options.rows;
  }

  label.append(field);
  return label;
}

function readAdminBookRow(row) {
  return validateAdminBookFields({
    title: row.querySelector("[data-book-title-input]").value,
    author: row.querySelector("[data-book-author-input]").value,
    description: row.querySelector("[data-book-description-input]").value,
    coverUrl: row.querySelector("[data-book-cover-url-input]").value
  }, { requireDetails: true });
}

function renderAdminBooks(adminBooks) {
  adminBookList.replaceChildren();

  if (adminBooks.length === 0) {
    adminBookList.append(createTextElement("div", "empty-state", "暂无图书数据"));
    return;
  }

  const fragment = document.createDocumentFragment();

  adminBooks.forEach((book) => {
    const row = document.createElement("article");
    row.className = "admin-book-row";
    row.dataset.bookId = book.id;

    const cover = document.createElement("img");
    cover.className = "admin-book-cover";
    cover.src = book.coverUrl;
    cover.alt = `${book.title} 封面`;
    useDefaultCoverOnError(cover);

    const fields = document.createElement("div");
    fields.className = "admin-book-fields";
    fields.append(
      createAdminBookField("书名", book.title, "bookTitleInput", { maxLength: 80 }),
      createAdminBookField("作者", book.author, "bookAuthorInput", { maxLength: 80 }),
      createAdminBookField("简介", book.description, "bookDescriptionInput", {
        maxLength: 300,
        multiline: true,
        rows: 3
      }),
      createAdminBookField("封面地址", book.coverUrl, "bookCoverUrlInput", { maxLength: 300 }),
      createTextElement("p", "admin-book-meta", `ID：${book.id} · 当前票数：${book.votes}`)
    );

    const actions = document.createElement("div");
    actions.className = "admin-row-actions";

    const saveButton = document.createElement("button");
    saveButton.className = "secondary-button";
    saveButton.type = "button";
    saveButton.dataset.adminAction = "save";
    saveButton.textContent = "保存信息";

    const deleteButton = document.createElement("button");
    deleteButton.className = "secondary-button";
    deleteButton.type = "button";
    deleteButton.dataset.adminAction = "delete";
    deleteButton.textContent = "删除图书";

    actions.append(saveButton, deleteButton);
    row.append(cover, fields, actions);
    fragment.append(row);
  });

  adminBookList.append(fragment);
}

async function loadAdminBooks() {
  if (!currentUser || currentUser.role !== "admin") {
    setStatus("只有管理员可以访问后台", "error");
    return;
  }

  adminRefreshButton.disabled = true;
  setStatus("正在加载后台图书数据...");

  try {
    const adminBooks = await requestJson("/api/admin/books");
    renderAdminBooks(adminBooks);
    setStatus("后台图书数据已更新", "success");
  } catch (error) {
    setStatus(error.message || "后台图书数据加载失败", "error");
  } finally {
    adminRefreshButton.disabled = false;
  }
}

async function createAdminBook(event) {
  event.preventDefault();
  let bookFields;

  try {
    bookFields = validateAdminBookFields({
      title: adminNewBookTitle.value,
      author: adminNewBookAuthor.value,
      description: adminNewBookDescription.value,
      coverUrl: adminNewBookCoverUrl.value
    }, { requireDetails: false });
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setFormDisabled(adminCreateBookForm, true);
  setStatus("正在联网抓取真实封面和简介，请稍候...");

  try {
    const result = await requestJson("/api/admin/books", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(bookFields)
    });
    adminCreateBookForm.reset();
    await loadBooks();
    await loadAdminBooks();
    setStatus(formatCreateBookStatus(result.metadata), "success");
  } catch (error) {
    setStatus(error.message || "新增图书失败", "error");
  } finally {
    setFormDisabled(adminCreateBookForm, false);
  }
}

async function updateAdminBook(row) {
  const bookId = row.dataset.bookId;
  let bookFields;

  try {
    bookFields = readAdminBookRow(row);
  } catch (error) {
    setStatus(error.message, "error");
    return;
  }

  setStatus("正在保存图书信息...");

  try {
    await requestJson(`/api/admin/books/${encodeURIComponent(bookId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(bookFields)
    });
    await loadBooks();
    await loadAdminBooks();
    setStatus("图书信息已更新", "success");
  } catch (error) {
    setStatus(error.message || "保存图书信息失败", "error");
  }
}

async function deleteAdminBook(row) {
  const bookId = row.dataset.bookId;
  const input = row.querySelector("[data-book-title-input]");
  const confirmed = window.confirm(`确定删除《${input.value}》吗？此操作会同步清理该书票数。`);

  if (!confirmed) {
    return;
  }

  setStatus("正在删除图书...");

  try {
    await requestJson(`/api/admin/books/${encodeURIComponent(bookId)}`, {
      method: "DELETE"
    });
    await loadBooks();
    await loadAdminBooks();
    await loadCurrentUser();
    setStatus("图书已删除", "success");
  } catch (error) {
    setStatus(error.message || "删除图书失败", "error");
  }
}

async function startNewVoteRound() {
  const confirmed = window.confirm("确定发起新一轮投票吗？这会清空所有当前票数和用户投票记录，每个用户将重新获得 3 票。");

  if (!confirmed) {
    return;
  }

  startVoteRoundButton.disabled = true;
  setStatus("正在发起新一轮投票...");

  try {
    await requestJson("/api/admin/vote-rounds", {
      method: "POST"
    });
    await loadBooks();
    await loadCurrentUser();

    if (!adminPanel.hidden) {
      await loadAdminBooks();
    }

    setStatus("新一轮投票已开始，所有票数已清零", "success");
  } catch (error) {
    setStatus(error.message || "发起新一轮投票失败", "error");
  } finally {
    startVoteRoundButton.disabled = false;
  }
}

async function refreshRealBookCovers() {
  if (!currentUser || currentUser.role !== "admin") {
    setStatus("只有管理员可以刷新真实封面", "error");
    return;
  }

  refreshBookCoversButton.disabled = true;
  setStatus("正在联网刷新已有图书真实封面，请稍候...");

  try {
    const result = await requestJson("/api/admin/books/refresh-covers", {
      method: "POST"
    });
    await loadBooks();
    await loadAdminBooks();

    const failedItems = (result.results || []).filter((item) => !item.updated);
    const warningText = failedItems.length > 0
      ? `；${failedItems.length} 本未更新，可查看后台封面地址或稍后重试`
      : "";
    setStatus(`真实封面刷新完成，已更新 ${result.updatedCount}/${result.total} 本${warningText}`, "success");
  } catch (error) {
    setStatus(error.message || "刷新真实封面失败", "error");
  } finally {
    refreshBookCoversButton.disabled = false;
  }
}

bookListElement.addEventListener("click", (event) => {
  const button = event.target.closest(".vote-button");

  if (!button) {
    return;
  }

  submitVote(button.dataset.bookId, button);
});

refreshButton.addEventListener("click", loadBooks);
showLoginButton.addEventListener("click", () => showAuthForm("login"));
showRegisterButton.addEventListener("click", () => showAuthForm("register"));
showForgotPasswordButton.addEventListener("click", () => showAuthForm("forgotPassword"));
showChangePasswordButton.addEventListener("click", () => showAuthForm("changePassword"));
showRecoverySettingsButton.addEventListener("click", () => showAuthForm("recoverySettings"));
showAdminButton.addEventListener("click", () => {
  adminPanel.hidden = !adminPanel.hidden;

  if (!adminPanel.hidden) {
    loadAdminBooks();
  }
});
logoutButton.addEventListener("click", handleLogout);
loginForm.addEventListener("submit", handleLoginSubmit);
registerForm.addEventListener("submit", handleRegisterSubmit);
changePasswordForm.addEventListener("submit", handleChangePasswordSubmit);
recoverySettingsForm.addEventListener("submit", handleRecoverySettingsSubmit);
loadRecoveryQuestionButton.addEventListener("click", loadRecoveryQuestion);
sendPasswordResetCodeButton.addEventListener("click", sendPasswordResetCode);
forgotPasswordForm.addEventListener("submit", handleForgotPasswordSubmit);
adminRefreshButton.addEventListener("click", loadAdminBooks);
startVoteRoundButton.addEventListener("click", startNewVoteRound);
refreshBookCoversButton.addEventListener("click", refreshRealBookCovers);
adminCreateBookForm.addEventListener("submit", createAdminBook);

document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => togglePasswordVisibility(button));
});

adminBookList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-admin-action]");

  if (!button) {
    return;
  }

  const row = button.closest(".admin-book-row");

  if (button.dataset.adminAction === "save") {
    updateAdminBook(row);
    return;
  }

  if (button.dataset.adminAction === "delete") {
    deleteAdminBook(row);
  }
});

document.querySelectorAll("[data-auth-cancel]").forEach((button) => {
  button.addEventListener("click", () => {
    hideAuthForms();
    setStatus("已取消认证操作");
  });
});

loadCurrentUser();
loadBooks();
