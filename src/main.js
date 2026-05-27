import "./style.css";
import { initMenu } from "./menu.js";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const STORAGE_KEY = "seungchelin-ratings";
const REVIEW_STORAGE_KEY = "seungchelin-reviews";
const REVIEW_CHARACTER_LIMIT = 30;
const REVIEW_EMPTY_TEXT = "아직 미식가가 다녀가지 않음";
const REVIEW_PUBLIC_EMPTY_TEXT = "아직 미식가가 다녀가지 않음";
const KOREA_TIME_ZONE = "Asia/Seoul";
const MAX_PAST_DAYS = 3;
const MAX_FUTURE_DAYS = 7;
const SLOT_ORDER = ["breakfast", "lunch", "dinner"];
const SLOT_META = {
  breakfast: {
    englishLabel: "breakfast",
    koreanLabel: "아침",
    title: "아침 식사",
    fallbackImage: "/assets/breakfast.png",
  },
  lunch: {
    englishLabel: "lunch",
    koreanLabel: "점심",
    title: "점심 식사",
    fallbackImage: "/assets/lunch.png",
  },
  dinner: {
    englishLabel: "dinner",
    koreanLabel: "저녁",
    title: "저녁 식사",
    fallbackImage: "/assets/dinner.png",
  },
};

const mealGrid = document.querySelector("#meal-grid");
const mealTitle = document.querySelector("#meal-title");
const mealDateLabel = document.querySelector("#meal-date-label");
const selectedDateLabel = document.querySelector("#selected-date-label");
const prevDateButton = document.querySelector("#prev-date-button");
const nextDateButton = document.querySelector("#next-date-button");
const todayDate = getKoreaDate();
let mealLoadSerial = 0;
let authRefreshSerial = 0;

const state = {
  canRate: !isSupabaseConfigured,
  user: null,
  username: "",
  selectedDate: getInitialDate(),
  meals: [],
  userRatings: {},
  userReviews: {},
  publicRatings: {},
  publicReviews: {},
  isLoadingMeals: false,
};

function getKoreaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function parseDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDate(value) {
  if (!value) return todayDate;

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return todayDate;
}

function addDays(date, days) {
  const nextDate = parseDate(date);
  nextDate.setDate(nextDate.getDate() + days);
  return formatDate(nextDate);
}

function getDayDifference(date) {
  const diff = parseDate(date).getTime() - parseDate(todayDate).getTime();
  return Math.round(diff / 86400000);
}

function clampDate(date) {
  const diff = getDayDifference(date);

  if (diff < -MAX_PAST_DAYS) return addDays(todayDate, -MAX_PAST_DAYS);
  if (diff > MAX_FUTURE_DAYS) return addDays(todayDate, MAX_FUTURE_DAYS);
  return date;
}

function getInitialDate() {
  const params = new URLSearchParams(window.location.search);
  return clampDate(normalizeDate(params.get("date")));
}

function isWeekend(date) {
  const day = parseDate(date).getDay();
  return day === 0 || day === 6;
}

function getRelativeDateLabel(date) {
  const diff = getDayDifference(date);

  if (diff === 0) return "오늘";
  if (diff === -1) return "어제";
  if (diff === 1) return "내일";
  if (diff < 0) return `${Math.abs(diff)}일 전`;
  return `${diff}일 후`;
}

function getReadableDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(parseDate(date));
}

function syncDateToUrl() {
  const url = new URL(window.location.href);

  if (state.selectedDate === todayDate) {
    url.searchParams.delete("date");
  } else {
    url.searchParams.set("date", state.selectedDate);
  }

  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanReviewText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function getReviewLength(value) {
  return Array.from(cleanReviewText(value)).length;
}

function limitReviewText(value) {
  return Array.from(cleanReviewText(value)).slice(0, REVIEW_CHARACTER_LIMIT).join("");
}

function loadLocalMap(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function saveLocalMap(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getMealIds() {
  return state.meals.map((meal) => meal.id);
}

function resetMealFeedbackState() {
  state.userRatings = Object.fromEntries(getMealIds().map((id) => [id, 0]));
  state.userReviews = Object.fromEntries(getMealIds().map((id) => [id, ""]));
  state.publicRatings = Object.fromEntries(getMealIds().map((id) => [id, 0]));
  state.publicReviews = Object.fromEntries(getMealIds().map((id) => [id, ""]));
}

function sortMeals(meals) {
  return [...meals].sort((a, b) => {
    return SLOT_ORDER.indexOf(a.meal_slot) - SLOT_ORDER.indexOf(b.meal_slot);
  });
}

function keepDateBasedMeals(meals, date = state.selectedDate) {
  return meals.filter((meal) => meal.id.startsWith(`${date}-`));
}

function getDemoMeals(date) {
  return [
    {
      id: `${date}-breakfast`,
      meal_date: date,
      meal_slot: "breakfast",
      title: "계란죽 · 과일 샐러드",
      menu: ["김가루 주먹밥", "요구르트", "배추김치"],
      image_path: "/assets/breakfast.png",
    },
    {
      id: `${date}-lunch`,
      meal_date: date,
      meal_slot: "lunch",
      title: "제육덮밥 · 미역국",
      menu: ["콘치즈", "오이무침", "깍두기"],
      image_path: "/assets/lunch.png",
    },
    {
      id: `${date}-dinner`,
      meal_date: date,
      meal_slot: "dinner",
      title: "카레라이스 · 치킨너겟",
      menu: ["양배추 샐러드", "단무지", "사과주스"],
      image_path: "/assets/dinner.png",
    },
  ];
}

function updateReviewCount(form) {
  const input = form.querySelector("[data-review-input]");
  const count = form.querySelector("[data-review-count]");

  if (!input || !count) return;

  count.textContent = `${getReviewLength(input.value)}/${REVIEW_CHARACTER_LIMIT}자`;
}

function setReviewEditing(card, editing) {
  const display = card.querySelector("[data-review-display]");
  const form = card.querySelector("[data-review-form]");
  const input = form?.querySelector("[data-review-input]");

  if (!display || !form || !input) return;

  display.hidden = editing;
  form.hidden = !editing;

  if (editing) {
    input.value = state.userReviews[card.dataset.meal] || "";
    updateReviewCount(form);
    input.focus();
  }
}

function setCardRating(card, activeValue) {
  const buttons = card.querySelectorAll(".stars button");

  buttons.forEach((button) => {
    const buttonValue = Number(button.dataset.value);
    button.classList.toggle("active", buttonValue <= activeValue);
    button.setAttribute("aria-checked", String(buttonValue === activeValue));
  });
}

function getVisibleRating(meal) {
  if (state.canRate) return state.userRatings[meal] || 0;
  return state.publicRatings[meal] || 0;
}

function getVisibleReview(meal) {
  if (state.canRate) return state.userReviews[meal] || "";
  return state.publicReviews[meal] || "";
}

function setRatingEnabled(enabled) {
  document.querySelectorAll(".stars button").forEach((button) => {
    button.disabled = !enabled;
  });
}

function closeBestMenus() {
  document.querySelectorAll("[data-best-menu]").forEach((menu) => {
    menu.hidden = true;
  });

  document.querySelectorAll("[data-best-menu-button]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
}

function setBestActionsEnabled(enabled) {
  document.querySelectorAll("[data-best-actions]").forEach((actions) => {
    actions.hidden = !enabled;
  });

  if (!enabled) closeBestMenus();
}

function setReviewEnabled(enabled) {
  document.querySelectorAll(".meal-card").forEach((card) => {
    const display = card.querySelector("[data-review-display]");
    const form = card.querySelector("[data-review-form]");
    const input = form?.querySelector("[data-review-input]");
    const button = form?.querySelector('button[type="submit"]');
    const cancelButton = form?.querySelector("[data-review-cancel]");

    if (display) display.disabled = !enabled;

    if (input) {
      input.disabled = !enabled;
      input.placeholder = enabled
        ? "오늘의 한 끼를 짧게 기록해보세요"
        : "승인된 평가자만 한줄평을 남길 수 있어요";
    }

    if (button) button.disabled = !enabled;
    if (cancelButton) cancelButton.disabled = !enabled;
  });
}

function renderRatings() {
  document.querySelectorAll(".meal-card").forEach((card) => {
    const meal = card.dataset.meal;
    setCardRating(card, getVisibleRating(meal));
  });

  setRatingEnabled(state.canRate);
  setReviewEnabled(state.canRate);
  setBestActionsEnabled(state.canRate);
}

function renderReviews() {
  document.querySelectorAll(".meal-card").forEach((card) => {
    const meal = card.dataset.meal;
    const display = card.querySelector("[data-review-display]");
    const displayText = card.querySelector("[data-review-display-text]");
    const form = card.querySelector("[data-review-form]");
    const input = form?.querySelector("[data-review-input]");

    if (!display || !displayText || !form || !input) return;

    const review = getVisibleReview(meal);
    const fallbackText = state.canRate ? REVIEW_EMPTY_TEXT : REVIEW_PUBLIC_EMPTY_TEXT;

    displayText.textContent = review || fallbackText;
    display.dataset.empty = String(!review);
    input.value = review;
    updateReviewCount(form);
    setReviewEditing(card, false);
  });

  setReviewEnabled(state.canRate);
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

function renderDateControls() {
  const relativeLabel = getRelativeDateLabel(state.selectedDate);
  const readableDate = getReadableDate(state.selectedDate);
  const diff = getDayDifference(state.selectedDate);

  mealTitle.textContent = `${relativeLabel} · ${readableDate}`;
  mealDateLabel.hidden = true;
  mealDateLabel.textContent = "";
  selectedDateLabel.textContent = state.selectedDate;
  selectedDateLabel.dateTime = state.selectedDate;
  prevDateButton.disabled = diff <= -MAX_PAST_DAYS;
  nextDateButton.disabled = diff >= MAX_FUTURE_DAYS;
}

function getNoMealMessage() {
  if (state.selectedDate === todayDate && isWeekend(state.selectedDate)) {
    return "오늘은 급식이 없습니다.";
  }

  if (isWeekend(state.selectedDate)) {
    return "이 날은 급식이 없습니다.";
  }

  return "등록된 급식이 없습니다.";
}

function mealCardTemplate(meal) {
  const slot = SLOT_META[meal.meal_slot] ?? SLOT_META.lunch;
  const menu = Array.isArray(meal.menu) ? meal.menu.filter(Boolean) : [];
  const rawMenuItems = (menu.length ? menu : [meal.title])
    .flatMap((item) => String(item || "").split(" · "))
    .map((item) => item.trim())
    .filter(Boolean);
  const menuItems = Array.from(new Set(rawMenuItems));
  const title = slot.title;
  const imagePath = meal.image_path || slot.fallbackImage;
  const featured = meal.meal_slot === "lunch" ? " featured" : "";
  const menuMarkup = menuItems
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  return `
    <article class="meal-card${featured}" data-meal="${escapeHtml(meal.id)}">
      <img src="${escapeHtml(imagePath)}" alt="${escapeHtml(slot.koreanLabel)} 급식 트레이" />
      <div class="meal-content">
        <p class="meal-time">${escapeHtml(slot.englishLabel)}</p>
        <h3>${escapeHtml(title)}</h3>
        <ul class="meal-menu-list">${menuMarkup}</ul>
        <div class="rating-row">
          <div class="stars" role="radiogroup" aria-label="${escapeHtml(slot.koreanLabel)} 별점" data-rating-control>
            <button type="button" aria-label="${escapeHtml(slot.koreanLabel)} 1스타" data-value="1"><img src="/rate/MichelinStar.png" alt="" /></button>
            <button type="button" aria-label="${escapeHtml(slot.koreanLabel)} 2스타" data-value="2"><img src="/rate/MichelinStar.png" alt="" /></button>
            <button type="button" aria-label="${escapeHtml(slot.koreanLabel)} 3스타" data-value="3"><img src="/rate/MichelinStar.png" alt="" /></button>
          </div>
        </div>
        <button class="review-display" type="button" data-review-display>
          <span data-review-display-text>${REVIEW_EMPTY_TEXT}</span>
        </button>
        <form class="review-form" data-review-form hidden>
          <label>
            <span>한줄평</span>
            <textarea
              data-review-input
              rows="2"
              maxlength="${REVIEW_CHARACTER_LIMIT}"
              placeholder="오늘의 한 끼를 짧게 기록해보세요"
              aria-label="${escapeHtml(slot.koreanLabel)} 한줄평"
            ></textarea>
          </label>
          <div class="review-actions">
            <small data-review-count>0/${REVIEW_CHARACTER_LIMIT}자</small>
            <button type="button" data-review-cancel>취소</button>
            <button type="submit">저장</button>
          </div>
        </form>
        <div class="meal-card-actions" data-best-actions hidden>
          <button
            class="meal-more-button"
            type="button"
            aria-label="${escapeHtml(slot.koreanLabel)} 급식 추가 메뉴"
            aria-expanded="false"
            data-best-menu-button
          >
            ...
          </button>
          <div class="meal-action-menu" data-best-menu hidden>
            <button type="button" data-send-best>BEST 급식으로 보내기</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderMealLoading() {
  mealGrid.innerHTML = `<div class="meal-loading">급식 정보를 불러오는 중입니다.</div>`;
}

function renderNoMeals() {
  mealGrid.innerHTML = `
    <div class="empty-meal-card">
      <img src="/rate/MichelinStar.png" alt="" />
      <h3>${escapeHtml(getNoMealMessage())}</h3>
      <p>왼쪽과 오른쪽 화살표로 다른 날짜의 급식을 확인해보세요.</p>
    </div>
  `;
}

function renderMeals() {
  if (state.isLoadingMeals) {
    renderMealLoading();
    return;
  }

  if (state.meals.length === 0) {
    renderNoMeals();
    return;
  }

  mealGrid.innerHTML = state.meals.map(mealCardTemplate).join("");
  renderRatings();
  renderReviews();
}

async function loadMealsForSelectedDate({ updateUrl = true } = {}) {
  const requestId = ++mealLoadSerial;
  const targetDate = state.selectedDate;

  state.isLoadingMeals = true;
  renderDateControls();
  renderMeals();

  try {
    if (!isSupabaseConfigured) {
      state.meals = getDemoMeals(targetDate);
      state.canRate = true;
      resetMealFeedbackState();
      state.userRatings = { ...state.userRatings, ...loadLocalMap(STORAGE_KEY) };
      state.userReviews = { ...state.userReviews, ...loadLocalMap(REVIEW_STORAGE_KEY) };
      renderAuthStatus("로컬 데모 모드");
      return;
    }

    const { data, error } = await supabase
      .from("meals")
      .select("id, meal_date, meal_slot, title, menu, image_path")
      .eq("meal_date", targetDate);

    if (requestId !== mealLoadSerial || targetDate !== state.selectedDate) return;

    if (error) {
      state.meals = [];
      renderAuthStatus("급식 정보를 불러오지 못했습니다.");
    } else {
      state.meals = sortMeals(keepDateBasedMeals(data ?? [], targetDate));
    }

    resetMealFeedbackState();
    await loadUserRatingState();
  } catch {
    if (requestId !== mealLoadSerial || targetDate !== state.selectedDate) return;

    state.meals = [];
    renderAuthStatus("급식 정보를 불러오지 못했습니다.");
  } finally {
    if (requestId !== mealLoadSerial || targetDate !== state.selectedDate) return;

    state.isLoadingMeals = false;
    renderDateControls();
    renderMeals();
    if (updateUrl) syncDateToUrl();
  }
}

async function loadUserRatingState() {
  if (!isSupabaseConfigured) return;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  state.user = session?.user ?? null;
  state.canRate = false;
  state.username = "";
  resetMealFeedbackState();

  const mealIds = getMealIds();
  const publicRatingsRequest = mealIds.length
    ? supabase
        .from("ratings")
        .select("meal_id, score, one_line_review, updated_at, created_at")
        .in("meal_id", mealIds)
    : Promise.resolve({ data: [] });

  const { data: publicRatings } = await publicRatingsRequest;
  applyPublicFeedback(publicRatings ?? []);

  if (!state.user) {
    renderAuthStatus("로그인하면 평가를 남길 수 있습니다.");
    return;
  }

  const profileRequest = supabase
    .from("profiles")
    .select("can_rate, username")
    .eq("id", state.user.id)
    .maybeSingle();
  const userRatingsRequest = mealIds.length
    ? supabase
        .from("ratings")
        .select("meal_id, score, one_line_review")
        .eq("user_id", state.user.id)
        .in("meal_id", mealIds)
    : Promise.resolve({ data: [] });

  const [{ data: profile }, { data: userRatings }] = await Promise.all([
    profileRequest,
    userRatingsRequest,
  ]);

  state.canRate = Boolean(profile?.can_rate);
  state.username = profile?.username || state.user.email || "사용자";

  userRatings?.forEach((rating) => {
    if (rating.meal_id in state.userRatings) {
      state.userRatings[rating.meal_id] = rating.score;
      state.userReviews[rating.meal_id] = rating.one_line_review || "";
    }
  });

  renderAuthStatus(
    state.canRate
      ? `${state.username} 평가 가능`
      : `${state.username} 평가 권한 없음`,
  );
}

function applyPublicFeedback(ratings) {
  const summary = {};

  ratings.forEach((rating) => {
    if (!(rating.meal_id in state.publicRatings)) return;

    if (!summary[rating.meal_id]) {
      summary[rating.meal_id] = {
        total: 0,
        count: 0,
        review: "",
        reviewTime: "",
      };
    }

    summary[rating.meal_id].total += Number(rating.score) || 0;
    summary[rating.meal_id].count += 1;

    const review = String(rating.one_line_review || "").trim();
    const reviewTime = rating.updated_at || rating.created_at || "";
    if (review && reviewTime >= summary[rating.meal_id].reviewTime) {
      summary[rating.meal_id].review = review;
      summary[rating.meal_id].reviewTime = reviewTime;
    }
  });

  Object.entries(summary).forEach(([meal, value]) => {
    state.publicRatings[meal] = Math.round(value.total / value.count);
    state.publicReviews[meal] = value.review;
  });
}

async function saveSupabaseRating(meal, score) {
  if (!state.user) return;

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

async function saveSupabaseReview(meal, review) {
  if (!state.user) return;

  const { error } = await supabase.from("ratings").upsert(
    {
      meal_id: meal,
      score: state.userRatings[meal] || 0,
      user_id: state.user.id,
      one_line_review: review,
    },
    { onConflict: "user_id,meal_id" },
  );

  if (error) {
    renderAuthStatus("한줄평 저장 권한이 없습니다.");
    return;
  }

  state.userReviews[meal] = review;
  renderReviews();
  renderAuthStatus("한줄평이 저장되었습니다.");
}

async function sendMealToBest(meal) {
  if (!state.canRate) return;

  if (!isSupabaseConfigured) {
    renderAuthStatus("Supabase 연결 후 BEST 급식에 보낼 수 있습니다.");
    return;
  }

  const { error } = await supabase.rpc("add_best_meal", {
    target_meal_id: meal,
  });

  if (error) {
    renderAuthStatus("BEST 급식 저장 권한이 없습니다.");
    return;
  }

  closeBestMenus();
  renderAuthStatus("BEST 급식으로 보냈습니다.");
}

async function changeSelectedDate(days) {
  const nextDate = clampDate(addDays(state.selectedDate, days));
  if (nextDate === state.selectedDate) return;

  state.selectedDate = nextDate;
  await loadMealsForSelectedDate();
}

function scheduleAuthRefresh() {
  const requestId = ++authRefreshSerial;

  window.setTimeout(async () => {
    if (requestId !== authRefreshSerial || state.isLoadingMeals) return;

    await loadUserRatingState();

    if (requestId !== authRefreshSerial || state.isLoadingMeals) return;

    renderMeals();
  }, 0);
}

function initDateControls() {
  prevDateButton.addEventListener("click", () => {
    changeSelectedDate(-1);
  });

  nextDateButton.addEventListener("click", () => {
    changeSelectedDate(1);
  });
}

function initMealInteractions() {
  mealGrid.addEventListener("click", async (event) => {
    const card = event.target.closest(".meal-card");
    if (!card) return;

    const meal = card.dataset.meal;
    const starButton = event.target.closest(".stars button");
    const display = event.target.closest("[data-review-display]");
    const cancelButton = event.target.closest("[data-review-cancel]");
    const bestMenuButton = event.target.closest("[data-best-menu-button]");
    const sendBestButton = event.target.closest("[data-send-best]");

    if (starButton) {
      if (!state.canRate) return;

      const selectedValue = Number(starButton.dataset.value);
      const currentValue = state.userRatings[meal] || 0;
      const value = currentValue === selectedValue ? 0 : selectedValue;

      if (!isSupabaseConfigured) {
        state.userRatings[meal] = value;
        saveLocalMap(STORAGE_KEY, state.userRatings);
        renderRatings();
        return;
      }

      await saveSupabaseRating(meal, value);
      return;
    }

    if (bestMenuButton) {
      if (!state.canRate) return;
      const menu = card.querySelector("[data-best-menu]");
      const willOpen = menu?.hidden;
      closeBestMenus();
      if (menu) {
        menu.hidden = !willOpen;
        bestMenuButton.setAttribute("aria-expanded", String(willOpen));
      }
      return;
    }

    if (sendBestButton) {
      await sendMealToBest(meal);
      return;
    }

    if (display) {
      if (!state.canRate) return;
      setReviewEditing(card, true);
      return;
    }

    if (cancelButton) {
      setReviewEditing(card, false);
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".meal-card-actions")) closeBestMenus();
  });

  mealGrid.addEventListener("input", (event) => {
    if (!event.target.matches("[data-review-input]")) return;

    const form = event.target.closest("[data-review-form]");
    const limitedValue = limitReviewText(event.target.value);

    if (getReviewLength(event.target.value) > REVIEW_CHARACTER_LIMIT) {
      event.target.value = limitedValue;
    }

    updateReviewCount(form);
  });

  mealGrid.addEventListener("submit", async (event) => {
    if (!event.target.matches("[data-review-form]")) return;

    event.preventDefault();
    if (!state.canRate) return;

    const form = event.target;
    const card = form.closest(".meal-card");
    const input = form.querySelector("[data-review-input]");
    const meal = card.dataset.meal;
    const review = limitReviewText(input.value);

    input.value = review;
    updateReviewCount(form);

    if (!isSupabaseConfigured) {
      state.userReviews[meal] = review;
      saveLocalMap(REVIEW_STORAGE_KEY, state.userReviews);
      renderReviews();
      return;
    }

    await saveSupabaseReview(meal, review);
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
    renderMeals();
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
  initMenu({ auth: false });
  initPasswordToggles();
  initDateControls();
  initMealInteractions();
  initAuthControls();

  await loadMealsForSelectedDate({ updateUrl: false });

  if (isSupabaseConfigured) {
    supabase.auth.onAuthStateChange(() => {
      scheduleAuthRefresh();
    });
  }
}

initRatings();
