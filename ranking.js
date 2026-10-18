// ランキングの保存先。
// Supabase につながるとき（online.js）は plays 表を使い、ログインした人の記録だけが載る。
// Artifact として開いたときは共有DB（claude.use("db")）に保存し、リンクを開ける全員で同じ表を見る。
// どちらも使えないときは localStorage に保存する（その端末だけのランキング）。
(function (root) {
  const L = root.MahjongLogic;
  const COLLECTION = "scores";
  const LOCAL_KEY = "mahjong-wait-quiz:ranking";
  const LOCAL_KEEP = 100;
  const TOP_N = 10;

  function createLocalStore() {
    const read = () => {
      try {
        return JSON.parse(localStorage.getItem(LOCAL_KEY)) || [];
      } catch {
        return [];
      }
    };
    let listener = null;
    return {
      shared: false,
      subscribe(onChange) {
        listener = onChange;
        onChange(L.sortRanking(read()).slice(0, TOP_N));
        return () => {
          listener = null;
        };
      },
      async add(entry) {
        const id = `${entry.at}-${Math.random().toString(36).slice(2, 8)}`;
        const all = L.sortRanking([...read(), { id, ...entry }]).slice(0, LOCAL_KEEP);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
        if (listener) listener(all.slice(0, TOP_N));
        return id;
      },
    };
  }

  function createDbStore(db) {
    const scores = db.collection(COLLECTION);
    return {
      shared: true,
      subscribe(onChange, onError) {
        return scores
          .orderBy("score", "desc")
          .limit(TOP_N)
          .onSnapshot(
            (snap) => onChange(L.sortRanking(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
            onError
          );
      },
      async add(entry) {
        const ref = await scores.add(entry);
        return ref.id;
      },
    };
  }

  // Supabase の一覧は自動では届かないので、登録したときと refresh() のときに読み直す
  function createOnlineStore(online) {
    let listener = null;
    let errorListener = null;
    const refresh = async () => {
      try {
        const entries = await online.topPlays(TOP_N);
        if (listener) listener(entries);
      } catch (e) {
        if (errorListener) errorListener(e);
      }
    };
    return {
      shared: true,
      online: true,
      subscribe(onChange, onError) {
        listener = onChange;
        errorListener = onError;
        refresh();
        return () => {
          listener = null;
          errorListener = null;
        };
      },
      refresh,
      async add(entry) {
        const id = await online.savePlay(entry);
        refresh();
        return id;
      },
    };
  }

  async function openRankingStore() {
    if (root.Online?.available) return createOnlineStore(root.Online);
    if (typeof root.claude?.use === "function") {
      try {
        const db = await root.claude.use("db");
        if (db) return createDbStore(db);
      } catch {
        // 使えないときはローカル保存に切り替える
      }
    }
    return createLocalStore();
  }

  root.Ranking = { TOP_N, openRankingStore };
})(this);
