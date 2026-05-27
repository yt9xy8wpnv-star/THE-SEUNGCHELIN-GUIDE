import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const KOREA_TIME_ZONE = "Asia/Seoul";
const NEIS_ENDPOINT = "https://open.neis.go.kr/hub/mealServiceDietInfo";
const SLOT_BY_NEIS_CODE = {
  1: "breakfast",
  2: "lunch",
  3: "dinner",
};
const IMAGE_BY_SLOT = {
  breakfast: "/assets/breakfast.png",
  lunch: "/assets/lunch.png",
  dinner: "/assets/dinner.png",
};
const DEFAULT_IMAGE_PATHS = new Set(Object.values(IMAGE_BY_SLOT));

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");

    content.split(/\r?\n/).forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) return;

      const match = trimmedLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) return;

      const [, key, rawValue] = match;
      const value = rawValue.trim().replace(/^['"]|['"]$/g, "");

      if (!process.env[key]) {
        process.env[key] = value;
      }
    });
  } catch {
    // Local env files are optional. Required keys are checked later.
  }
}

function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function formatKoreaDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeDate(value) {
  if (!value) return formatKoreaDate();

  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  throw new Error("날짜는 YYYY-MM-DD 또는 YYYYMMDD 형식으로 입력해주세요.");
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

function addDays(date, days) {
  const nextDate = parseDate(date);
  nextDate.setDate(nextDate.getDate() + days);
  return formatDate(nextDate);
}

function getSyncDates(date) {
  if (!hasFlag("window")) return [date];

  return Array.from({ length: 11 }, (_, index) => {
    return addDays(date, index - 3);
  });
}

function toNeisDate(date) {
  return date.replaceAll("-", "");
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다.`);
  }
  return value;
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function cleanMenuItem(value) {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\([^)]*\d+(?:\.\d+)*[^)]*\)/g, "")
    .replace(/\^/g, "/")
    .replace(/\s+\d+(?:\.\d+)*\.?$/g, "")
    .replace(/\d+(?:\.\d+)+\.?$/g, "")
    .replace(/^(.+[가-힣])\d{1,2}\.?$/g, "$1")
    .replace(/^[a-z]\s*(?=[가-힣])/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMenu(dishName) {
  return dishName
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\n+/)
    .map(cleanMenuItem)
    .filter(Boolean);
}

function makeTitle(menu) {
  if (menu.length === 0) return "급식 정보 없음";
  return menu.slice(0, 2).join(" · ");
}

async function fetchNeisMeals({ apiKey, officeCode, schoolCode, date }) {
  const url = new URL(NEIS_ENDPOINT);
  url.searchParams.set("KEY", apiKey);
  url.searchParams.set("Type", "json");
  url.searchParams.set("pIndex", "1");
  url.searchParams.set("pSize", "20");
  url.searchParams.set("ATPT_OFCDC_SC_CODE", officeCode);
  url.searchParams.set("SD_SCHUL_CODE", schoolCode);
  url.searchParams.set("MLSV_YMD", toNeisDate(date));

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NEIS 요청 실패: HTTP ${response.status}`);
  }

  const data = await response.json();
  const head = data.mealServiceDietInfo?.[0]?.head;
  const result = head?.[1]?.RESULT;

  if (result && result.CODE !== "INFO-000") {
    if (result.CODE === "INFO-200") return [];
    throw new Error(`NEIS 응답 오류: ${result.MESSAGE}`);
  }

  return data.mealServiceDietInfo?.[1]?.row ?? [];
}

function toMealRows(neisRows, date) {
  return neisRows
    .map((row) => {
      const slot = SLOT_BY_NEIS_CODE[row.MMEAL_SC_CODE];
      if (!slot) return null;

      const menu = parseMenu(row.DDISH_NM || "");
      return {
        id: `${date}-${slot}`,
        meal_date: date,
        meal_slot: slot,
        title: makeTitle(menu),
        menu,
        image_path: IMAGE_BY_SLOT[slot],
      };
    })
    .filter(Boolean);
}

async function upsertMeals(rows) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL 또는 VITE_SUPABASE_URL 환경변수가 필요합니다.");
  }

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다. Supabase Project Settings > API에서 service_role key를 복사해 .env.local에 추가해주세요.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });

  await preserveCustomImagePaths(supabase, rows);

  const { error } = await supabase.from("meals").upsert(rows, {
    onConflict: "id",
  });

  if (error) {
    throw new Error(`Supabase 저장 실패: ${error.message}`);
  }
}

function shouldPreserveImagePath(imagePath) {
  return Boolean(imagePath && !DEFAULT_IMAGE_PATHS.has(imagePath));
}

async function preserveCustomImagePaths(supabase, rows) {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;

  const { data, error } = await supabase
    .from("meals")
    .select("id, image_path")
    .in("id", ids);

  if (error) {
    throw new Error(`기존 급식 이미지 확인 실패: ${error.message}`);
  }

  const existingImages = new Map(
    (data ?? [])
      .filter((row) => shouldPreserveImagePath(row.image_path))
      .map((row) => [row.id, row.image_path]),
  );

  rows.forEach((row) => {
    const existingImagePath = existingImages.get(row.id);
    if (existingImagePath) {
      row.image_path = existingImagePath;
    }
  });
}

function printMealSummary(rows, date, dryRun) {
  const mode = dryRun ? "미리보기" : "저장 완료";
  console.log(`\n${date} 청주고등학교 급식 ${mode}`);

  if (rows.length === 0) {
    console.log("가져온 급식이 없습니다.");
    return;
  }

  rows.forEach((row) => {
    console.log(`\n[${row.meal_slot}] ${row.title}`);
    row.menu.forEach((item) => {
      console.log(`- ${item}`);
    });
  });
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  loadEnvFile(resolve(process.cwd(), ".env"));

  const date = normalizeDate(getArg("date"));
  const syncDates = getSyncDates(date);
  const dryRun = hasFlag("dry-run");
  const apiKey = requiredEnv("NEIS_API_KEY");
  const officeCode = process.env.NEIS_OFFICE_CODE || "M10";
  const schoolCode = process.env.NEIS_SCHOOL_CODE || "8000066";
  const allMealRows = [];

  for (const syncDate of syncDates) {
    const neisRows = await fetchNeisMeals({
      apiKey,
      officeCode,
      schoolCode,
      date: syncDate,
    });
    const mealRows = toMealRows(neisRows, syncDate);
    allMealRows.push(...mealRows);
    printMealSummary(mealRows, syncDate, dryRun);
  }

  if (!dryRun && allMealRows.length > 0) {
    await upsertMeals(allMealRows);
  }
}

main().catch((error) => {
  console.error(`\n급식 동기화 실패: ${error.message}`);
  process.exit(1);
});
