import pathlib

content = r"""// ============================================================
//  蒋的APP - V3.0 多用户独立架构(彻底修复版)
//  修复项:
//    1. 页面加载时自动恢复会话(current_user_id)
//    2. 注册成功后立即保存 current_user_id
//    3. 所有功能按 user_id 严格隔离
//    4. 抽卡次数每用户独立(localStorage 按 user_id 分 key)
//    5. 留言板绑定 user_id
//    6. 添加登出按钮
// ============================================================

// ---- Supabase 配置 ----
var SUPABASE_URL = '"'"'https://rzrachgwnmkbeafhktse.supabase.co'"'"';
var SUPABASE_KEY = '"'"'sb_publishable_lzY69nQuBXB05sufZI5cAg_U_5xBhsf'"'"';
var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
var ADMIN_PASSWORD = '"'"'7'"'"';

// ---- 全局状态 ----
var currentUser = null;   // 当前登录用户对象 { id, name, avatar }

// ============================================================
//  工具函数
// ============================================================
function showToast(msg) {
  var el = document.createElement('"'"'div'"'"');
  el.className = '"'"'toast'"'"';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { document.body.removeChild(el); }, 2100);
}
"""

pathlib.Path("C:/Users/Lenovo/Desktop/APP/script_test2.js").write_text(content, encoding="utf-8")
print("test OK")
