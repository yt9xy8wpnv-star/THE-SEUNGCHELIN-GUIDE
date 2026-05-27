import "./style.css";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const STORAGE_KEY = "seungchelin-ratings";

const defaultRatings = {
  breakfast: 0,
  lunch: 0,
  dinner: 0,
};

const state = {
  canRate: !isSupabaseConfigured,
  user: null,
  username: "",
  userRatings: { ...defaultRatings },
};

function loadLocalRatings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return { ...defaultRatings, ...saved };
  } catch {
    return { ...defaultRatings };
  }
}

function saveLocalRatings(ratings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ratings));
}

function setCardRating(card, activeValue) {
  const buttons = card.querySelectorAll(".stars button");

  buttons.forEach((button) => {
    const buttonValue = Number(button.dataset.value);
    button.classList.toggle("active", buttonValue <= activeValue);
    button.setAttribute("aria-checked", String(buttonValue === activeValue));
  });
}

function setRatingEnabled(enabled) {
  document.querySelectorAll(".stars button").forEach((button) => {
    button.disabled = !enabled;
  });
}

function renderRatings() {
  document.querySelectorAll(".meal-card").forEach((card) => {
    const meal = card.dataset.meal;
    setCardRating(card, state.userRatings[meal]);
  });

  setRatingEnabled(state.canRate);
}

function renderAuthStatus(message) {
  const status = document.querySelector("#auth-status");
  const form = document.querySelector("#auth-form");
  const signupLink = document.querySelector(".signup-link");
  const accountPanel = document.querySelector("#account-panel");
  const accountUsername = document.querySelector("#account-username");
  const accountPermission = document.querySelector("#account-permission");
  const signOutButton = document.querySelector("#sign-out-button");

  status.textContent = message;

  if (!isSupabaseConfigured) {
    form.hidden = true;
    signupLink.hidden = true;
    accountPanel.hidden = true;
    signOutButton.hidden = true;
    return;
  }

  const isLoggedIn = Boolean(state.user);

  form.hidden = isLoggedIn;
  signupLink.hidden = isLoggedIn;
  accountPanel.hidden = !isLoggedIn;
  signOutButton.hidden = !isLoggedIn;

  if (isLoggedIn) {
    accountUsername.textContent = state.username || "사용자";
    accountPermission.textContent = state.canRate
      ? "평가 권한 승인됨"
      : "평가 권한 승인 대기";
  }
}

async function loadUserRatingState() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  state.user = session?.user ?? null;
  state.canRate = false;
  state.username = "";
  state.userRatings = { ...defaultRatings };

  if (!state.user) {
    renderAuthStatus("로그인하면 평가 권한을 확인합니다.");
    return;
  }

  const [{ data: profile }, { data: ratings }] = await Promise.all([
    supabase
      .from("profiles")
      .select("can_rate, username")
      .eq("id", state.user.id)
      .maybeSingle(),
    supabase.from("ratings").select("meal_id, score").eq("user_id", state.user.id),
  ]);

  state.canRate = Boolean(profile?.can_rate);
  state.username = profile?.username || state.user.email || "사용자";

  ratings?.forEach((rating) => {
    if (rating.meal_id in state.userRatings) {
      state.userRatings[rating.meal_id] = rating.score;
    }
  });

  renderAuthStatus(
    state.canRate
      ? `${state.username} 평가 가능`
      : `${state.username} 평가 권한 없음`,
  );
}

async function saveSupabaseRating(meal, score) {
  const { error } = await supabase.from("ratings").upsert(
    {
      meal_id: meal,
      score,
      user_id: state.user.id,
    },
    { onConflict: "user_id,meal_id" },
  );

  if (error) {
    renderAuthStatus("평가 저장 권한이 없습니다.");
    return;
  }

  state.userRatings[meal] = score;
  renderRatings();
}

function initRatingControls() {
  document.querySelectorAll(".meal-card").forEach((card) => {
    const meal = card.dataset.meal;

    card.querySelectorAll(".stars button").forEach((button) => {
      button.setAttribute("role", "radio");
      button.addEventListener("click", async () => {
        if (!state.canRate) return;

        const selectedValue = Number(button.dataset.value);
        const currentValue = state.userRatings[meal];
        const value = currentValue === selectedValue ? 0 : selectedValue;

        if (!isSupabaseConfigured) {
          state.userRatings[meal] = value;
          saveLocalRatings(state.userRatings);
          renderRatings();
          return;
        }

        await saveSupabaseRating(meal, value);
      });
    });
  });
}

function initAuthControls() {
  const form = document.querySelector("#auth-form");
  const usernameInput = document.querySelector("#auth-username");
  const passwordInput = document.querySelector("#auth-password");
  const signOutButton = document.querySelector("#sign-out-button");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const username = usernameInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    if (!username || !password || !isSupabaseConfigured) return;

    renderAuthStatus("로그인 확인 중입니다.");

    const { data: lookup, error: lookupError } = await supabase.rpc(
      "get_email_for_username",
      {
        login_username: username,
      },
    );

    if (lookupError || !lookup) {
      renderAuthStatus("아이디 또는 비밀번호를 확인해주세요.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: lookup,
      password,
    });

    if (error) {
      renderAuthStatus("아이디 또는 비밀번호를 확인해주세요.");
      return;
    }

    passwordInput.value = "";
    await loadUserRatingState();
    renderRatings();
  });

  signOutButton.addEventListener("click", async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  });
}

function initPasswordToggles() {
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const input = document.querySelector(`#${button.dataset.passwordToggle}`);

    if (!input) return;

    button.addEventListener("click", () => {
      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      button.textContent = shouldShow ? "숨김" : "보기";
    });
  });
}

async function initRatings() {
  initPasswordToggles();
  initRatingControls();
  initAuthControls();

  if (!isSupabaseConfigured) {
    state.userRatings = loadLocalRatings();
    renderAuthStatus("로컬 데모 모드");
    renderRatings();
    return;
  }

  await loadUserRatingState();
  renderRatings();

  supabase.auth.onAuthStateChange(async () => {
    await loadUserRatingState();
    renderRatings();
  });
}

initRatings();
