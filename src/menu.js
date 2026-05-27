import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const REQUEST_TIMEOUT_MS = 10000;
let menuAuthRequestSerial = 0;

function getAuthPanelMarkup() {
  return `
    <div class="auth-panel" aria-label="평가 권한">
      <p id="auth-status">로그인 상태를 확인하는 중입니다.</p>
      <form id="auth-form">
        <input
          id="auth-username"
          type="text"
          autocomplete="username"
          placeholder="아이디"
          aria-label="로그인 아이디"
        />
        <div class="password-field">
          <button type="button" data-password-toggle="auth-password">보기</button>
          <input
            id="auth-password"
            type="password"
            autocomplete="current-password"
            placeholder="비밀번호"
            aria-label="로그인 비밀번호"
          />
        </div>
        <button type="submit">로그인</button>
      </form>
      <a class="signup-link" href="/signup/">회원가입</a>
      <div class="account-panel" id="account-panel" hidden>
        <span>계정</span>
        <strong id="account-username">사용자</strong>
        <p id="account-permission">평가 권한 확인 중</p>
      </div>
      <button id="sign-out-button" type="button" hidden>로그아웃</button>
    </div>
  `;
}

function ensureAuthPanel(menuPanel) {
  if (menuPanel.querySelector(".auth-panel")) return;
  menuPanel.insertAdjacentHTML("beforeend", getAuthPanelMarkup());
}

function renderMenuAuthStatus(menuPanel, { user = null, profile = null, message = "" } = {}) {
  const status = menuPanel.querySelector("#auth-status");
  const form = menuPanel.querySelector("#auth-form");
  const signupLink = menuPanel.querySelector(".signup-link");
  const accountPanel = menuPanel.querySelector("#account-panel");
  const accountUsername = menuPanel.querySelector("#account-username");
  const accountPermission = menuPanel.querySelector("#account-permission");
  const signOutButton = menuPanel.querySelector("#sign-out-button");

  if (!status || !form || !signupLink || !accountPanel || !signOutButton) return;

  if (!isSupabaseConfigured) {
    status.textContent = "로컬 데모 모드";
    form.hidden = true;
    signupLink.hidden = true;
    accountPanel.hidden = true;
    signOutButton.hidden = true;
    return;
  }

  const isLoggedIn = Boolean(user);
  status.textContent = message || (isLoggedIn ? "로그인됨" : "로그인이 필요합니다.");
  form.hidden = isLoggedIn;
  signupLink.hidden = isLoggedIn;
  accountPanel.hidden = !isLoggedIn;
  signOutButton.hidden = !isLoggedIn;

  if (isLoggedIn) {
    accountUsername.textContent = profile?.username || user.email || "사용자";
    accountPermission.textContent = profile
      ? profile.can_rate
        ? "평가 권한 승인됨"
        : "평가 권한 승인 대기"
      : "평가 권한 확인 중";
  }
}

async function withTimeout(promise, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function loadMenuAuth(menuPanel, message = "", knownSession = undefined) {
  const requestId = ++menuAuthRequestSerial;
  let session = null;

  try {
    if (!isSupabaseConfigured) {
      renderMenuAuthStatus(menuPanel);
      return;
    }

    session =
      knownSession ??
      (
        await withTimeout(
          supabase.auth.getSession(),
          "로그인 상태 확인 시간이 초과되었습니다.",
        )
      ).data.session;

    if (requestId !== menuAuthRequestSerial) return;

    if (!session?.user) {
      renderMenuAuthStatus(menuPanel, { message: message || "로그인이 필요합니다." });
      return;
    }

    const { data: profile, error } = await withTimeout(
      supabase
        .from("profiles")
        .select("username, can_rate")
        .eq("id", session.user.id)
        .maybeSingle(),
      "계정 정보를 불러오는 시간이 초과되었습니다.",
    );

    if (error) throw new Error(error.message);
    if (requestId !== menuAuthRequestSerial) return;

    renderMenuAuthStatus(menuPanel, {
      user: session.user,
      profile,
      message: message || "로그인됨",
    });
  } catch {
    if (requestId !== menuAuthRequestSerial) return;

    if (session?.user) {
      renderMenuAuthStatus(menuPanel, {
        user: session.user,
        message: message || "로그인됨",
      });
      return;
    }

    renderMenuAuthStatus(menuPanel, {
      message: "로그인 상태를 확인하지 못했습니다.",
    });
  }
}

function initPasswordToggles(menuPanel) {
  menuPanel.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const input = menuPanel.querySelector(`#${button.dataset.passwordToggle}`);

    if (!input) return;

    button.addEventListener("click", () => {
      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      button.textContent = shouldShow ? "숨김" : "보기";
    });
  });
}

function initMenuAuth(menuPanel, onAuthChange, { preloadAuth = true } = {}) {
  ensureAuthPanel(menuPanel);
  initPasswordToggles(menuPanel);

  const form = menuPanel.querySelector("#auth-form");
  const usernameInput = menuPanel.querySelector("#auth-username");
  const passwordInput = menuPanel.querySelector("#auth-password");
  const signOutButton = menuPanel.querySelector("#sign-out-button");

  if (preloadAuth) {
    loadMenuAuth(menuPanel);
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = usernameInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!username || !password || !isSupabaseConfigured) return;

    renderMenuAuthStatus(menuPanel, { message: "로그인 확인 중입니다." });

    const { data: lookup, error: lookupError } = await supabase.rpc(
      "get_email_for_username",
      {
        login_username: username,
      },
    );

    if (lookupError || !lookup) {
      renderMenuAuthStatus(menuPanel, {
        message: "아이디 또는 비밀번호를 확인해주세요.",
      });
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: lookup,
      password,
    });

    if (error) {
      renderMenuAuthStatus(menuPanel, {
        message: "아이디 또는 비밀번호를 확인해주세요.",
      });
      return;
    }

    passwordInput.value = "";
    await loadMenuAuth(menuPanel);
    onAuthChange?.();
  });

  signOutButton?.addEventListener("click", async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
    await loadMenuAuth(menuPanel);
    onAuthChange?.();
  });

  if (isSupabaseConfigured) {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" && (!session || !preloadAuth)) return;

      window.setTimeout(async () => {
        await loadMenuAuth(menuPanel, "", session);
        if (event !== "INITIAL_SESSION") {
          onAuthChange?.();
        }
      }, 0);
    });
  }
}

export function initMenu(options = {}) {
  const { auth = true, onAuthChange, preloadAuth = true } = options;
  const menuButton = document.querySelector("#menu-button");
  const menuPanel = document.querySelector("#menu-panel");

  if (!menuButton || !menuPanel) return;

  const closeMenu = () => {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  };

  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menuPanel.hidden;
    menuPanel.hidden = !willOpen;
    menuButton.setAttribute("aria-expanded", String(willOpen));

    if (willOpen && auth) {
      loadMenuAuth(menuPanel);
    }
  });

  menuPanel.addEventListener("click", (event) => {
    event.stopPropagation();
    if (event.target.closest("a")) closeMenu();
  });

  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  if (auth) {
    initMenuAuth(menuPanel, onAuthChange, { preloadAuth });
  }
}
