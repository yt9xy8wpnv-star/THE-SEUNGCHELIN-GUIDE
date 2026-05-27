import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const IMAGE_DIR = "public/meal-images";
const PUBLIC_IMAGE_PREFIX = "/meal-images";
const VALID_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const MEAL_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-(breakfast|lunch|dinner)$/;
const SLOT_LABELS = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
};

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

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다.`);
  }
  return value;
}

function getImageCandidates() {
  const imageDirPath = resolve(process.cwd(), IMAGE_DIR);
  if (!existsSync(imageDirPath)) {
    return { candidates: [], ignored: [`${IMAGE_DIR} 폴더가 없습니다.`] };
  }

  const targetDate = getArg("date");
  const targetSlot = getArg("slot");
  const ignored = [];
  const candidates = readdirSync(imageDirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      if (entry.name === "README.md" || entry.name.startsWith(".")) {
        return null;
      }

      const extension = extname(entry.name).toLowerCase();
      const id = basename(entry.name, extension).toLowerCase();

      if (!VALID_EXTENSIONS.has(extension)) {
        ignored.push(`${entry.name}: 지원하지 않는 이미지 형식`);
        return null;
      }

      if (!MEAL_ID_PATTERN.test(id)) {
        ignored.push(`${entry.name}: 파일명 형식이 다름`);
        return null;
      }

      const [, slot] = id.match(MEAL_ID_PATTERN);
      const [year, month, day] = id.split("-");
      const date = `${year}-${month}-${day}`;

      if (targetDate && date !== targetDate) return null;
      if (targetSlot && slot !== targetSlot) return null;

      return {
        date,
        fileName: entry.name,
        id,
        imagePath: `${PUBLIC_IMAGE_PREFIX}/${entry.name}`,
        slot,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));

  return { candidates, ignored };
}

async function getSupabaseClient() {
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

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}

async function getExistingMeals(supabase, ids) {
  const { data, error } = await supabase
    .from("meals")
    .select("id, meal_date, meal_slot, title, image_path")
    .in("id", ids);

  if (error) {
    throw new Error(`급식 목록 확인 실패: ${error.message}`);
  }

  return new Map((data ?? []).map((meal) => [meal.id, meal]));
}

function printPlan({ candidates, existingMeals, ignored, dryRun }) {
  console.log(`\n급식 이미지 ${dryRun ? "연결 미리보기" : "연결 실행"}`);

  if (ignored.length > 0) {
    console.log("\n무시된 파일");
    ignored.forEach((message) => {
      console.log(`- ${message}`);
    });
  }

  if (candidates.length === 0) {
    console.log(`\n${IMAGE_DIR} 안에 연결할 이미지가 없습니다.`);
    console.log("예시: public/meal-images/2026-05-28-lunch.png");
    return;
  }

  console.log("\n연결 대상");
  candidates.forEach((candidate) => {
    const meal = existingMeals.get(candidate.id);
    const slotLabel = SLOT_LABELS[candidate.slot] || candidate.slot;

    if (!meal) {
      console.log(`- ${candidate.fileName}: Supabase에 ${candidate.id} 급식이 없음`);
      return;
    }

    console.log(
      `- ${candidate.date} ${slotLabel}: ${meal.image_path || "(이미지 없음)"} -> ${candidate.imagePath}`,
    );
  });
}

async function updateMealImages(supabase, candidates, existingMeals) {
  let updatedCount = 0;

  for (const candidate of candidates) {
    if (!existingMeals.has(candidate.id)) continue;

    const { error } = await supabase
      .from("meals")
      .update({ image_path: candidate.imagePath })
      .eq("id", candidate.id);

    if (error) {
      throw new Error(`${candidate.id} 이미지 연결 실패: ${error.message}`);
    }

    updatedCount += 1;
  }

  console.log(`\n${updatedCount}개 급식 이미지 연결 완료`);
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  loadEnvFile(resolve(process.cwd(), ".env"));

  const dryRun = hasFlag("dry-run");
  const { candidates, ignored } = getImageCandidates();

  if (candidates.length === 0) {
    printPlan({
      candidates,
      existingMeals: new Map(),
      ignored,
      dryRun,
    });
    return;
  }

  const supabase = await getSupabaseClient();
  const existingMeals = await getExistingMeals(
    supabase,
    candidates.map((candidate) => candidate.id),
  );

  printPlan({ candidates, existingMeals, ignored, dryRun });

  if (!dryRun) {
    await updateMealImages(supabase, candidates, existingMeals);
  }
}

main().catch((error) => {
  console.error(`\n급식 이미지 연결 실패: ${error.message}`);
  process.exit(1);
});
