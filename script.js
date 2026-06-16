// ============================================================
// 钂嬬殑APP - 涓夊眰鏁版嵁缁撴瀯閲嶆瀯
// User Core / Social Layer / Asset Layer
// ============================================================

(function() {
  'use strict';

  window.onerror = function(message, source, lineno, colno, error) {
    console.error('Global error:', message, source, lineno, colno, error);
    recoverFromFatalError();
    return true;
  };

  window.onunhandledrejection = function(event) {
    console.error('Unhandled promise rejection:', event.reason);
    recoverFromFatalError();
  };

  var SUPABASE_URL = 'https://rzrachgwnmkbeafhktse.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_lzY69nQuBXB05sufZI5cAg_U_5xBhsf';
  var supabase = window.supabase && window.supabase.createClient ?
    window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) :
    null;
  var ADMIN_PASSWORD = '222';
  var ADMIN_SESSION_KEY = 'isAdmin';
  var DAILY_GACHA_LIMIT = 3;
  var SESSION_USER_ID_KEY = 'cardapp_current_user_id';
  var SUPABASE_RETRY_LIMIT = 2;
  var TOP_LEVEL_PAGES = {
    home: true,
    discover: true,
    search: true,
    warehouse: true
  };
  var SWIPE_BACK_EDGE = 32;
  var SWIPE_BACK_THRESHOLD = 80;

  var appState = {
    user: null,
    selectedAvatar: '😀',
    isDrawing: false,
    adminMode: sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true',
    adminPanelOpen: false,
    messageComposeOpen: false,
    profileUserId: null,
    currentPage: 'login'
  };
  var messagesRealtimeChannel = null;
  var friendsRealtimeChannel = null;
  var swipeBackState = null;
  var lastBackTouchTime = 0;
  var Router = null;

  function renderFallbackHome() {
    var container = document.getElementById('app');
    if (!container) return;
    container.innerHTML =
      '<div id="page-home" class="page active">' +
        '<h1>主页</h1>' +
        '<p class="gacha-desc">页面加载中，请稍候...</p>' +
      '</div>';
  }

  function recoverFromFatalError() {
    var run = function() {
      safeRender(function() {
        hideLoading();
        if (!Router) initRouter();
        if (!Router.current) Router.current = appState.user ? 'home' : 'login';
        render();
      }, 'recoverFromFatalError');
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function onReady() {
        document.removeEventListener('DOMContentLoaded', onReady);
        run();
      });
    } else {
      run();
    }
  }

  function delay(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  }

  function shouldRetrySupabaseError(err) {
    if (!err) return true;
    var msg = getErrorMessage(err).toLowerCase();
    return msg.indexOf('network') !== -1 ||
      msg.indexOf('fetch') !== -1 ||
      msg.indexOf('timeout') !== -1 ||
      msg.indexOf('failed to fetch') !== -1 ||
      msg.indexOf('load failed') !== -1 ||
      msg.indexOf('temporarily') !== -1 ||
      msg.indexOf('rate limit') !== -1;
  }

  function safeRender(renderFn, label) {
    try {
      if (typeof renderFn === 'function') return renderFn();
    } catch (err) {
      console.error('safeRender failed:', label || 'render', err);
      recoverFromFatalError();
    }
    return null;
  }

  function eachNode(nodes, handler) {
    if (!nodes || !handler) return;
    for (var i = 0; i < nodes.length; i += 1) {
      handler(nodes[i], i);
    }
  }

  function safeQuery(requestFactory, defaultData, retryLimit) {
    var maxRetries = retryLimit == null ? SUPABASE_RETRY_LIMIT : retryLimit;
    var attempt = 0;
    var fallback = defaultData == null ? [] : defaultData;

    function run() {
      var request;
      try {
        request = typeof requestFactory === 'function' ? requestFactory() : requestFactory;
      } catch (err) {
        console.error('safeQuery factory failed:', err);
        return Promise.resolve({ data: fallback, error: err, safeFailed: true });
      }

      return Promise.resolve(request).then(function(res) {
        if (res && res.error) {
          if (attempt < maxRetries && shouldRetrySupabaseError(res.error)) {
            attempt += 1;
            return delay(300 * attempt).then(run);
          }
          console.error('safeQuery Supabase error:', res.error);
          return { data: fallback, error: res.error, safeFailed: true };
        }
        return res || { data: fallback, error: null };
      }).catch(function(err) {
        if (attempt < maxRetries && shouldRetrySupabaseError(err)) {
          attempt += 1;
          return delay(300 * attempt).then(run);
        }
        console.error('safeQuery failed:', err);
        return { data: fallback, error: err, safeFailed: true };
      });
    }

    return run();
  }

  function sb(requestFactory, retryLimit) {
    return safeQuery(requestFactory, [], retryLimit);
  }

  function requireUserId() {
    if (!appState.user || !appState.user.id) throw new Error('请先登录');
    return appState.user.id;
  }

  function getErrorMessage(err) {
    if (!err) return '未知错误';
    return err.message || err.details || err.hint || String(err);
  }

  function requireSupabaseSuccess(res) {
    if (res && res.error) throw res.error;
    return res;
  }

  function generateClientMessageId() {
    return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
  }

  function normalizeMessage(message, status) {
    message = message || {};
    var createdAt = message.created_at || new Date().toISOString();
    var clientId = message.client_id || message.local_id || null;
    return {
      id: message.id == null ? null : message.id,
      client_id: clientId,
      local_id: clientId,
      user_id: message.user_id || null,
      content: message.content || '',
      created_at: createdAt,
      sync_status: status || message.sync_status || (message.id ? 'synced' : 'pending')
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getUserSignature(user) {
    return user && user.signature ? user.signature : '这个人还没有设置个性签名';
  }

  function isMissingUserError(err) {
    var msg = getErrorMessage(err);
    return msg.indexOf('cards_user_id_fkey') !== -1 ||
      msg.indexOf('cards_owner_id_fkey') !== -1 ||
      msg.indexOf('foreign key constraint') !== -1;
  }

  function isMissingMessageColumnError(err) {
    var msg = getErrorMessage(err).toLowerCase();
    return msg.indexOf('client_id') !== -1 ||
      msg.indexOf('user_id') !== -1 ||
      msg.indexOf('schema cache') !== -1 ||
      msg.indexOf('could not find') !== -1;
  }

  function isDuplicateMessageError(err) {
    var msg = getErrorMessage(err).toLowerCase();
    return msg.indexOf('duplicate') !== -1 ||
      msg.indexOf('unique') !== -1 ||
      msg.indexOf('23505') !== -1;
  }

  function showToast(msg) {
    safeRender(function() {
      var el = document.createElement('div');
      el.className = 'toast';
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(function() {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 2100);
    }, 'showToast');
  }

  function generateUserId() {
    return 'U' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  function generateTradeId() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 18; i += 1) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  function formatDate(d) {
    if (!d) return '';
    var dt = new Date(d);
    return dt.getFullYear() + '-' +
      pad2(dt.getMonth() + 1) + '-' +
      pad2(dt.getDate()) + ' ' +
      pad2(dt.getHours()) + ':' +
      pad2(dt.getMinutes());
  }

  function pad2(value) {
    value = String(value);
    return value.length < 2 ? '0' + value : value;
  }

  function hideLoading() {
    safeRender(function() {
      var overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.classList.add('hidden');
    }, 'hideLoading');
  }

  function isTopLevelPage(name) {
    return !!TOP_LEVEL_PAGES[name];
  }

  function syncHistoryState(name, mode) {
    if (!window.history || !window.history.pushState) return;
    var state = {
      page: name,
      stack: Router ? Router.stack.slice() : []
    };
    var url = '#/' + name;
    if (mode === 'push') window.history.pushState(state, '', url);
    else window.history.replaceState(state, '', url);
  }

  function getBottomNavHtml(currentPage) {
    var items = [
      {
        page: 'home',
        label: '主页',
        icon: '<svg viewBox="0 0 24 24"><path d="M4.5 11.2 12 4.8l7.5 6.4"/><path d="M6.5 10.3v8.9h11v-8.9"/><path d="M10 19.2v-5h4v5"/></svg>'
      },
      {
        page: 'discover',
        label: '新发现',
        icon: '<svg viewBox="0 0 24 24"><path d="M12 4.2l1.8 5.1 5.4 1.1-4.1 3.6.7 5.4-4.8-2.7-4.8 2.7.7-5.4-4.1-3.6 5.4-1.1L12 4.2Z"/></svg>'
      },
      {
        page: 'search',
        label: '搜索',
        icon: '<svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="5.9"/><path d="m15.4 15.4 4.2 4.2"/></svg>'
      },
      {
        page: 'warehouse',
        label: '资料库',
        icon: '<svg viewBox="0 0 24 24"><path d="M5.5 5.5h13v15h-13Z"/><path d="M8.5 8.8h7"/><path d="M8.5 12h7"/><path d="M8.5 15.2h4.8"/></svg>'
      }
    ];
    return '<nav id="bottom-nav" class="bottom-nav">' + items.map(function(item) {
      return '<button class="nav-item' + (item.page === currentPage ? ' active' : '') + '" data-page="' + item.page + '">' +
        '<span class="nav-icon" aria-hidden="true">' + item.icon + '</span>' +
        '<span class="nav-label">' + item.label + '</span>' +
        '</button>';
    }).join('') + '</nav>';
  }

  function getUserAvatarButtonHtml() {
    if (!appState.user) return '';
    var avatar = appState.user.avatar || '😀';
    return '<button id="user-avatar-button" class="user-avatar-button" type="button" aria-label="进入个人主页和设置">' +
      avatar +
      '</button>';
  }

  function getPageHtml(name) {
    if (name === 'login') {
      return '<div id="page-login" class="page active">' +
        '<div class="login-container">' +
          '<h1>🎴 Cuecara</h1>' +
          '<p class="subtitle">关系 · 收藏 · 名片</p>' +
          '<div class="form-group">' +
            '<input type="text" id="login-name" placeholder="输入你的名字（昵称）" maxlength="20" autocomplete="off">' +
          '</div>' +
          '<div class="avatar-picker">' +
            '<p>选择头像：</p>' +
            '<div class="avatar-grid" id="avatar-grid"></div>' +
          '</div>' +
          '<button id="btn-login" class="btn-primary">进入系统</button>' +
        '</div>' +
      '</div>';
    }
    if (name === 'home') {
      return '<div id="page-home" class="page active">' +
        '<h1>主页</h1>' +
        '<p class="gacha-desc">你的个人名片</p>' +
        '<div class="profile-card home-profile-card">' +
          '<div id="home-avatar" class="profile-avatar"></div>' +
          '<div class="home-profile-main">' +
            '<h2 id="home-name"></h2>' +
            '<p class="user-id">ID: <span id="home-id"></span></p>' +
            '<p class="profile-signature" id="home-signature"></p>' +
            '<div class="stats-row home-stats-row">' +
              '<div class="stat-item"><span class="stat-num" id="home-stat-collection">0</span><span class="stat-label">资料</span></div>' +
              '<div class="stat-item"><span class="stat-num" id="home-stat-friends">0</span><span class="stat-label">关系</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    if (name === 'me') {
      return '<div id="page-me" class="page active">' +
        '<div class="profile-card">' +
          '<div id="me-avatar" class="profile-avatar"></div>' +
          '<h2 id="me-name"></h2>' +
          '<p class="user-id">ID: <span id="me-id"></span></p>' +
          '<p class="profile-signature" id="me-signature"></p>' +
          '<div class="stats-row">' +
            '<div class="stat-item"><span class="stat-num" id="stat-collection">0</span><span class="stat-label">仓库</span></div>' +
            '<div class="stat-item"><span class="stat-num" id="stat-friends">0</span><span class="stat-label">好友</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="profile-edit-card">' +
          '<div class="section-title">编辑资料</div>' +
          '<div class="form-group">' +
            '<input type="text" id="profile-name-input" placeholder="用户名" maxlength="20" autocomplete="off">' +
          '</div>' +
          '<div class="form-group">' +
            '<textarea id="profile-signature-input" placeholder="个性签名" maxlength="80"></textarea>' +
          '</div>' +
          '<button id="btn-save-profile" class="btn-primary">保存资料</button>' +
        '</div>' +
        '<div class="menu-list">' +
          '<button class="menu-item" data-open-page="friends"><span><i class="flat-icon icon-service"></i>服务</span><b>›</b></button>' +
          '<button class="menu-item" data-open-page="collection"><span><i class="flat-icon icon-collection"></i>收藏</span><b>›</b></button>' +
          '<button class="menu-item" data-open-page="message"><span><i class="flat-icon icon-message"></i>留言板（朋友圈）</span><b>›</b></button>' +
          '<button class="menu-item" data-open-page="warehouse"><span><i class="flat-icon icon-work"></i>卡牌作品</span><b>›</b></button>' +
          '<button class="menu-item" data-open-page="message"><span><i class="flat-icon icon-face"></i>表情</span><b>›</b></button>' +
          '<button class="menu-item" data-open-page="pursuit"><span><i class="flat-icon icon-settings"></i>设置</span><b>›</b></button>' +
        '</div>' +
      '</div>';
    }
    if (name === 'discover') {
      return '<div id="page-discover" class="page active">' +
        '<h1>新发现</h1>' +
        '<p class="gacha-desc">发现新的卡牌、收藏和关系</p>' +
        '<div class="entry-list">' +
          '<button class="entry-item" data-open-page="gacha"><span><i class="flat-icon icon-card"></i>抽卡</span><small>抽取新的社交资产</small></button>' +
          '<button class="entry-item" data-open-page="collection"><span><i class="flat-icon icon-collection"></i>收藏</span><small>查看你收藏的卡牌</small></button>' +
          '<button class="entry-item" data-open-page="friends"><span><i class="flat-icon icon-service"></i>服务</span><small>好友与关系</small></button>' +
        '</div>' +
      '</div>';
    }
    if (name === 'search') {
      return '<div id="page-search" class="page active">' +
        '<h1>搜索</h1>' +
        '<p class="gacha-desc">快速进入留言、好友和卡牌资料</p>' +
        '<div class="entry-list">' +
          '<button class="entry-item" data-open-page="message"><span><i class="flat-icon icon-message"></i>留言</span><small>查看朋友圈留言</small></button>' +
          '<button class="entry-item" data-open-page="friends"><span><i class="flat-icon icon-service"></i>好友</span><small>通过 user_id 添加好友</small></button>' +
          '<button class="entry-item" data-open-page="warehouse"><span><i class="flat-icon icon-work"></i>资料库</span><small>检索已持有卡牌</small></button>' +
        '</div>' +
      '</div>';
    }
    if (name === 'pursuit') {
      return '<div id="page-pursuit" class="page active">' +
        '<h1>追求</h1>' +
        '<p class="gacha-desc">当前仅开放设置</p>' +
        '<div class="menu-list">' +
          '<button class="menu-item" id="btn-show-admin"><span><i class="flat-icon icon-settings"></i>设置</span><b>›</b></button>' +
        '</div>' +
        (appState.adminPanelOpen ?
        '<div id="admin-panel" class="debug-panel">' +
          '<div class="section-title">管理员</div>' +
          '<div class="add-friend-form">' +
            '<input type="password" id="admin-password-input" placeholder="输入管理员密码">' +
            '<button id="btn-admin-login" class="btn-small">开启</button>' +
          '</div>' +
          '<div id="admin-status" class="gacha-desc">ADMIN_MODE: OFF</div>' +
          (appState.adminMode ? '<button id="btn-admin-logout" class="btn-small">退出管理员模式</button>' : '') +
          '<div id="debug-panel" class="debug-panel-inner"></div>' +
        '</div>' : '') +
      '</div>';
    }
    if (name === 'friends') {
      return '<div id="page-friends" class="page active">' +
        '<h1>好友</h1>' +
        '<div class="add-friend-form">' +
          '<input type="text" id="friend-id-input" placeholder="输入好友 user_id">' +
          '<button id="btn-add-friend" class="btn-small">添加</button>' +
        '</div>' +
        '<div id="friends-list" class="friends-list"></div>' +
      '</div>';
    }
    if (name === 'friend-profile') {
      return '<div id="page-friend-profile" class="page active">' +
        '<h1>好友名片</h1>' +
        '<div class="profile-card home-profile-card friend-profile-card">' +
          '<div id="friend-profile-avatar" class="profile-avatar"></div>' +
          '<div class="home-profile-main">' +
            '<h2 id="friend-profile-name"></h2>' +
            '<p class="user-id">ID: <span id="friend-profile-id"></span></p>' +
            '<p class="profile-signature" id="friend-profile-signature"></p>' +
            '<div class="stats-row home-stats-row">' +
              '<div class="stat-item"><span class="stat-num" id="friend-profile-stat-collection">0</span><span class="stat-label">资料</span></div>' +
              '<div class="stat-item"><span class="stat-num" id="friend-profile-stat-friends">0</span><span class="stat-label">关系</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
    if (name === 'gacha') {
      return '<div id="page-gacha" class="page active">' +
        '<h1>抽卡</h1>' +
        '<p class="gacha-desc">每天三张牌，点击未翻开的牌抽取</p>' +
        '<p class="gacha-remain" id="gacha-remain">今日剩余: 3/3</p>' +
        '<div class="gacha-area"><div id="gacha-result" class="gacha-result gacha-spread"></div></div>' +
      '</div>';
    }
    if (name === 'collection') {
      return '<div id="page-collection" class="page active">' +
        '<h1>我的收藏</h1>' +
        '<p class="gacha-desc">只显示已收藏的卡牌</p>' +
        '<div id="collection-list" class="card-list"></div>' +
      '</div>';
    }
    if (name === 'warehouse') {
      return '<div id="page-warehouse" class="page active">' +
        '<h1>卡牌仓库</h1>' +
        '<p class="gacha-desc">显示当前账号持有的全部卡牌</p>' +
        '<div class="trade-claim-box">' +
          '<div class="section-title">领取卡牌</div>' +
          '<div class="add-friend-form">' +
            '<input type="text" id="trade-code-input" placeholder="输入18位 trade_id 领取卡牌" autocomplete="off" maxlength="18">' +
            '<button id="btn-claim-trade" class="btn-small">领取</button>' +
          '</div>' +
        '</div>' +
        '<div id="warehouse-list" class="card-list"></div>' +
      '</div>';
    }
    if (name === 'message') {
      return '<div id="page-message" class="page active">' +
        '<h1>留言板</h1>' +
        '<p class="gacha-desc" id="msg">点击按钮进入留言板</p>' +
        (!appState.messageComposeOpen ? '<button id="myBtn" class="btn-primary">进入留言板</button>' : '') +
        (appState.messageComposeOpen ?
        '<div id="inputArea" class="message-compose">' +
          '<div class="add-friend-form">' +
            '<input type="text" id="userInput" placeholder="写点什么..." maxlength="200" autocomplete="off">' +
            '<button id="sendBtn" class="btn-small">发送</button>' +
          '</div>' +
          '<div id="moodArea">' +
            '<div class="mood-row">' +
              '<span style="font-size:13px;color:var(--subtext);margin-right:8px;">心情：</span>' +
              '<button class="mood-btn" data-mood="开心">😄 开心</button>' +
              '<button class="mood-btn" data-mood="平静">😌 平静</button>' +
              '<button class="mood-btn" data-mood="难过">😢 难过</button>' +
              '<button class="mood-btn" data-mood="生气">😠 生气</button>' +
            '</div>' +
          '</div>' +
        '</div>' : '') +
        '<div id="messages" class="card-list"></div>' +
      '</div>';
    }
    return getPageHtml('home');
  }

  function render() {
    console.log("render running");
    try {
      if (!Router) initRouter();
      if (!Router.stack) Router.stack = [];
      if (!Router.current) Router.current = appState.user ? 'home' : 'login';

      var name = Router.current;
      var container = document.getElementById('app');
      if (!container) return;
      appState.currentPage = name;

      var isSubPage = Router.stack.length > 0;
      console.log("render:", isSubPage, Router.stack.length);

      container.innerHTML = "";
      if (document.body) {
        document.body.classList.toggle('is-sub-page', isSubPage);
        document.body.classList.toggle('is-login-page', name === 'login');
      }

      container.innerHTML =
        (isSubPage ? '<button id="page-back" class="page-back back" type="button" aria-label="返回">‹</button>' : '') +
        (name !== 'login' && name !== 'me' ? getUserAvatarButtonHtml() : '') +
        getPageHtml(name) +
        (!isSubPage && name !== 'login' ? getBottomNavHtml(name) : '');

      if (!container.innerHTML) renderFallbackHome();

      var backBtn = document.querySelector('.back');
      if (backBtn) {
        backBtn.onclick = Router.pop;
        backBtn.ontouchend = Router.pop;
      }
      bindRenderedEvents();
    } catch (err) {
      console.error('render failed:', err);
      renderFallbackHome();
    }
  }

  function initRouter() {
    Router = {
      current: 'login',
      stack: [],
      replace: function(page) {
        this.current = page;
        this.stack = [];
        render();
        syncHistoryState(page, 'replace');
      },
      push: function(page) {
        if (this.current && this.current !== 'login' && this.current !== page) this.stack.push(this.current);
        if (!this.stack.length && this.current !== page && this.current !== 'login') this.stack.push(this.current);
        this.current = page;
        render();
        syncHistoryState(page, 'push');
      },
      pop: function(event) {
        if (event && event.preventDefault) event.preventDefault();
        if (event && event.stopPropagation) event.stopPropagation();
        if (event && event.type === 'touchend') {
          lastBackTouchTime = Date.now();
        } else if (event && event.type === 'click' && Date.now() - lastBackTouchTime < 450) {
          return;
        }
        if (Router.stack.length > 0) {
          Router.current = Router.stack.pop();
        }
        render();
        syncHistoryState(Router.current, 'replace');
        loadPageData(Router.current);
      },
      restore: function(page, stack) {
        this.current = page;
        this.stack = Array.isArray(stack) ? stack.slice() : [];
        render();
      }
    };
  }

  function showPage(name) {
    safeRender(function() {
      if (!Router) initRouter();
      Router.current = name;
      render();
    }, 'showPage:' + name);
  }

  function showLoginPage() {
    safeRender(function() {
      if (!Router) initRouter();
      Router.replace('login');
    }, 'showLoginPage');
  }

  function showAppPage(name) {
    safeRender(function() {
      if (!Router) initRouter();
      Router.replace(name);
    }, 'showAppPage:' + name);
  }

  function setCurrentUser(user) {
    appState.user = user;
    if (user && user.id) localStorage.setItem(SESSION_USER_ID_KEY, user.id);
    else localStorage.removeItem(SESSION_USER_ID_KEY);
  }

  function clearCurrentUser() {
    appState.user = null;
    localStorage.removeItem(SESSION_USER_ID_KEY);
  }

  function handleMissingUserSession() {
    clearCurrentUser();
    showLoginPage();
    showToast('当前用户不存在，请重新登录或注册');
  }

  var UserCore = {
    getById: function(userId) {
      return sb(function() { return supabase.from('users').select('*').eq('id', userId).limit(1); }).then(function(res) {
        return res.data && res.data.length ? res.data[0] : null;
      });
    },
    getByName: function(name) {
      return sb(function() { return supabase.from('users').select('*').eq('name', name).limit(1); }).then(function(res) {
        return res.data && res.data.length ? res.data[0] : null;
      });
    },
    create: function(name, avatar) {
      return sb(function() { return supabase.from('users').insert({
        id: generateUserId(),
        name: name,
        avatar: avatar,
        gacha_remaining: DAILY_GACHA_LIMIT
      }).select('*').single(); }).then(function(res) {
        return res.data;
      });
    },
    getGachaRemaining: function(userId) {
      return sb(function() { return supabase.from('users').select('gacha_remaining').eq('id', userId).single(); }).then(function(res) {
        return res.data.gacha_remaining;
      });
    },
    setGachaRemaining: function(userId, nextRemaining) {
      return sb(function() { return supabase.from('users').update({
        gacha_remaining: nextRemaining
      }).eq('id', userId).select('*').single(); }).then(function(res) {
        appState.user = res.data;
        return res.data.gacha_remaining;
      });
    },
    updateProfile: function(userId, payload) {
      return sb(function() {
        return supabase.from('users').update(payload).eq('id', userId).select('*').single();
      }).then(function(res) {
        if (res && res.error) throw res.error;
        return res.data;
      });
    }
  };

  var SocialLayer = {
    listFriends: function(userId) {
      return sb(function() { return supabase.from('friends').select('*').eq('user_id', userId).order('created_at', { ascending: false }); });
    },
    isDuplicateFriendError: function(err) {
      if (!err) return false;
      var msg = (err.message || err.details || '').toLowerCase();
      return err.code === '23505' ||
        msg.indexOf('duplicate') !== -1 ||
        msg.indexOf('unique') !== -1;
    },
    insertFriendEdge: function(userId, friendId) {
      return sb(function() {
        return supabase.from('friends').insert({
          user_id: userId,
          friend_id: friendId
        });
      }).then(function(res) {
        if (res && res.error && !SocialLayer.isDuplicateFriendError(res.error)) throw res.error;
        return res;
      });
    },
    addFriend: function(userId, friendId) {
      return sb(function() {
        return supabase
          .from('friends')
          .select('user_id,friend_id')
          .or('and(user_id.eq.' + userId + ',friend_id.eq.' + friendId + '),and(user_id.eq.' + friendId + ',friend_id.eq.' + userId + ')');
      }).then(function(res) {
        if (res && res.error) throw res.error;
        var rows = res.data || [];
        var hasForward = false;
        var hasReverse = false;
        rows.forEach(function(row) {
          if (row.user_id === userId && row.friend_id === friendId) hasForward = true;
          if (row.user_id === friendId && row.friend_id === userId) hasReverse = true;
        });
        if (hasForward && hasReverse) return { alreadyExists: true };
        return Promise.resolve().then(function() {
          if (hasForward) return null;
          return SocialLayer.insertFriendEdge(userId, friendId);
        }).then(function() {
          if (hasReverse) return null;
          return SocialLayer.insertFriendEdge(friendId, userId);
        }).then(function() {
          return { alreadyExists: false };
        });
      });
    },
    removeFriend: function(userId, friendId) {
      return sb(function() {
        return supabase
          .from('friends')
          .delete()
          .or('and(user_id.eq.' + userId + ',friend_id.eq.' + friendId + '),and(user_id.eq.' + friendId + ',friend_id.eq.' + userId + ')');
      });
    },
    listMessages: function() {
      return sb(function() {
        return supabase
          .from('messages')
          .select('id,client_id,user_id,content,created_at')
          .order('created_at', { ascending: false });
      }).then(function(res) {
        if (res && res.error && isMissingMessageColumnError(res.error)) {
          return sb(function() {
            return supabase
              .from('messages')
              .select('id,content,created_at')
              .order('created_at', { ascending: false });
          });
        }
        return res;
      });
    },
    createMessage: function(message) {
      var normalized = normalizeMessage(message, 'pending');
      var payload = {
        client_id: normalized.client_id,
        user_id: normalized.user_id,
        content: normalized.content,
        created_at: normalized.created_at
      };
      return sb(function() {
        return supabase
          .from('messages')
          .insert(payload)
          .select('id,client_id,user_id,content,created_at')
          .single();
      }).then(function(res) {
        if (res && res.error && isMissingMessageColumnError(res.error)) {
          return sb(function() {
            return supabase
              .from('messages')
              .insert({
                content: normalized.content,
                created_at: normalized.created_at
              })
              .select('id,content,created_at')
              .single();
          });
        }
        if (res && res.error && isDuplicateMessageError(res.error) && normalized.client_id) {
          return sb(function() {
            return supabase
              .from('messages')
              .select('id,client_id,user_id,content,created_at')
              .eq('client_id', normalized.client_id)
              .single();
          });
        }
        return res;
      }).then(requireSupabaseSuccess);
    },
    deleteMessage: function(userId, id) {
      return sb(function() { return supabase.from('messages').delete().match({ id: id, user_id: userId }); });
    },
    deleteAnyMessage: function(id) {
      return sb(function() { return supabase.from('messages').delete().match({ id: id }); });
    }
  };

  var AssetLayer = {
    listCards: function(userId) {
      return sb(function() { return supabase.from('cards').select('*').eq('owner_id', userId).order('created_at', { ascending: false }); });
    },
    listWarehouse: function(userId) {
      return sb(function() { return supabase.from('cards').select('*').eq('owner_id', userId).order('created_at', { ascending: false }); });
    },
    listFavorites: function(userId) {
      return sb(function() { return supabase.from('cards').select('*').eq('user_id', userId).eq('is_favorited', true).order('created_at', { ascending: false }); });
    },
    listFavoriteCandidates: function(userId) {
      return sb(function() { return supabase.from('cards').select('id,user_id,name,rarity,image,trade_count,trade_id,is_favorited,created_at').eq('user_id', userId).order('created_at', { ascending: false }); });
    },
    getCardById: function(cardId) {
      return sb(function() { return supabase.from('cards').select('*').eq('id', cardId).limit(1); });
    },
    getCardByTradeId: function(tradeId) {
      return sb(function() { return supabase.from('cards').select('*').eq('trade_id', tradeId).limit(1); });
    },
    recentCards: function(userId) {
      return sb(function() { return supabase.from('cards').select('*').eq('owner_id', userId).order('created_at', { ascending: false }).limit(3); });
    },
    createCard: function(userId, card) {
      return sb(function() {
        return supabase.from('cards').insert({
          user_id: userId,
          owner_id: userId,
          name: card.name,
          rarity: card.rarity,
          image: card.image,
          trade_id: card.trade_id || generateTradeId(),
          trade_count: 0,
          is_favorited: false
        }).select('*').single();
      });
    },
    createCards: function(userId, cards) {
      var rows = cards.map(function(card) {
        return {
          user_id: userId,
          owner_id: userId,
          name: card.name,
          rarity: card.rarity,
          image: card.image,
          trade_id: card.trade_id || generateTradeId(),
          trade_count: 0,
          is_favorited: false
        };
      });
      return sb(function() { return supabase.from('cards').insert(rows).select('*'); });
    },
    deleteCard: function(userId, id) {
      return sb(function() { return supabase.from('cards').delete().match({ id: id, owner_id: userId }); });
    },
    toggleFavorite: function(cardId, userId, isFavorited) {
      return sb(function() {
        return supabase.from('cards').update({
          is_favorited: isFavorited
        }).match({ id: cardId, owner_id: userId }).select('*').single();
      });
    },
    transferCard: function(cardId, ownerId) {
      return sb(function() {
        return supabase.from('cards').update({
          user_id: ownerId,
          owner_id: ownerId,
          trade_count: 1,
          is_favorited: false
        }).eq('id', cardId).select('*').single();
      });
    },
    transferByTradeId: function(tradeId, ownerId) {
      return sb(function() {
        return supabase.from('cards').update({
          user_id: ownerId,
          owner_id: ownerId,
          trade_count: 1,
          is_favorited: false
        }).eq('trade_id', tradeId).lt('trade_count', 1).select('*').single();
      });
    }
  };

  var TradeLayer = {
    createTrade: function(cardId, fromUser, tradeCode) {
      return sb(function() {
        return supabase.from('trades').insert({
          card_id: cardId,
          from_user: fromUser,
          to_user: null,
          trade_code: tradeCode,
          used: false
        }).select('*').single();
      }, 0);
    },
    getByCode: function(tradeCode) {
      return sb(function() {
        return supabase.from('trades').select('*').eq('trade_code', tradeCode).limit(1);
      });
    },
    markUsed: function(tradeId, toUser) {
      return sb(function() {
        return supabase.from('trades').update({
          used: true,
          to_user: toUser
        }).eq('id', tradeId).select('*').single();
      });
    }
  };

  var AVATARS = ['😀','😎','🤩','🥳','😺','🐱','🦊','🐼','🐨','🦁','🐯','🐸','🌟','⚡','🔥','💎'];
  var RARITY_POOL = [
    { rarity: 'SR', weight: 70 },
    { rarity: 'SSR', weight: 22 },
    { rarity: 'XR', weight: 7 },
    { rarity: 'UR', weight: 1 }
  ];
  var CARD_IMAGES = {
    N: '',
    R: '',
    SR: '',
    SSR: '',
    XR: '',
    UR: ''
  };
  var CARD_NAMES = {
    N: ['星星','月亮','花朵','树叶','小溪','微风','白云','小鸟','小鱼','小草','露珠','彩虹','蝴蝶','蜜蜂','蜗牛','蘑菇'],
    R: ['火焰','冰霜','雷电','风暴','陨石','极光','火山','闪电'],
    SR: ['凤凰','麒麟','白龙','金乌','鲲鹏','玄武','青龙','饕餮'],
    SSR: ['混沌','创世','虚空','时空','命运','轮回','星辰','世界'],
    XR: ['星海','天穹','灵辉','秘银','曜石','苍穹','神谕','星轨'],
    UR: ['创世之神','宇宙之心','永恒之光','无限之源','命运编织者','宇宙无敌主宰伊利莎黑']
  };
  var STAR_RATINGS = {
    N: 3,
    R: 3,
    SR: 3,
    SSR: 4,
    XR: 5,
    UR: 6
  };

  function renderAvatarPicker() {
    safeRender(function() {
      var grid = document.getElementById('avatar-grid');
      if (!grid) return;
      grid.innerHTML = '';
      AVATARS.forEach(function(avatar, index) {
        var el = document.createElement('div');
        el.className = 'avatar-option' + (index === 0 ? ' selected' : '');
        el.textContent = avatar;
        el.onclick = function() {
          appState.selectedAvatar = avatar;
          eachNode(grid.querySelectorAll('.avatar-option'), function(option) {
            option.classList.remove('selected');
          });
          el.classList.add('selected');
        };
        grid.appendChild(el);
      });
    }, 'renderAvatarPicker');
  }

  function restoreSession() {
    var userId = localStorage.getItem(SESSION_USER_ID_KEY);
    if (!userId) return Promise.resolve(null);
    return UserCore.getById(userId).then(function(user) {
      if (!user) clearCurrentUser();
      return user;
    }).catch(function(err) {
      console.error('恢复登录失败:', err);
      clearCurrentUser();
      return null;
    });
  }

  function logout() {
    clearCurrentUser();
    sessionStorage.clear();
    showLoginPage();
    showToast('已退出登录');
  }

  function enterApp(user, message) {
    setCurrentUser(user);
    showAppPage('home');
    subscribeMessagesRealtime();
    subscribeFriendsRealtime();
    updateHome();
    showToast(message);
  }

  function login() {
    var nameInput = document.getElementById('login-name');
    if (!nameInput) {
      showToast('登录组件未加载');
      return;
    }
    var name = nameInput.value.trim();
    if (!name) {
      showToast('请输入名字');
      return;
    }
    UserCore.getByName(name).then(function(existingUser) {
      if (existingUser) {
        enterApp(existingUser, '欢迎回来，' + name);
        return null;
      }
      return UserCore.create(name, appState.selectedAvatar).then(function(newUser) {
        enterApp(newUser, '注册成功，你的 ID: ' + newUser.id);
      });
    }).catch(function(err) {
      if (err.message && err.message.indexOf('Unique') !== -1) showToast('昵称已存在，请换一个');
      else {
        console.error('登录失败:', err);
        showToast('登录失败: ' + getErrorMessage(err));
      }
    });
  }

  function updateHome() {
    if (!appState.user) return;
    var userId = requireUserId();
    safeRender(function() {
      setText('me-avatar', appState.user.avatar || '😀');
      setText('me-name', appState.user.name);
      setText('me-id', userId);
      setText('me-signature', getUserSignature(appState.user));
      setText('home-avatar', appState.user.avatar || '😀');
      setText('home-name', appState.user.name);
      setText('home-id', userId);
      setText('home-signature', getUserSignature(appState.user));
      var nameInput = document.getElementById('profile-name-input');
      var signatureInput = document.getElementById('profile-signature-input');
      if (nameInput) nameInput.value = appState.user.name || '';
      if (signatureInput) signatureInput.value = appState.user.signature || '';
      updateAdminStatus();
    }, 'updateHome:profile');

    AssetLayer.listCards(userId).then(function(res) {
      safeRender(function() {
        var total = (res.data || []).length;
        setText('stat-collection', total);
        setText('home-stat-collection', total);
      }, 'updateHome:cards');
    }).catch(function() {
      setText('stat-collection', '0');
      setText('home-stat-collection', '0');
    });

    SocialLayer.listFriends(userId).then(function(res) {
      safeRender(function() {
        var total = (res.data || []).length;
        setText('stat-friends', total);
        setText('home-stat-friends', total);
      }, 'updateHome:friends');
    }).catch(function() {
      setText('stat-friends', '0');
      setText('home-stat-friends', '0');
    });

  }

  function saveProfile() {
    if (!appState.user) {
      showToast('请先登录');
      return;
    }
    var nameInput = document.getElementById('profile-name-input');
    var signatureInput = document.getElementById('profile-signature-input');
    var name = nameInput ? nameInput.value.trim() : '';
    var signature = signatureInput ? signatureInput.value.trim() : '';
    if (!name) {
      showToast('用户名不能为空');
      return;
    }
    if (name.length > 20) {
      showToast('用户名最多20个字');
      return;
    }
    if (signature.length > 80) {
      showToast('个性签名最多80个字');
      return;
    }
    UserCore.updateProfile(requireUserId(), {
      name: name,
      signature: signature
    }).then(function(user) {
      setCurrentUser(user);
      showToast('资料已保存');
      updateHome();
    }).catch(function(err) {
      console.error('保存资料失败:', err);
      var msg = getErrorMessage(err);
      if (msg.indexOf('Unique') !== -1 || msg.indexOf('duplicate') !== -1 || msg.indexOf('23505') !== -1) {
        showToast('用户名已存在，请换一个');
      } else if (msg.indexOf('signature') !== -1 || msg.indexOf('schema cache') !== -1 || msg.indexOf('could not find') !== -1) {
        showToast('请先执行 supabase-migration.sql 增加个性签名字段');
      } else {
        showToast('保存失败: ' + msg);
      }
    });
  }

  function openFriendProfile(friendId) {
    if (!friendId) return;
    appState.profileUserId = friendId;
    openPage('friend-profile', { forceSubPage: true });
  }

  function loadFriendProfile() {
    var friendId = appState.profileUserId;
    if (!friendId) {
      showToast('缺少好友 ID');
      openPage('friends', { forceSubPage: true });
      return;
    }
    UserCore.getById(friendId).then(function(friendUser) {
      if (!friendUser) {
        showToast('好友不存在');
        return;
      }
      safeRender(function() {
        setText('friend-profile-avatar', friendUser.avatar || '😀');
        setText('friend-profile-name', friendUser.name || '');
        setText('friend-profile-id', friendUser.id || '');
        setText('friend-profile-signature', getUserSignature(friendUser));
      }, 'loadFriendProfile:profile');
      AssetLayer.listCards(friendId).then(function(res) {
        setText('friend-profile-stat-collection', (res.data || []).length);
      }).catch(function() {
        setText('friend-profile-stat-collection', '0');
      });
      SocialLayer.listFriends(friendId).then(function(res) {
        setText('friend-profile-stat-friends', (res.data || []).length);
      }).catch(function() {
        setText('friend-profile-stat-friends', '0');
      });
    }).catch(function(err) {
      console.error('加载好友名片失败:', err);
      showToast('加载好友名片失败');
    });
  }

  function setText(id, value) {
    safeRender(function() {
      var el = document.getElementById(id);
      if (el) el.textContent = value;
    }, 'setText:' + id);
  }

  function shouldRenderCardImage(image) {
    if (!image) return false;
    return image.indexOf('/icon-192.png') === -1 && image.indexOf('/icon-512.png') === -1;
  }

  function getStarRating(rarity) {
    return STAR_RATINGS[rarity] || 3;
  }

  function getStarLabel(rarity) {
    var count = getStarRating(rarity);
    var stars = '';
    for (var i = 0; i < count; i += 1) stars += '★';
    return stars;
  }

  function createCardItem(card) {
    var el = document.createElement('div');
    el.className = 'card-item';
    var ownerId = card.owner_id || card.user_id || '';
    var image = card.image || CARD_IMAGES[card.rarity] || '';
    var imageHtml = shouldRenderCardImage(image)
      ? '<img class="card-asset-image" src="' + image + '" alt="' + (card.name || 'card') + '">'
      : '';
    el.innerHTML =
      '<div class="card-visual">' +
        imageHtml +
        '<div class="card-rarity card-stars rarity-' + card.rarity + '" aria-label="' + getStarRating(card.rarity) + '星">' + getStarLabel(card.rarity) + '</div>' +
      '</div>' +
      '<div class="card-asset-info">' +
        '<span class="card-name">' + (card.name || '') + '</span>' +
        '<span class="card-time">' + formatDate(card.created_at) + '</span>' +
        '<div class="card-meta"><span class="card-meta-label">归属</span><span class="card-meta-value">' + ownerId + '</span></div>' +
        '<div class="card-meta"><span class="card-meta-label">trade_id</span><span class="card-meta-value">' + (card.trade_id || '待生成') + '</span></div>' +
        '<div class="card-meta"><span class="card-meta-label">交易</span><span class="card-meta-value">' + Number(card.trade_count || 0) + '</span></div>' +
      '</div>' +
      '<div class="card-actions"></div>';
    return el;
  }

  function generateTradeCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 6; i += 1) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'TRADE-' + code;
  }

  function createTradeCodeForCard(card, attempt) {
    var userId = requireUserId();
    if (card.trade_count >= 1) {
      showToast('已交易卡不能再次交易');
      return;
    }
    if ((card.owner_id || card.user_id) !== userId) {
      showToast('只能交易自己的卡牌');
      return;
    }
    if (!card.trade_id) {
      showToast('这张卡缺少 trade_id，请先更新数据库字段后重新抽卡');
      return;
    }
    showToast('trade_id: ' + card.trade_id);
    if (window.prompt) window.prompt('18位 trade_id，请复制给对方领取', card.trade_id);
  }

  function claimTradeCode() {
    if (!appState.user) {
      showToast('请先登录');
      return;
    }
    var input = document.getElementById('trade-code-input');
    var code = input ? input.value.trim().toUpperCase() : '';
    if (!code) {
      showToast('请输入 trade_id');
      return;
    }
    if (code.length !== 18) {
      showToast('trade_id 必须是18位');
      return;
    }
    var userId = requireUserId();
    AssetLayer.getCardByTradeId(code).then(function(res) {
      var card = res.data && res.data.length ? res.data[0] : null;
      if (!card) {
        showToast('trade_id 不存在');
        return null;
      }
      if (Number(card.trade_count || 0) >= 1) {
        showToast('已失效');
        return null;
      }
      if ((card.owner_id || card.user_id) === userId) {
        showToast('这张卡已经属于你');
        return null;
      }
      return AssetLayer.transferByTradeId(code, userId);
    }).then(function(result) {
      if (!result) return;
      if (input) input.value = '';
      showToast('领取成功');
      loadCollection();
      loadWarehouse();
      updateHome();
    }).catch(function(err) {
      console.error('领取 trade_id 失败:', err);
      showToast('领取失败: ' + getErrorMessage(err));
    });
  }

  function addFriend() {
    var userId;
    try {
      userId = requireUserId();
    } catch (err) {
      showToast(err.message);
      return;
    }
    var input = document.getElementById('friend-id-input');
    var friendId = input.value.trim().toUpperCase();
    if (!friendId) {
      showToast('请输入好友 ID');
      return;
    }
    if (friendId === userId) {
      showToast('不能添加自己');
      return;
    }
    UserCore.getById(friendId).then(function(friendUser) {
      if (!friendUser) {
        showToast('该用户不存在');
        return;
      }
      SocialLayer.addFriend(userId, friendId).then(function(result) {
        showToast(result && result.alreadyExists ? '已是好友了' : '已添加好友: ' + friendUser.name);
        input.value = '';
        loadFriends();
        updateHome();
      }).catch(function(err) {
        if (err.message && (err.message.indexOf('Unique') !== -1 || err.message.indexOf('duplicate') !== -1)) showToast('已是好友了');
        else {
          console.error('添加好友失败:', err);
          showToast('添加失败');
        }
      });
    }).catch(function() {
      showToast('查询失败');
    });
  }

  function loadFriends() {
    if (!appState.user) return;
    var userId = requireUserId();
    SocialLayer.listFriends(userId).then(function(res) {
      var container = document.getElementById('friends-list');
      container.innerHTML = '';
      if (!res.data || !res.data.length) {
        container.innerHTML = '<div class="empty-state"><p>还没有好友，去添加吧！</p></div>';
        return;
      }
      var friendIds = res.data.map(function(friend) { return friend.friend_id; });
      sb(function() { return supabase.from('users').select('*').in('id', friendIds); }).then(function(userRes) {
        var users = userRes.data || [];
        res.data.forEach(function(friend) {
          var friendUser = findUserById(users, friend.friend_id);
          if (!friendUser) return;
          var el = document.createElement('div');
          el.className = 'friend-item';
          el.setAttribute('role', 'button');
          el.setAttribute('tabindex', '0');
          el.innerHTML =
            '<div class="friend-avatar">' + escapeHtml(friendUser.avatar || '😀') + '</div>' +
            '<div class="friend-info">' +
              '<div class="friend-name">' + escapeHtml(friendUser.name) + '</div>' +
              '<div class="friend-id-display">ID: ' + escapeHtml(friendUser.id) + '</div>' +
              '<div class="friend-signature">' + escapeHtml(getUserSignature(friendUser)) + '</div>' +
            '</div>' +
            '<button class="btn-remove btn-danger btn-small" type="button">删除</button>';
          el.onclick = function() {
            openFriendProfile(friend.friend_id);
          };
          el.onkeypress = function(event) {
            event = event || window.event;
            if (event.key === 'Enter' || event.keyCode === 13) openFriendProfile(friend.friend_id);
          };
          el.querySelector('.btn-remove').onclick = function(event) {
            if (event && event.preventDefault) event.preventDefault();
            if (event && event.stopPropagation) event.stopPropagation();
            SocialLayer.removeFriend(userId, friend.friend_id).then(function() {
              showToast('已删除好友');
              loadFriends();
              updateHome();
            }).catch(function(err) {
              console.error('删除好友失败:', err);
              showToast('删除失败');
            });
          };
          container.appendChild(el);
        });
      }).catch(function(err) {
        console.error('加载好友资料失败:', err);
        showToast('加载好友资料失败');
      });
    }).catch(function() {
      showToast('加载好友失败');
    });
  }

  function findUserById(users, userId) {
    for (var i = 0; i < users.length; i += 1) {
      if (users[i].id === userId) return users[i];
    }
    return null;
  }

  function drawCard() {
    var total = 0;
    RARITY_POOL.forEach(function(item) { total += item.weight; });
    var rand = Math.floor(Math.random() * total);
    for (var i = 0; i < RARITY_POOL.length; i += 1) {
      rand -= RARITY_POOL[i].weight;
      if (rand < 0) {
        var rarity = RARITY_POOL[i].rarity;
        return {
          name: CARD_NAMES[rarity][Math.floor(Math.random() * CARD_NAMES[rarity].length)],
          rarity: rarity,
          image: CARD_IMAGES[rarity]
        };
      }
    }
    return { name: CARD_NAMES.SR[0], rarity: 'SR', image: CARD_IMAGES.SR };
  }

  function renderGachaResult(card, userId) {
    return '<div class="result-details">' +
      '<div class="result-name">' + card.name + '</div>' +
      '<div class="result-rarity result-stars rarity-' + card.rarity + '" aria-label="' + getStarRating(card.rarity) + '星">' + getStarLabel(card.rarity) + '</div>' +
      '</div>';
  }

  function getTodayKey() {
    var now = new Date();
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  }

  function getTodayGachaKey(userId) {
    return 'gacha_' + userId + '_' + getTodayKey();
  }

  function getTodayGachaUsed(userId) {
    var used = Number(localStorage.getItem(getTodayGachaKey(userId)) || 0);
    if (!Number.isFinite(used) || used < 0) return 0;
    return Math.min(DAILY_GACHA_LIMIT, used);
  }

  function setTodayGachaUsed(userId, used) {
    var nextUsed = Math.max(0, Math.min(DAILY_GACHA_LIMIT, Number(used || 0)));
    localStorage.setItem(getTodayGachaKey(userId), String(nextUsed));
    return nextUsed;
  }

  function getTodayGachaRemaining(userId) {
    return Math.max(0, DAILY_GACHA_LIMIT - getTodayGachaUsed(userId));
  }

  function renderGachaSlots(remaining) {
    var resultEl = document.getElementById('gacha-result');
    if (!resultEl) return;
    var remain = Math.max(0, Math.min(DAILY_GACHA_LIMIT, Number(remaining || 0)));
    var usedCount = DAILY_GACHA_LIMIT - remain;
    resultEl.classList.remove('flipped');
    resultEl.classList.add('gacha-spread');
    resultEl.innerHTML = '';
    for (var index = 0; index < DAILY_GACHA_LIMIT; index += 1) {
      var isUsed = index < usedCount;
      var slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'gacha-flip-card' + (isUsed ? ' is-used' : '');
      slot.disabled = isUsed;
      slot.setAttribute('aria-label', isUsed ? '今日已抽取' : '点击抽取卡牌');
      slot.innerHTML = '<div class="gacha-flip-inner">' +
        '<div class="gacha-face gacha-back">' +
          '<span>' + (isUsed ? '已抽' : '卡牌') + '</span>' +
          '<small>' + (isUsed ? '今日已使用' : '点击翻开') + '</small>' +
        '</div>' +
        '</div>';
      if (!isUsed) {
        slot.onclick = function() {
          drawGachaSlot(this);
        };
      }
      resultEl.appendChild(slot);
    }
  }

  function renderGachaUI(remaining) {
    if (appState.adminMode) {
      var adminLabel = document.getElementById('gacha-remain');
      if (adminLabel) adminLabel.textContent = '管理员模式: 无限抽卡';
      renderGachaSlots(DAILY_GACHA_LIMIT);
      return;
    }
    var remain = Number(remaining || 0);
    var label = document.getElementById('gacha-remain');
    remain = Math.max(0, Math.min(DAILY_GACHA_LIMIT, remain));
    if (label) label.textContent = remain <= 0 ? '今日已抽完: 0/3' : '今日剩余: ' + remain + '/' + DAILY_GACHA_LIMIT;
    renderGachaSlots(remain);
  }

  function loadGachaRemain() {
    if (!appState.user) {
      renderGachaUI(0);
      return;
    }
    renderGachaUI(getTodayGachaRemaining(requireUserId()));
  }

  function drawGachaSlot(slot) {
    if (appState.isDrawing) return;
    var userId;
    try {
      userId = requireUserId();
    } catch (err) {
      showToast(err.message);
      return;
    }

    var remaining = appState.adminMode ? DAILY_GACHA_LIMIT : getTodayGachaRemaining(userId);
    if (remaining <= 0) {
      showToast('今日次数已用完');
      renderGachaUI(0);
      return;
    }

    appState.isDrawing = true;
    slot.disabled = true;
    slot.classList.add('is-saving');
    slot.querySelector('.gacha-back small').textContent = '抽取中...';

    var card = drawCard();
    if (appState.adminMode) {
      slot.classList.remove('is-saving');
      slot.disabled = false;
      slot.innerHTML = '<div class="gacha-flip-inner">' +
        '<div class="gacha-face gacha-back"><span>卡牌</span><small>测试卡牌</small></div>' +
        '<div class="gacha-face gacha-front">' + renderGachaResult(card, userId) + '</div>' +
        '</div>';
      requestAnimationFrame(function() {
        slot.classList.add('revealed');
      });
      renderGachaStatus(DAILY_GACHA_LIMIT, slot);
      showToast('测试抽卡完成，未计入仓库');
      appState.isDrawing = false;
      return;
    }

    AssetLayer.createCards(userId, [card]).then(function(res) {
      var savedCard = res.data && res.data.length ? res.data[0] : card;
      var used = setTodayGachaUsed(userId, getTodayGachaUsed(userId) + 1);
      var nextRemaining = DAILY_GACHA_LIMIT - used;
      slot.classList.remove('is-saving');
      slot.disabled = true;
      slot.innerHTML = '<div class="gacha-flip-inner">' +
        '<div class="gacha-face gacha-back"><span>卡牌</span><small>已翻开</small></div>' +
        '<div class="gacha-face gacha-front">' + renderGachaResult(savedCard, userId) + '</div>' +
        '</div>';
      requestAnimationFrame(function() {
        slot.classList.add('revealed');
      });
      renderGachaStatus(nextRemaining, slot);
      UserCore.setGachaRemaining(userId, nextRemaining).catch(function(err) {
        console.warn('同步抽卡次数失败:', err);
      });
      showToast('已获得 1 张卡牌');
      updateHome();
      appState.isDrawing = false;
    }).catch(function(err) {
      console.error('抽卡保存失败:', err);
      slot.disabled = false;
      slot.classList.remove('is-saving');
      slot.querySelector('.gacha-back small').textContent = '点击翻开';
      if (isMissingUserError(err)) handleMissingUserSession();
      else showToast('保存失败: ' + getErrorMessage(err));
      appState.isDrawing = false;
    });
  }

  function renderGachaStatus(remaining, activeSlot) {
    if (appState.adminMode) {
      var adminLabel = document.getElementById('gacha-remain');
      if (adminLabel) adminLabel.textContent = '管理员模式: 无限抽卡';
      if (activeSlot) {
        activeSlot.disabled = false;
        activeSlot.setAttribute('aria-label', '管理员无限抽卡，点击继续抽取');
      }
      return;
    }
    var label = document.getElementById('gacha-remain');
    var remain = Math.max(0, Math.min(DAILY_GACHA_LIMIT, Number(remaining || 0)));
    if (label) label.textContent = remain <= 0 ? '今日已抽完: 0/3' : '今日剩余: ' + remain + '/' + DAILY_GACHA_LIMIT;
    if (remain <= 0) {
      eachNode(document.querySelectorAll('.gacha-flip-card:not(.revealed)'), function(slot) {
        if (slot === activeSlot) return;
        slot.disabled = true;
        slot.classList.add('is-used');
        slot.innerHTML = '<div class="gacha-flip-inner">' +
          '<div class="gacha-face gacha-back"><span>已抽</span><small>今日已使用</small></div>' +
          '</div>';
      });
    }
  }

  function loadCollection() {
    if (!appState.user) return;
    var userId = requireUserId();
    console.log('[collection] current user_id:', userId);
    safeQuery(function() {
      return supabase
        .from('cards')
        .select('id,user_id,name,rarity,image,trade_count,trade_id,is_favorited,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
    }, []).then(function(res) {
      console.log('[collection] Supabase raw response:', {
        data: res ? res.data : null,
        error: res ? res.error : null
      });
      var rawCards = res.data || [];
      var favoriteCards = rawCards.filter(function(card) {
        return card && card.user_id === userId && card.is_favorited === true;
      });
      console.log('[collection] Supabase cards result:', res);
      console.log('[collection] filtered favorites:', favoriteCards);
      safeRender(function() {
        var container = document.getElementById('collection-list');
        if (!container) return;
        container.innerHTML = '';
        if (!favoriteCards.length) {
          container.innerHTML = '<div class="empty-state">还没有收藏的卡牌</div>';
          return;
        }
        var rarityOrder = { UR: 0, XR: 1, SSR: 2, SR: 3, R: 4, N: 4 };
        favoriteCards.slice().sort(function(a, b) {
          return (rarityOrder[a.rarity] || 5) - (rarityOrder[b.rarity] || 5);
        }).forEach(function(card) {
          var item = createCardItem(card);
          item.onclick = function(e) {
            if (e.target && e.target.tagName === 'BUTTON') return;
            toggleCardFavorite(card, true);
          };
          var actions = item.querySelector('.card-actions');
          if (actions) actions.appendChild(createFavoriteButton(card, true));
          container.appendChild(item);
        });
      }, 'loadCollection');
    }).catch(function(err) {
      console.error('加载收藏失败:', err);
      console.error('[collection] query failed for user_id:', userId, 'error:', getErrorMessage(err));
      showToast('加载收藏失败');
    });
  }

  function createFavoriteButton(card, reloadCollectionAfterToggle) {
    var button = document.createElement('button');
    button.className = 'card-favorite' + (card.is_favorited ? ' active' : '');
    button.textContent = card.is_favorited ? '已收藏' : '收藏';
    button.onclick = function() {
      toggleCardFavorite(card, reloadCollectionAfterToggle);
    };
    return button;
  }

  function toggleCardFavorite(card, reloadCollectionAfterToggle) {
    var userId = requireUserId();
    var next = !card.is_favorited;
    AssetLayer.toggleFavorite(card.id, userId, next).then(function() {
      card.is_favorited = next;
      showToast(next ? '已收藏' : '已取消收藏');
      if (reloadCollectionAfterToggle) loadCollection();
      else loadWarehouse();
      updateHome();
    }).catch(function(err) {
      console.error('收藏操作失败:', err);
      showToast('收藏操作失败');
    });
  }

  function loadWarehouse() {
    if (!appState.user) return;
    var userId = requireUserId();
    AssetLayer.listWarehouse(userId).then(function(res) {
      var container = document.getElementById('warehouse-list');
      if (!container) return;
      container.innerHTML = '';
      if (!res.data || !res.data.length) {
        container.innerHTML = '<div class="empty-state">仓库还没有卡牌，去抽卡吧！</div>';
        return;
      }
      var rarityOrder = { UR: 0, XR: 1, SSR: 2, SR: 3, R: 4, N: 4 };
      res.data.slice().sort(function(a, b) {
        return (rarityOrder[a.rarity] || 5) - (rarityOrder[b.rarity] || 5);
      }).forEach(function(card) {
        var item = createCardItem(card);
        item.onclick = function(e) {
          if (e.target && e.target.tagName === 'BUTTON') return;
          toggleCardFavorite(card, false);
        };
        var actions = item.querySelector('.card-actions');
        if (actions) actions.appendChild(createFavoriteButton(card, false));
        var tradeButton = document.createElement('button');
        tradeButton.className = 'card-trade';
        tradeButton.textContent = Number(card.trade_count || 0) >= 1 ? '已交易' : '复制 trade_id';
        tradeButton.disabled = Number(card.trade_count || 0) >= 1 || !card.trade_id;
        tradeButton.onclick = function() {
          createTradeCodeForCard(card, 0);
        };
        var del = document.createElement('button');
        del.className = 'card-delete';
        del.textContent = '✕';
        del.title = '删除';
        del.onclick = function() {
          if (!confirm('确定删除 ' + card.name + ' ?')) return;
          AssetLayer.deleteCard(userId, card.id).then(function() {
            showToast('已删除');
            loadWarehouse();
            updateHome();
          }).catch(function(err) {
            console.error('删除卡牌失败:', err);
            showToast('删除失败');
          });
        };
        if (actions) {
          actions.appendChild(tradeButton);
          actions.appendChild(del);
        }
        container.appendChild(item);
      });
    }).catch(function(err) {
      console.error('加载仓库失败:', err);
      showToast('加载仓库失败');
    });
  }

  function renderMessages(messages) {
    var container = document.getElementById('messages');
    if (!container) return;
    container.innerHTML = '';
    if (!messages.length) {
      container.innerHTML = '<div class="empty-state">还没有留言</div>';
      return;
    }
    messages.forEach(function(message) {
      var row = document.createElement('div');
      row.className = 'msg-row';
      var span = document.createElement('span');
      span.className = 'msg-content';
      var syncText = message.sync_status === 'pending' ? ' · 待同步' : '';
      span.textContent = (message.content || '') + '  [' + formatDate(message.created_at) + syncText + ']';
      row.appendChild(span);
      if (appState.adminMode && message.id != null) {
        var button = document.createElement('button');
        button.className = 'delete-btn';
        button.title = '删除';
        button.textContent = '删除';
        button.onclick = function() { deleteMessage(message.id); };
        row.appendChild(button);
      }
      container.appendChild(row);
    });
  }

  function loadMessages() {
    if (!appState.user) return;
    if (!supabase || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      renderMessages([]);
      showToast('无法连接留言服务');
      return;
    }
    SocialLayer.listMessages().then(function(res) {
      if (res && res.error) throw res.error;
      renderMessages((res.data || []).map(function(message) {
        return normalizeMessage(message, 'synced');
      }));
    }).catch(function(err) {
      console.error('加载云端留言失败:', err);
      showToast('加载留言失败');
    });
  }

  function isMessagePageActive() {
    return !!(Router && Router.current === 'message');
  }

  function isFriendsPageActive() {
    return !!(Router && Router.current === 'friends');
  }

  function subscribeMessagesRealtime() {
    if (!supabase || messagesRealtimeChannel) return;
    if (typeof supabase.channel !== 'function') return;
    messagesRealtimeChannel = supabase
      .channel('public:messages')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages'
      }, function() {
        if (isMessagePageActive()) loadMessages();
      })
      .subscribe(function(status) {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('messages realtime subscription status:', status);
        }
      });
  }

  function isFriendChangeForCurrentUser(payload) {
    var userId = appState.user && appState.user.id;
    if (!userId || !payload) return false;
    var nextRow = payload.new || {};
    var oldRow = payload.old || {};
    if (payload.eventType === 'DELETE' && !oldRow.user_id && !oldRow.friend_id) return true;
    return nextRow.user_id === userId ||
      nextRow.friend_id === userId ||
      oldRow.user_id === userId ||
      oldRow.friend_id === userId;
  }

  function subscribeFriendsRealtime() {
    if (!supabase || friendsRealtimeChannel) return;
    if (typeof supabase.channel !== 'function') return;
    friendsRealtimeChannel = supabase
      .channel('public:friends')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'friends'
      }, function(payload) {
        if (!isFriendChangeForCurrentUser(payload)) return;
        updateHome();
        if (isFriendsPageActive()) loadFriends();
      })
      .subscribe(function(status) {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('friends realtime subscription status:', status);
        }
      });
  }

  function sendMessage() {
    var userId;
    try {
      userId = requireUserId();
    } catch (err) {
      showToast(err.message);
      return;
    }
    var input = document.getElementById('userInput');
    var text = input.value.trim();
    if (!text) return;
    var message = normalizeMessage({
      client_id: generateClientMessageId(),
      user_id: userId,
      content: text,
      created_at: new Date().toISOString()
    }, 'pending');
    input.value = '';
    SocialLayer.createMessage(message).then(function() {
      if (isMessagePageActive()) loadMessages();
    }).catch(function(err) {
      console.error('发送留言失败:', err);
      showToast('发送失败');
    });
  }

  function sendMood(mood) {
    var userId;
    try {
      userId = requireUserId();
    } catch (err) {
      showToast(err.message);
      return;
    }
    var message = normalizeMessage({
      client_id: generateClientMessageId(),
      user_id: userId,
      content: '今天的心情：' + mood,
      created_at: new Date().toISOString()
    }, 'pending');
    SocialLayer.createMessage(message).then(function() {
      if (isMessagePageActive()) loadMessages();
    }).catch(function(err) {
      console.error('发送心情失败:', err);
      showToast('发送失败');
    });
  }

  function deleteMessage(id) {
    if (!appState.user) return;
    if (!appState.adminMode) {
      showToast('只有管理员可以删除留言');
      return;
    }
    SocialLayer.deleteAnyMessage(id).then(function() {
      loadMessages();
    }).catch(function(err) {
      console.error('删除留言失败:', err);
      showToast('删除失败');
    });
  }

  function loadPageData(page) {
    if (page === 'home') updateHome();
    if (page === 'me') updateHome();
    if (page === 'pursuit') updateAdminStatus();
    if (page === 'friends') loadFriends();
    if (page === 'friend-profile') loadFriendProfile();
    if (page === 'collection') loadCollection();
    if (page === 'warehouse') loadWarehouse();
    if (page === 'gacha') loadGachaRemain();
    if (page === 'message') loadMessages();
  }

  function openPage(page, options) {
    options = options || {};
    if (!Router) initRouter();
    if (options.skipHistory === true) {
      Router.current = page;
      render();
    } else if (options.forceSubPage === true) {
      Router.push(page);
    } else if (isTopLevelPage(page) || page === 'login') {
      Router.replace(page);
    } else {
      Router.push(page);
    }
    loadPageData(page);
  }

  function enableAdminMode() {
    var input = document.getElementById('admin-password-input');
    var value = input ? input.value : '';
    if (value !== ADMIN_PASSWORD) {
      showToast('管理员密码错误');
      return;
    }
    appState.adminMode = true;
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    if (input) input.value = '';
    showToast('ADMIN_MODE 已开启');
    render();
    updateAdminStatus();
    loadGachaRemain();
    if (isMessagePageActive()) loadMessages();
  }

  function disableAdminMode() {
    appState.adminMode = false;
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    showToast('ADMIN_MODE 已关闭');
    render();
    updateAdminStatus();
    loadGachaRemain();
    if (isMessagePageActive()) loadMessages();
  }

  function updateAdminStatus() {
    var status = document.getElementById('admin-status');
    if (status) status.textContent = 'ADMIN_MODE: ' + (appState.adminMode ? 'ON' : 'OFF');
    var debugPanel = document.getElementById('debug-panel');
    if (debugPanel) {
      debugPanel.innerHTML = appState.adminMode ? renderDebugPanel() : '';
    }
  }

  function renderDebugPanel() {
    var userId = appState.user && appState.user.id ? appState.user.id : '-';
    return '<div>debug panel</div>' +
      '<div>user_id: ' + userId + '</div>' +
      '<div>adminMode: ' + String(appState.adminMode) + '</div>' +
      '<div>gacha_remaining: ' + (appState.user && appState.user.gacha_remaining != null ? appState.user.gacha_remaining : '-') + '</div>';
  }

  function bindClick(id, handler) {
    safeRender(function() {
      var el = document.getElementById(id);
      if (el) el.onclick = handler;
    }, 'bindClick:' + id);
  }

  function bindEnter(id, handler) {
    safeRender(function() {
      var el = document.getElementById(id);
      if (el) {
        el.onkeypress = function(e) {
          e = e || window.event;
          if (e.key === 'Enter' || e.keyCode === 13) handler();
        };
      }
    }, 'bindEnter:' + id);
  }

  function handleHistoryPageChange(event) {
    var state = event.state || {};
    var page = state.page;
    if (!page) {
      page = appState.user ? 'home' : 'login';
    }
    if (!Router) initRouter();
    Router.restore(page, state.stack);
    loadPageData(page);
  }

  function bindBackNavigation() {
    if (!Router) initRouter();
    window.addEventListener('popstate', handleHistoryPageChange);
  }

  function bindSwipeBack() {
    document.addEventListener('touchstart', function(event) {
      if (!Router || Router.stack.length <= 0 || !event.touches || event.touches.length !== 1) {
        swipeBackState = null;
        return;
      }
      var touch = event.touches[0];
      if (touch.clientX > SWIPE_BACK_EDGE) {
        swipeBackState = null;
        return;
      }
      swipeBackState = {
        startX: touch.clientX,
        startY: touch.clientY,
        deltaX: 0,
        deltaY: 0,
        tracking: true
      };
    }, { passive: true });

    document.addEventListener('touchmove', function(event) {
      if (!swipeBackState || !swipeBackState.tracking || !event.touches || event.touches.length !== 1) return;
      var touch = event.touches[0];
      swipeBackState.deltaX = touch.clientX - swipeBackState.startX;
      swipeBackState.deltaY = touch.clientY - swipeBackState.startY;
      if (swipeBackState.deltaX > 12 && Math.abs(swipeBackState.deltaY) < 40 && event.cancelable) {
        event.preventDefault();
      }
    }, { passive: false });

    document.addEventListener('touchend', function() {
      if (!swipeBackState || !swipeBackState.tracking) return;
      var shouldBack = swipeBackState.deltaX >= SWIPE_BACK_THRESHOLD &&
        Math.abs(swipeBackState.deltaY) <= 60;
      swipeBackState = null;
      if (shouldBack && Router && Router.stack.length > 0) {
        Router.pop();
      }
    }, { passive: true });

    document.addEventListener('touchcancel', function() {
      swipeBackState = null;
    }, { passive: true });
  }

  function bindRenderedEvents() {
    safeRender(function() {
      renderAvatarPicker();
      bindClick('btn-login', login);
      bindEnter('login-name', login);
      bindClick('btn-save-profile', saveProfile);
      bindClick('btn-add-friend', addFriend);
      bindEnter('friend-id-input', addFriend);
      bindClick('btn-show-admin', function() {
        appState.adminPanelOpen = !appState.adminPanelOpen;
        render();
        updateAdminStatus();
      });
      bindClick('btn-admin-login', enableAdminMode);
      bindEnter('admin-password-input', enableAdminMode);
      bindClick('btn-admin-logout', disableAdminMode);
      bindClick('btn-claim-trade', claimTradeCode);
      bindEnter('trade-code-input', claimTradeCode);
      bindClick('user-avatar-button', function() {
        openPage('me', { forceSubPage: true });
      });
      bindClick('myBtn', function() {
        appState.messageComposeOpen = true;
        render();
        loadMessages();
      });
      bindClick('sendBtn', sendMessage);
      bindEnter('userInput', sendMessage);
      eachNode(document.querySelectorAll('.mood-btn'), function(button) {
        button.onclick = function() {
          sendMood(button.getAttribute('data-mood'));
        };
      });
      eachNode(document.querySelectorAll('[data-open-page]'), function(button) {
        button.onclick = function() {
          openPage(button.getAttribute('data-open-page'), { forceSubPage: true });
        };
      });
      eachNode(document.querySelectorAll('.nav-item'), function(button) {
        button.onclick = function() {
          var page = button.getAttribute('data-page');
          openPage(page);
        };
      });
      if (Router && Router.current === 'pursuit') updateAdminStatus();
    }, 'bindRenderedEvents');
  }

  function bindEvents() {
    safeRender(function() {
      bindBackNavigation();
      bindSwipeBack();
      window.addEventListener('online', function() {
        if (isMessagePageActive()) loadMessages();
        if (isFriendsPageActive()) loadFriends();
      });
    }, 'bindEvents');
  }

  function initApp() {
    try {
      hideLoading();
      if (!Router) initRouter();
      Router.current = appState.user ? 'home' : 'login';
      Router.stack = [];
      render();
      bindEvents();
      registerServiceWorker();
      restoreSession().then(function(user) {
        if (user) enterApp(user, '欢迎回来，' + user.name);
        else showLoginPage();
      }).catch(function(err) {
        console.error('初始化登录状态失败:', err);
        clearCurrentUser();
        showLoginPage();
      });
    } catch (err) {
      console.error('初始化失败:', err);
      recoverFromFatalError();
    }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function(err) {
        console.error('Service worker registration failed:', err);
      });
    });
  }

  function startAppWhenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function onReady() {
        document.removeEventListener('DOMContentLoaded', onReady);
        initApp();
      });
      return;
    }
    initApp();
  }

  window.addEventListener('load', function() {
    var container = document.getElementById('app');
    if (container && !container.innerHTML.trim()) {
      if (!Router) initRouter();
      if (!Router.current) Router.current = 'home';
      render();
    }
  });

  startAppWhenReady();
})();
