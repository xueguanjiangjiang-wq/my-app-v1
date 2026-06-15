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
  var ADMIN_PASSWORD = 'xxx';
  var DAILY_GACHA_LIMIT = 3;
  var SESSION_USER_ID_KEY = 'cardapp_current_user_id';
  var SUPABASE_RETRY_LIMIT = 2;
  var TOP_LEVEL_PAGES = {
    home: true,
    gacha: true,
    message: true,
    pursuit: true
  };
  var SWIPE_BACK_EDGE = 32;
  var SWIPE_BACK_THRESHOLD = 80;

  var appState = {
    user: null,
    selectedAvatar: '😀',
    isDrawing: false,
    adminMode: false,
    currentPage: 'login'
  };
  var messagesRealtimeChannel = null;
  var swipeBackState = null;
  var lastBackTouchTime = 0;
  var Router = null;

  function recoverFromFatalError() {
    var run = function() {
      safeRender(function() {
        hideLoading();
        var hasActivePage = document.querySelector('.page.active');
        if (!hasActivePage) showLoginPage();
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

  function isSubPage(name) {
    return !!(Router && Router.stack.length > 0);
  }

  function syncHistoryState(name, mode) {
    if (!window.history || !window.history.pushState) return;
    var state = {
      page: name,
      stack: Router ? Router.stack.slice() : [],
      isSubPage: !!(Router && Router.stack.length > 0)
    };
    var url = '#/' + name;
    if (mode === 'push') window.history.pushState(state, '', url);
    else window.history.replaceState(state, '', url);
  }

  function clearAndBindBackButton() {
    var back = document.querySelector('.back');
    if (!back || !back.parentNode) return;

    var freshBack = back.cloneNode(true);
    back.parentNode.replaceChild(freshBack, back);

    freshBack.onclick = Router.pop;
    freshBack.ontouchend = Router.pop;
  }

  function render() {
    safeRender(function() {
      var name = Router ? Router.current : appState.currentPage;
      var target = document.getElementById('page-' + name);
      if (!target) name = appState.user ? 'home' : 'login';

      eachNode(document.querySelectorAll('.page'), function(page) {
        page.classList.remove('active');
      });

      target = document.getElementById('page-' + name);
      if (target) target.classList.add('active');
      appState.currentPage = name;

      var isSubPageState = isSubPage(name);
      var nav = document.getElementById('bottom-nav');
      var back = document.querySelector('.back');

      if (document.body) document.body.classList.toggle('is-sub-page', isSubPageState);
      if (nav) nav.style.display = name !== 'login' && !isSubPageState ? 'flex' : 'none';
      if (back) back.style.display = isSubPageState ? 'inline-flex' : 'none';

      eachNode(document.querySelectorAll('.nav-item'), function(button) {
        button.classList.toggle('active', button.getAttribute('data-page') === name);
      });

      clearAndBindBackButton();
    }, 'render');
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
        if (this.current && this.current !== 'login') this.stack.push(this.current);
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

  function setNavigationChrome(name) {
    var nav = document.getElementById('bottom-nav');
    var back = document.getElementById('page-back');
    var subPage = isSubPage(name);
    if (document.body) document.body.classList.toggle('is-sub-page', subPage);
    if (nav) nav.style.display = name !== 'login' && !subPage ? 'flex' : 'none';
    if (back) back.style.display = subPage ? 'inline-flex' : 'none';
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
      var loginPage = document.getElementById('page-login');
      if (loginPage) loginPage.classList.remove('active');
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
    }
  };

  var SocialLayer = {
    listFriends: function(userId) {
      return sb(function() { return supabase.from('friends').select('*').eq('user_id', userId); });
    },
    addFriend: function(userId, friendId) {
      return sb(function() { return supabase.from('friends').insert({ user_id: userId, friend_id: friendId }); });
    },
    removeFriend: function(userId, friendId) {
      return sb(function() { return supabase.from('friends').delete().match({ user_id: userId, friend_id: friendId }); });
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
    { rarity: 'N', weight: 60 },
    { rarity: 'R', weight: 25 },
    { rarity: 'SR', weight: 10 },
    { rarity: 'SSR', weight: 4 },
    { rarity: 'UR', weight: 1 }
  ];
  var CARD_IMAGES = {
    N: '/icon-192.png',
    R: '/icon-192.png',
    SR: '/icon-192.png',
    SSR: '/icon-512.png',
    UR: '/icon-512.png'
  };
  var CARD_NAMES = {
    N: ['星星','月亮','花朵','树叶','小溪','微风','白云','小鸟','小鱼','小草','露珠','彩虹','蝴蝶','蜜蜂','蜗牛','蘑菇'],
    R: ['火焰','冰霜','雷电','风暴','陨石','极光','火山','闪电'],
    SR: ['凤凰','麒麟','白龙','金乌','鲲鹏','玄武','青龙','饕餮'],
    SSR: ['混沌','创世','虚空','时空','命运','轮回','星辰','世界'],
    UR: ['创世之神','宇宙之心','永恒之光','无限之源','命运编织者']
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
      updateAdminStatus();
    }, 'updateHome:profile');

    AssetLayer.listCards(userId).then(function(res) {
      safeRender(function() {
        setText('stat-collection', (res.data || []).length);
      }, 'updateHome:cards');
    }).catch(function() {
      setText('stat-collection', '0');
    });

    SocialLayer.listFriends(userId).then(function(res) {
      safeRender(function() {
        setText('stat-friends', (res.data || []).length);
      }, 'updateHome:friends');
    }).catch(function() {
      setText('stat-friends', '0');
    });

    AssetLayer.recentCards(userId).then(function(res) {
      safeRender(function() {
        var container = document.getElementById('home-recent-cards');
        if (!container) return;
        container.innerHTML = '';
        if (!res.data || !res.data.length) {
          container.innerHTML = '<div class="empty-state">还没有收藏，去抽卡吧！</div>';
          return;
        }
        res.data.forEach(function(card) {
          container.appendChild(createCardItem(card));
        });
      }, 'updateHome:recentCards');
    }).catch(function() {
      safeRender(function() {
        var container = document.getElementById('home-recent-cards');
        if (container) container.innerHTML = '<div class="empty-state">加载失败</div>';
      }, 'updateHome:recentCardsError');
    });
  }

  function setText(id, value) {
    safeRender(function() {
      var el = document.getElementById(id);
      if (el) el.textContent = value;
    }, 'setText:' + id);
  }

  function createCardItem(card) {
    var el = document.createElement('div');
    el.className = 'card-item';
    var ownerId = card.owner_id || card.user_id || '';
    var image = card.image || CARD_IMAGES[card.rarity] || '/icon-192.png';
    el.innerHTML =
      '<img class="card-asset-image" src="' + image + '" alt="' + (card.name || 'card') + '">' +
      '<div class="card-rarity rarity-' + card.rarity + '">' + card.rarity + '</div>' +
      '<div class="card-asset-info">' +
      '<span class="card-name">' + (card.name || '') + '</span>' +
      '<span class="card-owner">归属: ' + ownerId + '</span>' +
      '<span class="card-owner">trade_id: ' + (card.trade_id || '待生成') + '</span>' +
      '<span class="card-trade-count">交易: ' + Number(card.trade_count || 0) + '</span>' +
      '</div>' +
      '<span class="card-time">' + formatDate(card.created_at) + '</span>';
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
      SocialLayer.addFriend(userId, friendId).then(function() {
        showToast('已添加好友: ' + friendUser.name);
        input.value = '';
        loadFriends();
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
          el.innerHTML = '<div class="friend-avatar">' + (friendUser.avatar || '😀') + '</div><div class="friend-info"><div class="friend-name">' + friendUser.name + '</div><div class="friend-id-display">ID: ' + friendUser.id + '</div></div><button class="btn-remove btn-danger btn-small">删除</button>';
          el.querySelector('.btn-remove').onclick = function() {
            SocialLayer.removeFriend(userId, friend.friend_id).then(function() {
              showToast('已删除好友');
              loadFriends();
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
    return { name: CARD_NAMES.N[0], rarity: 'N', image: CARD_IMAGES.N };
  }

  function renderGachaResult(card, userId) {
    var ownerId = card.owner_id || card.user_id || userId;
    var image = card.image || CARD_IMAGES[card.rarity] || '/icon-192.png';
    return '<div class="result-details">' +
      '<img class="card-asset-image card-asset-image-large" src="' + image + '" alt="' + card.name + '">' +
      '<div class="card-rarity rarity-' + card.rarity + '" style="width:50px;height:50px;font-size:16px;border-radius:12px;margin-bottom:10px;">' + card.rarity + '</div>' +
      '<div class="result-name">' + card.name + '</div>' +
      '<div class="result-rarity rarity-' + card.rarity + '" style="padding:4px 12px;border-radius:8px;">' + card.rarity + ' 稀有</div>' +
      '<div class="card-owner">归属: ' + ownerId + '</div>' +
      '<div class="card-trade-count">trade_id: ' + (card.trade_id || '保存后生成') + '</div>' +
      '<div class="card-trade-count">交易: ' + Number(card.trade_count || 0) + '</div>' +
      '</div>';
  }

  function renderGachaBacks(cards, userId, onAllFlipped) {
    var resultEl = document.getElementById('gacha-result');
    var flippedCount = 0;
    resultEl.classList.remove('flipped');
    resultEl.classList.add('gacha-spread');
    resultEl.innerHTML = '';
    cards.forEach(function(card, index) {
      var slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'gacha-flip-card';
      slot.innerHTML =
        '<div class="gacha-flip-inner">' +
        '<div class="gacha-face gacha-back"><span>卡牌</span><small>点击翻开</small></div>' +
        '<div class="gacha-face gacha-front">' + renderGachaResult(card, userId) + '</div>' +
        '</div>';
      slot.onclick = function() {
        if (slot.classList.contains('revealed')) return;
        slot.classList.add('revealed');
        flippedCount += 1;
        if (flippedCount === cards.length) onAllFlipped();
      };
      resultEl.appendChild(slot);
    });
  }

  function renderGachaUI(remaining) {
    var remain = Number(remaining || 0);
    var label = document.getElementById('gacha-remain');
    var button = document.getElementById('btn-gacha');
    if (appState.adminMode) {
      if (label) label.textContent = '管理员模式：无限抽卡';
      if (button) {
        button.disabled = false;
        button.textContent = '开始抽卡！（管理员无限）';
      }
      return;
    }
    if (label) label.textContent = '剩余次数: ' + remain + '/' + DAILY_GACHA_LIMIT;
    if (button) {
      button.disabled = remain <= 0;
      button.textContent = remain <= 0 ? '次数已耗尽' : '开始抽卡！（剩余 ' + remain + ' 次）';
    }
  }

  function loadGachaRemain() {
    if (!appState.user) {
      renderGachaUI(0);
      return;
    }
    if (appState.adminMode) {
      renderGachaUI(DAILY_GACHA_LIMIT);
      return;
    }
    UserCore.getGachaRemaining(requireUserId()).then(renderGachaUI).catch(function(err) {
      console.error('加载抽卡次数失败:', err);
      renderGachaUI(0);
      showToast('加载次数失败');
    });
  }

  function runGacha() {
    if (appState.isDrawing) return;
    var userId;
    try {
      userId = requireUserId();
    } catch (err) {
      showToast(err.message);
      return;
    }

    var remainingRequest = appState.adminMode ? Promise.resolve(DAILY_GACHA_LIMIT) : UserCore.getGachaRemaining(userId);
    remainingRequest.then(function(remaining) {
      if (remaining <= 0) {
        showToast('次数已耗尽');
        renderGachaUI(0);
        return;
      }

      var nextRemaining = Math.max(0, remaining - 1);
      var resultEl = document.getElementById('gacha-result');
      var cards = [drawCard(), drawCard(), drawCard()];
      var cardsSaved = false;
      appState.isDrawing = true;

      renderGachaBacks(cards, userId, function() {
        AssetLayer.createCards(userId, cards).then(function(res) {
          cardsSaved = true;
          cards = res.data && res.data.length ? res.data : cards;
          renderGachaBacks(cards, userId, function() {});
          eachNode(document.querySelectorAll('.gacha-flip-card'), function(slot) {
            slot.classList.add('revealed');
            slot.disabled = true;
          });
          if (appState.adminMode) return Promise.resolve(remaining);
          return UserCore.setGachaRemaining(userId, nextRemaining);
        }).then(function(savedRemaining) {
          renderGachaUI(savedRemaining);
          showToast('已获得 3 张卡牌');
          updateHome();
          appState.isDrawing = false;
        }).catch(function(err) {
          console.error('抽卡保存失败:', err);
          loadGachaRemain();
          if (isMissingUserError(err)) {
            handleMissingUserSession();
            appState.isDrawing = false;
            return;
          }
          if (cardsSaved) {
            updateHome();
            showToast('卡牌已保存，但次数扣减失败: ' + getErrorMessage(err));
          } else {
            showToast('保存失败: ' + getErrorMessage(err));
          }
          appState.isDrawing = false;
        });
      });
    }).catch(function(err) {
      console.error('抽卡失败:', err);
      showToast('抽卡失败: ' + getErrorMessage(err));
      appState.isDrawing = false;
    });
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
        var rarityOrder = { UR: 0, SSR: 1, SR: 2, R: 3, N: 4 };
        favoriteCards.slice().sort(function(a, b) {
          return (rarityOrder[a.rarity] || 5) - (rarityOrder[b.rarity] || 5);
        }).forEach(function(card) {
          var item = createCardItem(card);
          item.onclick = function(e) {
            if (e.target && e.target.tagName === 'BUTTON') return;
            toggleCardFavorite(card, true);
          };
          item.appendChild(createFavoriteButton(card, true));
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
      var rarityOrder = { UR: 0, SSR: 1, SR: 2, R: 3, N: 4 };
      res.data.slice().sort(function(a, b) {
        return (rarityOrder[a.rarity] || 5) - (rarityOrder[b.rarity] || 5);
      }).forEach(function(card) {
        var item = createCardItem(card);
        item.onclick = function(e) {
          if (e.target && e.target.tagName === 'BUTTON') return;
          toggleCardFavorite(card, false);
        };
        item.appendChild(createFavoriteButton(card, false));
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
        item.appendChild(tradeButton);
        item.appendChild(del);
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
    var page = document.getElementById('page-message');
    return !!(page && page.classList.contains('active'));
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
    if (input) input.value = '';
    showToast('ADMIN_MODE 已开启');
    updateAdminStatus();
    loadGachaRemain();
    if (document.getElementById('page-message').classList.contains('active')) loadMessages();
  }

  function updateAdminStatus() {
    var status = document.getElementById('admin-status');
    if (status) status.textContent = 'ADMIN_MODE: ' + (appState.adminMode ? 'ON' : 'OFF');
    var debugPanel = document.getElementById('debug-panel');
    if (debugPanel) {
      debugPanel.style.display = appState.adminMode ? 'block' : 'none';
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
    if (!page || !document.getElementById('page-' + page)) {
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
      if (!isSubPage(appState.currentPage) || !event.touches || event.touches.length !== 1) {
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
      if (shouldBack && isSubPage(appState.currentPage)) {
        Router.pop();
      }
    }, { passive: true });

    document.addEventListener('touchcancel', function() {
      swipeBackState = null;
    }, { passive: true });
  }

  function bindEvents() {
    safeRender(function() {
      bindClick('btn-login', login);
      bindEnter('login-name', login);
      bindClick('btn-add-friend', addFriend);
      bindEnter('friend-id-input', addFriend);
      bindClick('btn-gacha', runGacha);
      bindClick('btn-show-admin', function() {
        var panel = document.getElementById('admin-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        updateAdminStatus();
      });
      bindClick('btn-admin-login', enableAdminMode);
      bindEnter('admin-password-input', enableAdminMode);
      bindClick('btn-claim-trade', claimTradeCode);
      bindEnter('trade-code-input', claimTradeCode);
      bindClick('myBtn', function() {
        var myBtn = document.getElementById('myBtn');
        var inputArea = document.getElementById('inputArea');
        var moodArea = document.getElementById('moodArea');
        if (myBtn) myBtn.style.display = 'none';
        if (inputArea) inputArea.style.display = 'flex';
        if (moodArea) moodArea.style.display = 'flex';
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
          openPage(button.getAttribute('data-open-page'));
        };
      });
      eachNode(document.querySelectorAll('.nav-item'), function(button) {
        button.onclick = function() {
          var page = button.getAttribute('data-page');
          openPage(page);
        };
      });
      bindBackNavigation();
      bindSwipeBack();
      window.addEventListener('online', function() {
        if (isMessagePageActive()) loadMessages();
      });
    }, 'bindEvents');
  }

  function initApp() {
    try {
      hideLoading();
      renderAvatarPicker();
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

  startAppWhenReady();
})();

