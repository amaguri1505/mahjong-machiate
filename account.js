// ログイン画面とマイページの表示・入力。通信は online.js（window.Online）に任せる。
// Supabase が使えないときは何も表示せず、ゲームはログインなしで動く。
(function (root) {
  const L = root.MahjongLogic;
  const O = root.Online;
  const $ = (id) => document.getElementById(id);

  let account = null;
  const listeners = [];

  // ---- ログイン状態の表示（開始・終了画面の1行） ----

  function renderSlots() {
    document.querySelectorAll(".account-slot").forEach((slot) => {
      slot.replaceChildren();
      const text = document.createElement("span");
      text.className = "account-text";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn ghost small";
      if (account) {
        text.textContent = `${account.name} さん`;
        btn.textContent = "マイページ";
        btn.addEventListener("click", openMyPage);
      } else {
        text.textContent = "ログインすると記録がランキングとマイページに残ります";
        btn.textContent = "ログイン / 新規登録";
        btn.addEventListener("click", () => openAuth("signin"));
      }
      slot.append(text, btn);
      slot.hidden = false;
    });
  }

  function setAccount(next) {
    account = next;
    renderSlots();
    listeners.forEach((fn) => fn(account));
  }

  // ---- ログイン画面 ----

  const authOverlay = $("auth-overlay");
  const authForm = $("auth-form");
  const authStatus = $("auth-status");
  const authSubmit = $("auth-submit");
  const authNote = $("auth-note");
  const nameInput = $("auth-name");
  const emailInput = $("auth-email");
  const passwordInput = $("auth-password");

  // mode: signin（ログイン） / signup（新規登録） / forgot（再設定メール） / recovery（新しいパスワード）
  const MODES = {
    signin: { title: "ログイン", submit: "ログイン", fields: ["email", "password"] },
    signup: { title: "新規登録", submit: "登録する", fields: ["name", "email", "password"] },
    forgot: {
      title: "パスワードの再設定",
      submit: "再設定メールを送る",
      fields: ["email"],
      note: "登録したメールアドレスに、パスワードを決め直すためのリンクを送ります。",
    },
    recovery: {
      title: "新しいパスワード",
      submit: "保存する",
      fields: ["password"],
      note: "新しいパスワードを入れてください。",
    },
  };
  let authMode = "signin";

  function setAuthMode(mode) {
    authMode = mode;
    const m = MODES[mode];
    $("auth-title").textContent = m.title;
    authSubmit.textContent = m.submit;
    authNote.textContent = m.note || "";
    authNote.hidden = !m.note;
    for (const f of ["name", "email", "password"]) {
      const shown = m.fields.includes(f);
      $(`field-${f}`).hidden = !shown;
      $(`auth-${f}`).disabled = !shown;
    }
    passwordInput.autocomplete = mode === "signin" ? "current-password" : "new-password";
    $("auth-tabs").hidden = mode === "forgot" || mode === "recovery";
    $("auth-tabs").querySelectorAll("[role=tab]").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
    });
    $("auth-forgot").textContent = mode === "forgot" ? "ログインに戻る" : "パスワードを忘れたとき";
    $("auth-forgot").hidden = mode === "signup" || mode === "recovery";
    authStatus.textContent = "";
  }

  function openAuth(mode) {
    setAuthMode(mode);
    passwordInput.value = "";
    authSubmit.disabled = false;
    authOverlay.hidden = false;
    (mode === "signup" ? nameInput : mode === "recovery" ? passwordInput : emailInput).focus();
  }

  function closeAuth() {
    authOverlay.hidden = true;
  }

  async function submitAuth(e) {
    e.preventDefault();
    if (!authForm.reportValidity()) return;
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    authSubmit.disabled = true;
    authStatus.textContent = "送信しています…";
    try {
      if (authMode === "signin") {
        await O.signIn(email, password);
        closeAuth();
      } else if (authMode === "signup") {
        const { needsConfirm } = await O.signUp(email, password, nameInput.value);
        if (needsConfirm) {
          setAuthMode("signin");
          authStatus.textContent = "確認メールを送りました。メールのリンクを開いてから、ここでログインしてください。";
        } else {
          closeAuth();
        }
      } else if (authMode === "forgot") {
        await O.sendPasswordReset(email);
        authStatus.textContent = "再設定メールを送りました。メールのリンクから開き直してください。";
      } else if (authMode === "recovery") {
        await O.updatePassword(password);
        closeAuth();
      }
    } catch (err) {
      authStatus.textContent = err.message;
    } finally {
      authSubmit.disabled = false;
    }
  }

  // ---- マイページ ----

  const mypageOverlay = $("mypage-overlay");
  const historyList = $("my-history");
  const historyEmpty = $("my-history-empty");
  const profileName = $("profile-name");
  const profileStatus = $("profile-status");

  const formatPoints = (n) => n.toLocaleString("ja-JP");
  const formatDate = (ms) =>
    new Date(ms).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  function renderPlays(plays) {
    const s = L.summarizePlays(plays);
    $("my-best").textContent = `${formatPoints(s.best)}点`;
    $("my-count").textContent = `${s.count}回`;
    $("my-average").textContent = `${formatPoints(s.average)}点`;
    $("my-accuracy").textContent = s.accuracy === null ? "-" : `${s.accuracy}%`;
    $("my-streak").textContent = `${s.bestStreak}`;

    historyList.replaceChildren();
    for (const p of plays.slice(0, 10)) {
      const li = document.createElement("li");
      li.append(
        Object.assign(document.createElement("span"), { className: "name", textContent: formatDate(p.at) }),
        Object.assign(document.createElement("span"), { className: "detail", textContent: `${p.solved}/${p.answered}問` }),
        Object.assign(document.createElement("span"), { className: "points", textContent: formatPoints(p.score) })
      );
      historyList.appendChild(li);
    }
    historyEmpty.textContent = "まだプレイの記録がありません。";
    historyEmpty.hidden = plays.length > 0;
  }

  async function openMyPage() {
    if (!account) return;
    $("mypage-email").textContent = account.email;
    profileName.value = account.name;
    profileStatus.textContent = "";
    historyList.replaceChildren();
    historyEmpty.textContent = "読み込んでいます…";
    historyEmpty.hidden = false;
    mypageOverlay.hidden = false;
    try {
      renderPlays(await O.myPlays(account.id));
    } catch (err) {
      historyEmpty.textContent = err.message;
    }
  }

  async function submitProfile(e) {
    e.preventDefault();
    if (!account) return;
    $("profile-btn").disabled = true;
    profileStatus.textContent = "保存しています…";
    try {
      const name = await O.updateDisplayName(account.id, profileName.value);
      profileName.value = name;
      profileStatus.textContent = "表示名を変えました。";
      setAccount({ ...account, name });
    } catch (err) {
      profileStatus.textContent = err.message;
    } finally {
      $("profile-btn").disabled = false;
    }
  }

  async function logout() {
    try {
      await O.signOut();
      mypageOverlay.hidden = true;
    } catch (err) {
      profileStatus.textContent = err.message;
    }
  }

  // ---- 初期化 ----

  if (O.available) {
    nameInput.maxLength = L.NAME_MAX_LENGTH;
    profileName.maxLength = L.NAME_MAX_LENGTH;
    authForm.addEventListener("submit", submitAuth);
    $("auth-close").addEventListener("click", closeAuth);
    $("auth-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest("[role=tab]");
      if (tab) setAuthMode(tab.dataset.mode);
    });
    $("auth-forgot").addEventListener("click", () => setAuthMode(authMode === "forgot" ? "signin" : "forgot"));
    $("mypage-close").addEventListener("click", () => (mypageOverlay.hidden = true));
    $("profile-form").addEventListener("submit", submitProfile);
    $("logout-btn").addEventListener("click", logout);
    O.onAuthChange((next, event) => {
      setAccount(next);
      if (event === "PASSWORD_RECOVERY") openAuth("recovery");
    });
  }

  root.Account = {
    available: O.available,
    current: () => account,
    onChange(fn) {
      listeners.push(fn);
    },
  };
})(this);
