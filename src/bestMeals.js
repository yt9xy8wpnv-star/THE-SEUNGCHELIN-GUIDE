import "./style.css";
import { initMenu } from "./menu.js";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const SLOT_LABELS = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
};

const bestStatus = document.querySelector("#best-status");
const bestGrid = document.querySelector("#best-grid");

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

function getMealTitle(meal) {
  const menu = Array.isArray(meal.menu) ? meal.menu.filter(Boolean) : [];
  return meal.title || menu.slice(0, 2).join(" · ") || "급식 정보";
}

function getMenuItems(meal) {
  const menu = Array.isArray(meal.menu) ? meal.menu : [];

  return [meal.title, ...menu]
    .flatMap((item) => String(item || "").split(" · "))
    .map((item) => item.trim())
    .filter(Boolean);
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

function renderBestCards(bestMeals, mealsById, ratingSummary) {
  bestGrid.innerHTML = bestMeals
    .map((bestMeal) => {
      const meal = mealsById[bestMeal.meal_id];
      if (!meal) return "";

      const summary = ratingSummary[bestMeal.meal_id] || {};
      const menuItems = getMenuItems(meal)
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("");
      const review = summary.review || "아직 한줄평이 없습니다";

      return `
        <article class="best-card">
          <img src="${escapeHtml(meal.image_path || "/assets/lunch.png")}" alt="${escapeHtml(getMealTitle(meal))}" />
          <div class="best-card-body">
            <span>${escapeHtml(formatDate(meal.meal_date))} · ${escapeHtml(SLOT_LABELS[meal.meal_slot] || "급식")}</span>
            <h2>${escapeHtml(getMealTitle(meal))}</h2>
            <ul>${menuItems}</ul>
            <div class="best-card-stars" aria-label="평균 별점 ${summary.score || 0}스타">
              ${renderStars(summary.score || 0)}
            </div>
            <p>"${escapeHtml(review)}"</p>
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadBestMeals() {
  if (!isSupabaseConfigured) {
    bestStatus.textContent = "Supabase 연결 후 사용할 수 있습니다.";
    renderEmpty("아직 BEST 급식이 없습니다.");
    return;
  }

  const { data: bestMeals, error } = await supabase
    .from("best_meals")
    .select("id, meal_id, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(10);

  if (error) {
    bestStatus.textContent = "BEST 급식 테이블을 확인해주세요.";
    renderEmpty("BEST 급식을 불러오지 못했습니다.");
    return;
  }

  if (!bestMeals?.length) {
    bestStatus.textContent = "아직 등록된 BEST 급식이 없습니다.";
    renderEmpty("아직 BEST 급식이 없습니다.");
    return;
  }

  const mealIds = bestMeals.map((meal) => meal.meal_id);
  const [{ data: meals }, { data: ratings }] = await Promise.all([
    supabase
      .from("meals")
      .select("id, meal_date, meal_slot, title, menu, image_path")
      .in("id", mealIds),
    supabase
      .from("ratings")
      .select("meal_id, score, one_line_review, updated_at, created_at")
      .in("meal_id", mealIds),
  ]);

  const mealsById = Object.fromEntries((meals ?? []).map((meal) => [meal.id, meal]));
  const ratingSummary = summarizeRatings(ratings ?? []);

  bestStatus.textContent = `최근 ${bestMeals.length}개`;
  renderBestCards(bestMeals, mealsById, ratingSummary);
}

initMenu({ onAuthChange: loadBestMeals });
loadBestMeals();
