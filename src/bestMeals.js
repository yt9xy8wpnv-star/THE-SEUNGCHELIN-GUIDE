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

const bestStatus = document.querySelector("#best-status");
const bestGrid = document.querySelector("#best-grid");
let bestLoadSerial = 0;
const state = {
  canManageBest: false,
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

function renderStars(score) {
  const safeScore = Math.max(0, Math.min(3, Math.round(Number(score) || 0)));

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
  bestGrid.innerHTML = `
    <div class="best-empty">
      <img src="/rate/MichelinStar.png" alt="" />
      <h2>${escapeHtml(message)}</h2>
      <p>메인 페이지에서 승인된 평가자가 급식을 BEST로 보내면 이곳에 표시됩니다.</p>
    </div>
  `;
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

function renderBestCards(bestMeals, mealsById, ratingSummary) {
  bestGrid.innerHTML = bestMeals
    .map((bestMeal) => {
      const meal = mealsById[bestMeal.meal_id];
      if (!meal) return "";

      const summary = ratingSummary[bestMeal.meal_id] || {};
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
            aria-label="BEST 급식에서 삭제"
          >
            삭제
          </button>
        `
        : "";

      return `
        <article class="best-card">
          ${removeButton}
          <img src="${escapeHtml(meal.image_path || "/assets/lunch.png")}" alt="${escapeHtml(SLOT_LABELS[meal.meal_slot] || "급식")} 이미지" />
          <div class="best-card-body">
            <span>${escapeHtml(formatDate(meal.meal_date))} · ${escapeHtml(SLOT_LABELS[meal.meal_slot] || "급식")}</span>
            <ul>${menuItems}</ul>
            <div class="best-card-stars" aria-label="평균 별점 ${summary.score || 0}스타">
              ${renderStars(summary.score || 0)}
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

  if (!isSupabaseConfigured) return;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) return;

  const { data: profile } = await supabase
    .from("profiles")
    .select("can_rate")
    .eq("id", session.user.id)
    .maybeSingle();

  state.canManageBest = Boolean(profile?.can_rate);
}

async function loadBestMeals() {
  const requestId = ++bestLoadSerial;

  if (!isSupabaseConfigured) {
    bestStatus.textContent = "Supabase 연결 후 사용할 수 있습니다.";
    renderEmpty("아직 BEST 급식이 없습니다.");
    return;
  }

  bestStatus.textContent = "BEST 급식을 불러오는 중입니다.";

  try {
    const bestMeals = await fetchPublicRows("best_meals", {
      select: "id,meal_id,created_at",
      order: "created_at.desc,id.desc",
      limit: "10",
    });

    if (requestId !== bestLoadSerial) return;

    if (!bestMeals?.length) {
      bestStatus.textContent = "아직 등록된 BEST 급식이 없습니다.";
      renderEmpty("아직 BEST 급식이 없습니다.");
      return;
    }

    const mealIds = bestMeals.map((meal) => meal.meal_id);
    const mealFilter = getInFilter(mealIds);
    const [meals, ratings] = await Promise.all([
      fetchPublicRows("meals", {
        select: "id,meal_date,meal_slot,title,menu,image_path",
        id: mealFilter,
      }),
      fetchPublicRows("ratings", {
        select: "meal_id,score,one_line_review,updated_at,created_at",
        meal_id: mealFilter,
      }),
    ]);

    if (requestId !== bestLoadSerial) return;

    const mealsById = Object.fromEntries((meals ?? []).map((meal) => [meal.id, meal]));
    const visibleBestMeals = bestMeals.filter((bestMeal) => mealsById[bestMeal.meal_id]);
    const ratingSummary = summarizeRatings(ratings ?? []);

    if (!visibleBestMeals.length) {
      bestStatus.textContent = "BEST 급식과 연결된 식단이 없습니다.";
      renderEmpty("BEST 급식을 표시할 수 없습니다.");
      return;
    }

    bestStatus.textContent = `최근 ${visibleBestMeals.length}개`;
    renderBestCards(visibleBestMeals, mealsById, ratingSummary);
  } catch (error) {
    if (requestId !== bestLoadSerial) return;

    bestStatus.textContent = "BEST 급식을 불러오지 못했습니다.";
    renderEmpty("잠시 후 다시 확인해주세요.");
    console.error(error);
  }
}

async function removeBestMeal(mealId) {
  if (!state.canManageBest || !isSupabaseConfigured) return;

  bestStatus.textContent = "BEST 급식에서 삭제하는 중입니다.";

  const { error } = await supabase.rpc("remove_best_meal", {
    target_meal_id: mealId,
  });

  if (error) {
    bestStatus.textContent = "BEST 급식을 삭제하지 못했습니다.";
    return;
  }

  await loadBestMeals();
}

async function refreshBestPage() {
  await loadBestPermission();
  await loadBestMeals();
}

bestGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-best]");
  if (!button) return;

  button.disabled = true;
  removeBestMeal(button.dataset.removeBest);
});

refreshBestPage();
initMenu({ onAuthChange: refreshBestPage });
