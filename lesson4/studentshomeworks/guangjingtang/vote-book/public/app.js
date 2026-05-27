const bookList = document.querySelector("#bookList");
const bookCount = document.querySelector("#bookCount");
const totalVotes = document.querySelector("#totalVotes");
const statusMessage = document.querySelector("#statusMessage");
const template = document.querySelector("#bookCardTemplate");
const authForms = document.querySelector("#authForms");
const signedInView = document.querySelector("#signedInView");
const currentUser = document.querySelector("#currentUser");
const loginForm = document.querySelector("#loginForm");
const registerForm = document.querySelector("#registerForm");
const logoutButton = document.querySelector("#logoutButton");

let books = [];
let authToken = localStorage.getItem("bookVoteToken") || "";
let activeUser = null;

function getAuthHeaders() {
  if (!authToken) {
    return {};
  }

  return {
    Authorization: `Bearer ${authToken}`
  };
}

function setStatus(message, type = "info") {
  statusMessage.textContent = message;
  statusMessage.dataset.type = type;
  statusMessage.hidden = !message;
}

function updateSummary() {
  const total = books.reduce((sum, book) => sum + Number(book.votes || 0), 0);
  totalVotes.textContent = total;
  bookCount.textContent = `${books.length} 本`;
}

function renderAuth() {
  if (activeUser) {
    currentUser.textContent = activeUser.username;
    signedInView.hidden = false;
    authForms.hidden = true;
  } else {
    currentUser.textContent = "";
    signedInView.hidden = true;
    authForms.hidden = false;
  }

  renderVoteButtons();
}

function renderVoteButtons() {
  const buttons = bookList.querySelectorAll(".vote-button");

  buttons.forEach((button) => {
    button.textContent = activeUser ? "投票" : "登录后投票";
    button.disabled = false;
  });
}

function renderBooks() {
  bookList.innerHTML = "";

  books.forEach((book, index) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const voteButton = node.querySelector(".vote-button");
    const cover = node.querySelector(".book-cover");
    const bookIndex = node.querySelector(".book-index");

    node.dataset.bookId = book.id;
    bookIndex.textContent = String(index + 1).padStart(2, "0");
    cover.style.setProperty("--cover-color", book.coverColor || "#1f5f8b");
    cover.querySelector(".book-cover-title").textContent = book.title;
    cover.querySelector(".book-cover-author").textContent = book.author;
    node.querySelector(".book-title").textContent = book.title;
    node.querySelector(".book-author").textContent = book.author;
    node.querySelector(".book-description").textContent = book.description;
    node.querySelector(".book-votes").textContent = book.votes;

    voteButton.addEventListener("click", () => voteForBook(book.id, voteButton));
    voteButton.textContent = activeUser ? "投票" : "登录后投票";

    bookList.append(node);
  });

  updateSummary();
}

async function loadBooks() {
  try {
    setStatus("正在加载图书...", "info");
    const response = await fetch("/api/books");
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "图书加载失败");
    }

    books = result.data;
    renderBooks();
    setStatus("", "info");
  } catch (error) {
    bookCount.textContent = "加载失败";
    setStatus(error.message || "图书加载失败，请稍后重试。", "error");
  }
}

async function submitAuthForm(form, endpoint) {
  const submitButton = form.querySelector("button[type='submit']");
  const originalText = submitButton.textContent;
  const formData = new FormData(form);
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");

  try {
    submitButton.disabled = true;
    submitButton.textContent = "提交中";
    setStatus("", "info");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "操作失败");
    }

    if (endpoint.endsWith("/register")) {
      setStatus("注册成功，请登录。", "success");
      form.reset();
      loginForm.elements.username.value = username;
      loginForm.elements.password.focus();
      return;
    }

    authToken = result.data.token;
    activeUser = result.data.user;
    localStorage.setItem("bookVoteToken", authToken);
    form.reset();
    renderAuth();
    setStatus("登录成功。", "success");
  } catch (error) {
    setStatus(error.message || "操作失败，请稍后重试。", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
}

async function checkCurrentUser() {
  if (!authToken) {
    renderAuth();
    return;
  }

  try {
    const response = await fetch("/api/auth/me", {
      headers: getAuthHeaders()
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "登录已失效");
    }

    activeUser = result.data;
  } catch (error) {
    authToken = "";
    activeUser = null;
    localStorage.removeItem("bookVoteToken");
    setStatus("登录已失效，请重新登录。", "error");
  } finally {
    renderAuth();
  }
}

async function voteForBook(bookId, button) {
  if (!activeUser) {
    setStatus("请先登录后再投票。", "error");
    return;
  }

  const originalText = button.textContent;

  try {
    button.disabled = true;
    button.textContent = "提交中";
    setStatus("", "info");

    const response = await fetch(`/api/books/${bookId}/vote`, {
      method: "POST",
      headers: getAuthHeaders()
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "投票失败");
    }

    books = books.map((book) => {
      if (book.id !== result.data.id) {
        return book;
      }

      return {
        ...book,
        votes: result.data.votes
      };
    });

    renderBooks();
    setStatus("投票成功，票数已更新。", "success");
  } catch (error) {
    if (error.message.includes("登录")) {
      authToken = "";
      activeUser = null;
      localStorage.removeItem("bookVoteToken");
      renderAuth();
    }

    button.disabled = false;
    button.textContent = originalText;
    setStatus(error.message || "投票失败，请稍后重试。", "error");
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuthForm(loginForm, "/api/auth/login");
});

registerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuthForm(registerForm, "/api/auth/register");
});

logoutButton.addEventListener("click", async () => {
  const token = authToken;
  authToken = "";
  activeUser = null;
  localStorage.removeItem("bookVoteToken");
  renderAuth();
  setStatus("已退出登录。", "success");

  if (token) {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      }
    }).catch(() => {});
  }
});

async function init() {
  await checkCurrentUser();
  await loadBooks();
}

init();
