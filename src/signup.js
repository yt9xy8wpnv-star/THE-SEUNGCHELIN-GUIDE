import "./style.css";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const form = document.querySelector("#signup-form");
const status = document.querySelector("#signup-status");
const usernameInput = document.querySelector("#signup-username");
const emailInput = document.querySelector("#signup-email");
const passwordInput = document.querySelector("#signup-password");
const passwordConfirmInput = document.querySelector("#signup-password-confirm");

function setStatus(message) {
  status.textContent = message;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isSupabaseConfigured) {
    setStatus("Supabase 환경변수를 연결한 뒤 회원가입할 수 있습니다.");
    return;
  }

  const username = usernameInput.value.trim().toLowerCase();
  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  const passwordConfirm = passwordConfirmInput.value;

  if (!username || !email || !password) {
    setStatus("모든 항목을 입력해주세요.");
    return;
  }

  if (password !== passwordConfirm) {
    setStatus("비밀번호가 서로 다릅니다.");
    return;
  }

  setStatus("회원가입 처리 중입니다.");

  const { data: existingEmail } = await supabase.rpc("get_email_for_username", {
    login_username: username,
  });

  if (existingEmail) {
    setStatus("이미 사용 중인 아이디입니다.");
    return;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username,
      },
    },
  });

  if (error) {
    setStatus("회원가입에 실패했습니다. 입력값을 확인해주세요.");
    return;
  }

  if (data.session) {
    setStatus("회원가입이 완료되었습니다. 메인으로 이동합니다.");
    window.setTimeout(() => {
      window.location.href = "/";
    }, 700);
    return;
  }

  setStatus("회원가입이 완료되었습니다. 이메일 확인 설정이 켜져 있다면 메일을 확인해주세요.");
});
