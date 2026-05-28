import "./style.css";
import { initMenu } from "./menu.js";
import {
  isSupabaseConfigured,
  supabase,
  supabaseAnonKey,
  supabaseUrl,
} from "./supabaseClient.js";

const REQUEST_TIMEOUT_MS = 10000;

const SLOT_LABELS = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
};
const HIDDEN_RATING_SCORE = 3;

const bestStatus = document.querySelector("#best-status");
const bestGrid = document.querySelector("#best-grid");
let bestLoadSerial = 0;
const state = {
  canManageBest: false,
  lastBestMeals: [],
  lastMealsById: {},
  lastRatingSummary: {},
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T00:00:00`));
}

function clampScore(score) {
  return Math.max(0, Math.min(3, Math.round(Number(score) || 0)));
}

function renderStars(score) {
  const safeScore = clampScore(score);

  return Array.from({ length: 3 }, (_, index) => {
    const active = index < safeScore ? " active" : "";
    return `<img class="best-star${active}" src="/rate/MichelinStar.png" alt="" />`;
  }).join("");
}

function summarizeRatings(ratings) {
  const summary = {};

  ratings.forEach((rating) => {
    if (!summary[rating.meal_id]) {
      summary[rating.meal_id] = {
        total: 0,
        count: 0,
        review: "",
        reviewTime: "",
        isHidden: false,
      };
    }

    summary[rating.meal_id].total += Number(rating.score) || 0;
    summary[rating.meal_id].count += 1;
    summary[rating.meal_id].isHidden =
      summary[rating.meal_id].isHidden ||
      (Number(rating.score) === HIDDEN_RATING_SCORE && Boolean(rating.is_hidden_pick));

    const review = String(rating.one_line_review || "").trim();
    const reviewTime = rating.updated_at || rating.created_at || "";
    if (review && reviewTime >= summary[rating.meal_id].reviewTime) {
      summary[rating.meal_id].review = review;
      summary[rating.meal_id].reviewTime = reviewTime;
    }
  });

  Object.entries(summary).forEach(([mealId, value]) => {
    value.score = Math.round(value.total / value.count);
    summary[mealId] = value;
  });

  return summary;
}

function getMenuItems(meal) {
  const menu = Array.isArray(meal.menu) ? meal.menu : [];
  const rawMenuItems = (menu.length ? menu : [meal.title])
    .flatMap((item) => String(item || "").split(" · "))
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(rawMenuItems));
}

function renderEmpty(message) {
  state.lastBestMeals = [];
  state.lastMealsById = {};
  state.lastRatingSummary = {};

  bestGrid.innerHTML = `
    <div class="best-empty">
      <img src="/rate/MichelinStar.png" alt="" />
      <h2>${escapeHtml(message)}</h2>
      <p>메인 페이지에서 승인된 평가자가 급식을 BEST로 보내면 이곳에 표시됩니다.</p>
    </div>
  `;
}

function renderLatestBestCards() {
  if (!state.lastBestMeals.length) return;
  renderBestCards(state.lastBestMeals, state.lastMealsById, state.lastRatingSummary);
}

function getInFilter(values) {
  return `in.(${values
    .map((value) => `"${String(value).replaceAll('"', '\\"')}"`)
    .join(",")})`;
}

async function fetchPublicRows(table, params) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function isMissingHiddenColumnError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("is_hidden_pick") ||
    message.includes("score_snapshot") ||
    message.includes("schema cache")
  );
}

async function fetchBestMealRows() {
  try {
    return await fetchPublicRows("best_meals", {
      select: "id,meal_id,score_snapshot,is_hidden_pick,created_at",
      order: "created_at.desc,id.desc",
      limit: "10",
    });
  } catch (error) {
    if (!isMissingHiddenColumnError(error)) throw error;

    return fetchPublicRows("best_meals", {
      select: "id,meal_id,created_at",
      order: "created_at.desc,id.desc",
      limit: "10",
    });
  }
}

async function fetchRatingRows(mealFilter) {
  try {
    return await fetchPublicRows("ratings", {
      select: "meal_id,score,one_line_review,is_hidden_pick,updated_at,created_at",
      meal_id: mealFilter,
    });
  } catch (error) {
    if (!isMissingHiddenColumnError(error)) throw error;

    return fetchPublicRows("ratings", {
      select: "meal_id,score,one_line_review,updated_at,created_at",
      meal_id: mealFilter,
    });
  }
}

function renderBestCards(bestMeals, mealsById, ratingSummary) {
  bestGrid.innerHTML = bestMeals
    .map((bestMeal) => {
      const meal = mealsById[bestMeal.meal_id];
      if (!meal) return "";

      const summary = ratingSummary[bestMeal.meal_id] || {};
      const hasSnapshot = bestMeal.score_snapshot !== undefined && bestMeal.score_snapshot !== null;
      const bestHiddenPick =
        Number(bestMeal.score_snapshot) === HIDDEN_RATING_SCORE &&
        Boolean(bestMeal.is_hidden_pick);
      const displayHiddenPick = bestHiddenPick || (!hasSnapshot && summary.isHidden);
      const displayScore = displayHiddenPick
        ? HIDDEN_RATING_SCORE
        : clampScore(hasSnapshot ? bestMeal.score_snapshot : summary.score);
      const cardStateClass = displayHiddenPick
        ? " hidden-pick"
        : displayScore === HIDDEN_RATING_SCORE
          ? " top-pick"
          : "";
      const fallbackImage = `/assets/${meal.meal_slot || "lunch"}.png`;
      const menuItems = getMenuItems(meal)
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");
      const review = summary.review || "아직 미식가가 다녀가지 않음";
      const removeButton = state.canManageBest
        ? `
          <button
            class="best-delete-button"
            type="button"
            data-remove-best="${escapeHtml(bestMeal.meal_id)}"
            aria-label="BEST 식사에서 삭제"
          >
            삭제
          </button>
        `
        : "";

      return `
        <article class="best-card${cardStateClass}">
          ${removeButton}
          <img
            src="${escapeHtml(meal.image_path || fallbackImage)}"
            alt="${escapeHtml(SLOT_LABELS[meal.meal_slot] || "급식")} 이미지"
            data-fallback-src="${escapeHtml(fallbackImage)}"
          />
          <div class="best-card-body">
            <span>${escapeHtml(formatDate(meal.meal_date))} · ${escapeHtml(SLOT_LABELS[meal.meal_slot] || "급식")}</span>
            <ul>${menuItems}</ul>
            <div class="best-card-stars" aria-label="${displayHiddenPick ? "히든 " : ""}별점 ${displayScore}스타">
              ${renderStars(displayScore)}
            </div>
            <p class="best-review">"${escapeHtml(review)}"</p>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadBestPermission() {
  state.canManageBest = false;

  if (!isSupabaseConfigured) return false;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("can_rate")
    .eq("id", session.user.id)
    .maybeSingle();

  state.canManageBest = Boolean(profile?.can_rate);
  return state.canManageBest;
}

async function loadBestMeals() {
  const requestId = ++bestLoadSerial;

  if (!isSupabaseConfigured) {
    bestStatus.textContent = "Supabase 연결 후 사용할 수 있습니다.";
    renderEmpty("아직 BEST 식사가 없습니다.");
    return;
  }

  bestStatus.textContent = "BEST 식사를 불러오는 중입니다.";

  try {
    const bestMeals = await fetchBestMealRows();

    if (requestId !== bestLoadSerial) return;

    if (!bestMeals?.length) {
      bestStatus.textContent = "아직 등록된 BEST 식사가 없습니다.";
      renderEmpty("아직 BEST 식사가 없습니다.");
      return;
    }

    const mealIds = bestMeals.map((meal) => meal.meal_id);
    const mealFilter = getInFilter(mealIds);
    const [meals, ratings] = await Promise.all([
      fetchPublicRows("meals", {
        select: "id,meal_date,meal_slot,title,menu,image_path",
        id: mealFilter,
      }),
      fetchRatingRows(mealFilter),
    ]);

    if (requestId !== bestLoadSerial) return;

    const mealsById = Object.fromEntries((meals ?? []).map((meal) => [meal.id, meal]));
    const visibleBestMeals = bestMeals.filter((bestMeal) => mealsById[bestMeal.meal_id]);
    const ratingSummary = summarizeRatings(ratings ?? []);

    if (!visibleBestMeals.length) {
      bestStatus.textContent = "BEST 식사와 연결된 식단이 없습니다.";
      renderEmpty("BEST 식사를 표시할 수 없습니다.");
      return;
    }

    bestStatus.textContent = `최근 ${visibleBestMeals.length}개`;
    state.lastBestMeals = visibleBestMeals;
    state.lastMealsById = mealsById;
    state.lastRatingSummary = ratingSummary;
    renderLatestBestCards();
  } catch (error) {
    if (requestId !== bestLoadSerial) return;

    bestStatus.textContent = "BEST 식사를 불러오지 못했습니다.";
    renderEmpty("잠시 후 다시 확인해주세요.");
    console.error(error);
  }
}

async function removeBestMeal(mealId) {
  if (!state.canManageBest || !isSupabaseConfigured) return;

  bestStatus.textContent = "BEST 식사에서 삭제하는 중입니다.";

  const { error } = await supabase.rpc("remove_best_meal", {
    target_meal_id: mealId,
  });

  if (error) {
    bestStatus.textContent = "BEST 식사를 삭제하지 못했습니다.";
    return;
  }

  await loadBestMeals();
}

async function refreshBestPage() {
  const permissionPromise = loadBestPermission();
  await loadBestMeals();
  await permissionPromise;
  renderLatestBestCards();
}

bestGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-best]");
  if (!button) return;

  button.disabled = true;
  removeBestMeal(button.dataset.removeBest);
});

bestGrid.addEventListener(
  "error",
  (event) => {
    const image = event.target.closest(".best-card > img");
    if (!image || image.dataset.fallbackApplied === "true") return;

    image.dataset.fallbackApplied = "true";
    image.src = image.dataset.fallbackSrc;
  },
  true,
);

refreshBestPage();
initMenu({ onAuthChange: refreshBestPage, preloadAuth: false });
