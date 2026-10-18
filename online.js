// Supabase との通信（ログイン・プロフィール・プレイ記録）。DOM には触らない。
// supabase-js が読み込めなかったとき（オフラインなど）や Artifact として開いたときは
// available が false になり、ゲームはログインなしの今までの動きになる。
(function (root) {
  const SUPABASE_URL = "https://hguijtaglmemzlybgpur.supabase.co";
  // 公開して問題ない publishable key。データの保護は supabase/schema.sql のアクセスルールで行う。
  const SUPABASE_KEY = "sb_publishable_5Y2lWePZ1gSM-RHA2LezyQ_iby05EqF";

  const L = root.MahjongLogic;
  const inArtifact = typeof root.claude?.use === "function";
  const client =
    !inArtifact && typeof root.supabase?.createClient === "function"
      ? root.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
      : null;

  // Supabase のエラーを画面に出せる日本語にする
  function errorMessage(error) {
    const code = error?.code || "";
    const messages = {
      invalid_credentials: "メールアドレスかパスワードが違います。",
      email_not_confirmed: "確認メールのリンクを開いてからログインしてください。",
      user_already_exists: "このメールアドレスはすでに登録されています。",
      email_exists: "このメールアドレスはすでに登録されています。",
      weak_password: "パスワードが短すぎます。6文字以上にしてください。",
      validation_failed: "メールアドレスの形を確かめてください。",
      email_address_invalid: "このメールアドレスは使えません。",
      over_email_send_rate_limit: "メールの送信が多すぎます。しばらく待ってからお試しください。",
      over_request_rate_limit: "操作が多すぎます。しばらく待ってからお試しください。",
      same_password: "今と同じパスワードです。別のパスワードにしてください。",
    };
    if (messages[code]) return messages[code];
    if (error?.name === "AuthRetryableFetchError" || /fetch/i.test(error?.message || "")) {
      return "通信できませんでした。電波の良いところでもう一度お試しください。";
    }
    return "うまくいきませんでした。時間をおいてもう一度お試しください。";
  }

  // supabase-js は失敗を { error } で返すので、例外に変えて呼び出し側を簡単にする
  function check({ data, error }) {
    if (error) throw Object.assign(new Error(errorMessage(error)), { cause: error });
    return data;
  }

  function redirectUrl() {
    return /^https?:$/.test(location.protocol) ? location.origin + location.pathname : undefined;
  }

  async function loadAccount(user) {
    if (!user) return null;
    const { data } = await client.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    return { id: user.id, email: user.email, name: data?.display_name || "名無し" };
  }

  // ログイン状態が変わるたびに onChange(account | null, event) を呼ぶ。
  // event が "PASSWORD_RECOVERY" のときは、再設定メールのリンクから開いたことを表す。
  function onAuthChange(onChange) {
    client.auth.onAuthStateChange((event, session) => {
      // コールバックの中で Supabase を待つと固まることがあるので、処理は後回しにする
      setTimeout(async () => onChange(await loadAccount(session?.user), event), 0);
    });
  }

  async function signIn(email, password) {
    check(await client.auth.signInWithPassword({ email, password }));
  }

  // 確認メールが必要な設定のときは { needsConfirm: true } を返す
  async function signUp(email, password, name) {
    const data = check(
      await client.auth.signUp({
        email,
        password,
        options: { data: { display_name: L.sanitizeName(name) }, emailRedirectTo: redirectUrl() },
      })
    );
    return { needsConfirm: !data.session };
  }

  async function signOut() {
    check(await client.auth.signOut());
  }

  async function sendPasswordReset(email) {
    check(await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() }));
  }

  async function updatePassword(password) {
    check(await client.auth.updateUser({ password }));
  }

  async function updateDisplayName(userId, name) {
    const displayName = L.sanitizeName(name);
    check(await client.from("profiles").update({ display_name: displayName }).eq("id", userId));
    return displayName;
  }

  const toPlay = (row) => ({
    id: row.id,
    score: row.score,
    solved: row.solved,
    answered: row.answered,
    bestStreak: row.best_streak,
    at: Date.parse(row.created_at),
  });

  async function savePlay({ score, solved, answered, bestStreak }) {
    const row = check(
      await client
        .from("plays")
        .insert({ score, solved, answered, best_streak: bestStreak })
        .select("id")
        .single()
    );
    return row.id;
  }

  async function myPlays(userId) {
    const rows = check(
      await client
        .from("plays")
        .select("id, score, solved, answered, best_streak, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1000)
    );
    return rows.map(toPlay);
  }

  async function topPlays(limit) {
    const rows = check(
      await client
        .from("plays")
        .select("id, score, solved, answered, best_streak, created_at, user_id, profiles(display_name)")
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(limit)
    );
    return rows.map((row) => ({ ...toPlay(row), userId: row.user_id, name: row.profiles?.display_name || "名無し" }));
  }

  root.Online = {
    available: client !== null,
    onAuthChange,
    signIn,
    signUp,
    signOut,
    sendPasswordReset,
    updatePassword,
    updateDisplayName,
    savePlay,
    myPlays,
    topPlays,
  };
})(this);
