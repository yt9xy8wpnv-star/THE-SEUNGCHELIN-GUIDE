import "./style.css";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";

const form = document.querySelector("#signup-form");
const status = document.querySelector("#signup-status");
const usernameInput = document.querySelector("#signup-username");
const emailInput = document.querySelector("#signup-email");
const passwordInput = document.querySelector("#signup-password");
const passwordConfirmInput = document.querySelector("#signup-password-confirm");
const submitButton = form.querySelector('button[type="submit"]');

function setStatus(message) {
  status.textContent = message;
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submitButton.disabled = true;

  try {
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

    const { data: existingEmail, error: lookupError } = await supabase.rpc(
      "get_email_for_username",
      {
        login_username: username,
      },
    );

    if (lookupError) {
      setStatus(`아이디 확인 실패: ${lookupError.message}`);
      return;
    }

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
      setStatus(`회원가입 실패: ${error.message}`);
      return;
    }

    if (!data.user) {
      setStatus("회원가입 정보를 확인하지 못했습니다. 다시 시도해주세요.");
      return;
    }

    const { error: profileError } = await supabase.rpc("complete_signup_profile", {
      new_user_id: data.user.id,
      user_email: email,
      profile_username: username,
    });

    if (profileError && !data.session) {
      setStatus(`회원 정보 저장 실패: ${profileError.message}`);
      return;
    }

    if (data.session) {
      const { error: sessionProfileError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: data.user.id,
            email,
            username,
            can_rate: false,
          },
          { onConflict: "id" },
        );

      if (sessionProfileError) {
        setStatus(`회원 정보 저장 실패: ${sessionProfileError.message}`);
        return;
      }
    }

    setStatus("회원가입이 완료되었습니다. 메인으로 이동합니다.");
    window.setTimeout(() => {
      window.location.href = "/";
    }, 700);
  } catch (error) {
    setStatus(`회원가입 오류: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
});

initPasswordToggles();
