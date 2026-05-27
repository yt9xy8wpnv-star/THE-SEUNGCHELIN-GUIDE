import "./style.css";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const STORAGE_KEY = "seungchelin-ratings";
const mealOrder = ["breakfast", "lunch", "dinner"];

const defaultRatings = {
  breakfast: 0,
  lunch: 0,
  dinner: 0,
};

const mealNames = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
};

const state = {
  averages: { ...defaultRatings },
  canRate: !isSupabaseConfigured,
  user: null,
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

function formatScore(value) {
  return Number(value || 0).toFixed(1);
}

function setCardRating(card, activeValue, displayValue = activeValue) {
  const buttons = card.querySelectorAll(".stars button");
  const label = card.querySelector(".score-label");

  buttons.forEach((button) => {
    const buttonValue = Number(button.dataset.value);
    button.classList.toggle("active", buttonValue <= activeValue);
    button.setAttribute("aria-checked", String(buttonValue === activeValue));
  });

  label.textContent = formatScore(displayValue);
}

function updateSummary(ratings) {
  const values = Object.values(ratings).filter((score) => score > 0);
  const average =
    values.length === 0
      ? 0
      : values.reduce((sum, score) => sum + score, 0) / values.length;

  document.querySelector("#average-score").textContent = formatScore(average);

  const rankedMeals = [...mealOrder].sort((a, b) => {
    if (ratings[b] === ratings[a]) {
      return mealOrder.indexOf(a) - mealOrder.indexOf(b);
    }
    return ratings[b] - ratings[a];
  });

  const listItems = document.querySelectorAll(".rank-list li");
  rankedMeals.forEach((meal, index) => {
    const item = listItems[index];
    item.querySelector("span").textContent = mealNames[meal];
    item.querySelector("strong").textContent = formatScore(ratings[meal]);
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
    setCardRating(card, state.userRatings[meal], state.averages[meal]);
  });

  updateSummary(state.averages);
  setRatingEnabled(state.canRate);
}

function renderAuthStatus(message) {
  const status = document.querySelector("#auth-status");
  const form = document.querySelector("#auth-form");
  const signOutButton = document.querySelector("#sign-out-button");

  status.textContent = message;

  if (!isSupabaseConfigured) {
    form.hidden = true;
    signOutButton.hidden = true;
    return;
  }

  form.hidden = Boolean(state.user);
  signOutButton.hidden = !state.user;
}

async function loadSupabaseRatings() {
  const { data, error } = await supabase.from("ratings").select("meal_id, score");

  if (error) {
    renderAuthStatus("평가 데이터를 불러오지 못했습니다.");
    return;
  }

  const grouped = mealOrder.reduce((result, meal) => {
    result[meal] = [];
    return result;
  }, {});

  data.forEach((rating) => {
    if (grouped[rating.meal_id]) {
      grouped[rating.meal_id].push(rating.score);
    }
  });

  mealOrder.forEach((meal) => {
    const scores = grouped[meal];
    state.averages[meal] =
      scores.length === 0
        ? 0
        : scores.reduce((sum, score) => sum + score, 0) / scores.length;
  });
}

async function loadUserRatingState() {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  state.user = session?.user ?? null;
  state.canRate = false;
  state.userRatings = { ...defaultRatings };

  if (!state.user) {
    renderAuthStatus("로그인하면 평가 권한을 확인합니다.");
    return;
  }

  const [{ data: profile }, { data: ratings }] = await Promise.all([
    supabase.from("profiles").select("can_rate").eq("id", state.user.id).maybeSingle(),
    supabase.from("ratings").select("meal_id, score").eq("user_id", state.user.id),
  ]);

  state.canRate = Boolean(profile?.can_rate);

  ratings?.forEach((rating) => {
    if (rating.meal_id in state.userRatings) {
      state.userRatings[rating.meal_id] = rating.score;
    }
  });

  renderAuthStatus(
    state.canRate
      ? `${state.user.email} 평가 가능`
      : `${state.user.email} 평가 권한 없음`,
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
  await loadSupabaseRatings();
  renderRatings();
}

function initRatingControls() {
  document.querySelectorAll(".meal-card").forEach((card) => {
    const meal = card.dataset.meal;

    card.querySelectorAll(".stars button").forEach((button) => {
      button.setAttribute("role", "radio");
      button.addEventListener("click", async () => {
        if (!state.canRate) return;

        const value = Number(button.dataset.value);

        if (!isSupabaseConfigured) {
          state.userRatings[meal] = value;
          state.averages = { ...state.userRatings };
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
  const emailInput = document.querySelector("#auth-email");
  const signOutButton = document.querySelector("#sign-out-button");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput.value.trim();
    if (!email || !isSupabaseConfigured) return;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin,
      },
    });

    renderAuthStatus(
      error ? "로그인 링크 전송에 실패했습니다." : "이메일로 로그인 링크를 보냈습니다.",
    );
  });

  signOutButton.addEventListener("click", async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  });
}

async function initRatings() {
  initRatingControls();
  initAuthControls();

  if (!isSupabaseConfigured) {
    state.userRatings = loadLocalRatings();
    state.averages = { ...state.userRatings };
    renderAuthStatus("로컬 데모 모드");
    renderRatings();
    return;
  }

  await loadSupabaseRatings();
  await loadUserRatingState();
  renderRatings();

  supabase.auth.onAuthStateChange(async () => {
    await loadUserRatingState();
    renderRatings();
  });
}

initRatings();
