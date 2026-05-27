import "./style.css";
import { initMenu } from "./menu.js";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const mealNames = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
};

const status = document.querySelector("#mypage-status");
const username = document.querySelector("#mypage-username");
const permission = document.querySelector("#mypage-permission");
const ratingList = document.querySelector("#mypage-ratings");
const REQUEST_TIMEOUT_MS = 10000;

function setStatus(message) {
  status.textContent = message;
}

function renderEmpty(message) {
  ratingList.innerHTML = `<li>${message}</li>`;
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

async function loadMyPage() {
  try {
    if (!isSupabaseConfigured) {
      setStatus("Supabase 연결 후 내 정보를 확인할 수 있습니다.");
      username.textContent = "연결 필요";
      permission.textContent = "평가 권한 확인 전";
      renderEmpty("아직 연결된 평가 기록이 없습니다.");
      return;
    }

    setStatus("내 정보를 불러오는 중입니다.");

    const {
      data: { session },
    } = await withTimeout(
      supabase.auth.getSession(),
      "로그인 상태 확인 시간이 초과되었습니다.",
    );

    if (!session?.user) {
      setStatus("로그인 후 마이페이지를 확인할 수 있습니다.");
      username.textContent = "로그인 필요";
      permission.textContent = "평가 권한 확인 전";
      renderEmpty("오른쪽 위 메뉴에서 로그인해주세요.");
      return;
    }

    const [{ data: profile, error: profileError }, { data: ratings, error: ratingsError }] =
      await withTimeout(
        Promise.all([
          supabase
            .from("profiles")
            .select("username, can_rate")
            .eq("id", session.user.id)
            .maybeSingle(),
          supabase
            .from("ratings")
            .select("meal_id, score, one_line_review, updated_at")
            .eq("user_id", session.user.id)
            .order("updated_at", { ascending: false }),
        ]),
        "마이페이지 정보를 불러오는 시간이 초과되었습니다.",
      );

    if (profileError || ratingsError) {
      throw new Error(profileError?.message || ratingsError?.message);
    }

    username.textContent = profile?.username || session.user.email || "사용자";
    permission.textContent = profile?.can_rate
      ? "평가 권한 승인됨"
      : "평가 권한 승인 대기";
    setStatus("내 평가 기록");

    if (!ratings?.length) {
      renderEmpty("아직 남긴 평가가 없습니다.");
      return;
    }

    ratingList.innerHTML = ratings
      .map((rating) => {
        const mealName = mealNames[rating.meal_id] || rating.meal_id;
        const review = rating.one_line_review || "한줄평 없음";

        return `
          <li>
            <span>${mealName}</span>
            <strong>${rating.score}스타</strong>
            <p>"${review}"</p>
          </li>
        `;
      })
      .join("");
  } catch (error) {
    setStatus("마이페이지를 불러오지 못했습니다.");
    username.textContent = "확인 실패";
    permission.textContent = "다시 로그인해주세요.";
    renderEmpty(error.message || "잠시 후 다시 시도해주세요.");
  }
}

initMenu({ onAuthChange: loadMyPage, preloadAuth: false });
loadMyPage();
