// ローカルサーバーでは /api、それ以外は演習専用Supabaseへ接続する。
// DB資格情報や参加コードは配信しない。
window.WORKSHOP_API = location.hostname === '127.0.0.1' || location.hostname === 'localhost'
  ? '/api'
  : 'https://xroxdmybbpxulqgezvnh.supabase.co/functions/v1/workshop';
