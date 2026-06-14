// ============================================================
// 蒋的APP - 三层数据结构重构
// User Core / Social Layer / Asset Layer
// ============================================================

(function() {
  'use strict';

  const SUPABASE_URL = 'https://rzrachgwnmkbeafhktse.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_lzY69nQuBXB05sufZI5cAg_U_5xBhsf';
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const DAILY_GACHA_LIMIT = 3;
  const SESSION_USER_ID_KEY = 'cardapp_current_user_id';

  const appState = {
    user: null,
    selectedAvatar: '😀',
    isDrawing: false
  };

  function sb(promise) {
    return new Promise(function(resolve, reject) {
      promise.then(function(res) {
        if (res.error) reject(res.error);
        else resolve(res);
      }).catch(reject);
    });
  }

  function requireUserId() {
    if (!appState.user || !appState.user.id) throw new Error('请先登录');
    return appState.user.id;
  }

  function getErrorMessage(err) {
    if (!err) return '未知错误';
    return err.message || err.details || err.hint || String(err);
  }

  function isMissingUserError(err) {
    const msg = getErrorMessage(err);
    return msg.indexOf('cards_user_id_fkey') !== -1 || msg.indexOf('foreign key constraint') !== -1;
  }

  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2100);
  }

  function generateUserId() {
    return 'U' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0') + ' ' +
      String(dt.getHours()).padStart(2, '0') + ':' +
      String(dt.getMinutes()).padStart(2, '0');
  }

  function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  function showPage(name) {
    document.querySelectorAll('.page').forEach(function(page) {
      page.classList.remove('active');
    });
    const target = document.getElementById('page-' + name);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function(button) {
      button.classList.toggle('active', button.getAttribute('data-page') === name);
    });
  }

  function showLoginPage() {
    const nav = document.getElementById('bottom-nav');
    if (nav) nav.style.display = 'none';
    showPage('login');
  }

  function showAppPage(name) {
    const nav = document.getElementById('bottom-nav');
    if (nav) nav.style.display = 'flex';
    document.getElementById('page-login').classList.remove('active');
    showPage(name);
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

  const UserCore = {
    getById: function(userId) {
      return sb(supabase.from('users').select('*').eq('id', userId).limit(1)).then(function(res) {
        return res.data && res.data.length ? res.data[0] : null;
      });
    },
    getByName: function(name) {
      return sb(supabase.from('users').select('*').eq('name', name).limit(1)).then(function(res) {
        return res.data && res.data.length ? res.data[0] : null;
      });
    },
    create: function(name, avatar) {
      return sb(supabase.from('users').insert({
        id: generateUserId(),
        name: name,
        avatar: avatar,
        gacha_remaining: DAILY_GACHA_LIMIT
      }).select('*').single()).then(function(res) {
        return res.data;
      });
    },
    getGachaRemaining: function(userId) {
      return sb(supabase.from('users').select('gacha_remaining').eq('id', userId).single()).then(function(res) {
        return res.data.gacha_remaining;
      });
    },
    setGachaRemaining: function(userId, nextRemaining) {
      return sb(supabase.from('users').update({
        gacha_remaining: nextRemaining
      }).eq('id', userId).select('*').single()).then(function(res) {
        appState.user = res.data;
        return res.data.gacha_remaining;
      });
    }
  };

  const SocialLayer = {
    listFriends: function(userId) {
      return sb(supabase.from('friends').select('*').eq('user_id', userId));
    },
    addFriend: function(userId, friendId) {
      return sb(supabase.from('friends').insert({ user_id: userId, friend_id: friendId }));
    },
    removeFriend: function(userId, friendId) {
      return sb(supabase.from('friends').delete().match({ user_id: userId, friend_id: friendId }));
    },
    listMessages: function(userId) {
      return sb(supabase.from('messages').select('*').eq('user_id', userId).order('created_at', { ascending: true }));
    },
    createMessage: function(userId, type, content) {
      return sb(supabase.from('messages').insert({ type: type, content: content, user_id: userId }));
    },
    deleteMessage: function(userId, id) {
      return sb(supabase.from('messages').delete().match({ id: id, user_id: userId }));
    }
  };

  const AssetLayer = {
    listCards: function(userId) {
      return sb(supabase.from('cards').select('*').eq('user_id', userId).order('created_at', { ascending: false }));
    },
    recentCards: function(userId) {
      return sb(supabase.from('cards').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(3));
    },
    createCard: function(userId, card) {
      return sb(supabase.from('cards').insert({ user_id: userId, name: card.name, rarity: card.rarity, image: null }));
    },
    deleteCard: function(userId, id) {
      return sb(supabase.from('cards').delete().match({ id: id, user_id: userId }));
    }
  };

  const AVATARS = ['😀','😎','🤩','🥳','😺','🐱','🦊','🐼','🐨','🦁','🐯','🐸','🌟','⚡','🔥','💎'];
  const RARITY_POOL = [
    { rarity: 'N', weight: 50 },
    { rarity: 'R', weight: 30 },
    { rarity: 'SR', weight: 14 },
    { rarity: 'SSR', weight: 5 },
    { rarity: 'UR', weight: 1 }
  ];
  const CARD_NAMES = {
    N: ['星星','月亮','花朵','树叶','小溪','微风','白云','小鸟','小鱼','小草','露珠','彩虹','蝴蝶','蜜蜂','蜗牛','蘑菇'],
    R: ['火焰','冰霜','雷电','风暴','陨石','极光','火山','闪电'],
    SR: ['凤凰','麒麟','白龙','金乌','鲲鹏','玄武','青龙','饕餮'],
    SSR: ['混沌','创世','虚空','时空','命运','轮回','星辰','世界'],
    UR: ['创世之神','宇宙之心','永恒之光','无限之源','命运编织者']
  };

  function renderAvatarPicker() {
    const grid = document.getElementById('avatar-grid');
    if (!grid) return;
    grid.innerHTML = '';
    AVATARS.forEach(function(avatar, index) {
      const el = document.createElement('div');
      el.className = 'avatar-option' + (index === 0 ? ' selected' : '');
      el.textContent = avatar;
      el.onclick = function() {
        appState.selectedAvatar = avatar;
        grid.querySelectorAll('.avatar-option').forEach(function(option) {
          option.classList.remove('selected');
        });
        el.classList.add('selected');
      };
      grid.appendChild(el);
    });
  }

  function restoreSession() {
    const userId = localStorage.getItem(SESSION_USER_ID_KEY);
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
    updateHome();
    showToast(message);
  }

  function login() {
    const nameInput = document.getElementById('login-name');
    const name = nameInput.value.trim();
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
    const userId = requireUserId();
    document.getElementById('home-avatar').textContent = appState.user.avatar || '😀';
    document.getElementById('home-name').textContent = appState.user.name;
    document.getElementById('home-id').textContent = userId;

    AssetLayer.listCards(userId).then(function(res) {
      document.getElementById('stat-collection').textContent = (res.data || []).length;
    }).catch(function() {
      document.getElementById('stat-collection').textContent = '0';
    });

    SocialLayer.listFriends(userId).then(function(res) {
      document.getElementById('stat-friends').textContent = (res.data || []).length;
    }).catch(function() {
      document.getElementById('stat-friends').textContent = '0';
    });

    AssetLayer.recentCards(userId).then(function(res) {
      const container = document.getElementById('home-recent-cards');
      container.innerHTML = '';
      if (!res.data || !res.data.length) {
        container.innerHTML = '<div class="empty-state">还没有收藏，去抽卡吧！</div>';
        return;
      }
      res.data.forEach(function(card) {
        container.appendChild(createCardItem(card));
      });
    }).catch(function() {
      document.getElementById('home-recent-cards').innerHTML = '<div class="empty-state">加载失败</div>';
    });
  }

  function createCardItem(card) {
    const el = document.createElement('div');
    el.className = 'card-item';
    el.innerHTML = '<div class="card-rarity rarity-' + card.rarity + '">' + card.rarity + '</div><span class="card-name">' + (card.name || '') + '</span><span class="card-time">' + formatDate(card.created_at) + '</span>';
    return el;
  }

  function addFriend() {
    let userId;
    try {
      userId = requireUserId();
    } catch (err) {
      showToast(err.message);
      return;
    }
    const input = document.getElementById('friend-id-input');
    const friendId = input.value.trim().toUpperCase();
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
    const userId = requireUserId();
    SocialLayer.listFriends(userId).then(function(res) {
      const container = document.getElementById('friends-list');
      container.innerHTML = '';
      if (!res.data || !res.data.length) {
        container.innerHTML = '<div class="empty-state"><p>还没有好友，去添加吧！</p></div>';
        return;
      }
      const friendIds = res.data.map(function(friend) { return friend.friend_id; });
      sb(supabase.from('users').select('*').in('id', friendIds)).then(function(userRes) {
        const users = userRes.data || [];
        res.data.forEach(function(friend) {
          const friendUser = users.find(function(user) { return user.id === friend.friend_id; });
          if (!friendUser) return;
          const el = document.createElement('div');
          el.className = 'friend-item';
          el.innerHTML = '<div class="friend-avatar">' + (friendUser.avatar || '😀') + '</div><div class="friend-info"><div class="friend-name">' + friendUser.name + '</div><div class="friend-id-display">ID: ' + friendUser.id + '</div></div><button class="btn-remove btn-danger btn-small">删除</button>';
          el.querySelector('.btn-remove').onclick = function() {
            SocialLayer.removeFriend(userId, friend.friend_id).then(function() {
              showToast('已删除好友');
              loadFriends();
            });
          };
          container.appendChild(el);
        });
      });
    }).catch(function() {
      showToast('加载好友失败');
    });
  }

  function drawCard() {
    let total = 0;
    RARITY_POOL.forEach(function(item) { total += item.weight; });
    let rand = Math.floor(Math.random() * total);
    for (let i = 0; i < RARITY_POOL.length; i += 1) {
      rand -= RARITY_POOL[i].weight;
      if (rand < 0) {
        const rarity = RARITY_POOL[i].rarity;
        return {
          name: CARD_NAMES[rarity][Math.floor(Math.random() * CARD_NAMES[rarity].length)],
          rarity: rarity
        };
      }
    }
    return { name: CARD_NAMES.N[0], rarity: 'N' };
  }

  function renderGachaUI(remaining) {
    const remain = Number(remaining || 0);
    const label = document.getElementById('gacha-remain');
    const button = document.getElementById('btn-gacha');
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
    UserCore.getGachaRemaining(requireUserId()).then(renderGachaUI).catch(function(err) {
      console.error('加载抽卡次数失败:', err);
      renderGachaUI(0);
      showToast('加载次数失败');
    });
  }

  function runGacha() {
    if (appState.isDrawing) return;
    let userId;
    try {
      userId = requireUserId();
    } catch (err) {
      showToast(err.message);
      return;
    }

    UserCore.getGachaRemaining(userId).then(function(remaining) {
      if (remaining <= 0) {
        showToast('次数已耗尽');
        renderGachaUI(0);
        return;
      }

      const nextRemaining = Math.max(0, remaining - 1);
      const resultEl = document.getElementById('gacha-result');
      const card = drawCard();
      let cardSaved = false;
      appState.isDrawing = true;

      resultEl.classList.add('flipped');
      resultEl.innerHTML = '<span class="placeholder">抽卡中...</span>';

      setTimeout(function() {
        resultEl.innerHTML = '<div class="result-details"><div class="card-rarity rarity-' + card.rarity + '" style="width:50px;height:50px;font-size:16px;border-radius:12px;margin-bottom:10px;">' + card.rarity + '</div><div class="result-name">' + card.name + '</div><div class="result-rarity rarity-' + card.rarity + '" style="padding:4px 12px;border-radius:8px;">' + card.rarity + ' 稀有</div></div>';
        AssetLayer.createCard(userId, card).then(function() {
          cardSaved = true;
          return UserCore.setGachaRemaining(userId, nextRemaining);
        }).then(function(savedRemaining) {
          renderGachaUI(savedRemaining);
          showToast('获得 ' + card.rarity + ': ' + card.name);
          updateHome();
        }).catch(function(err) {
          console.error('抽卡保存失败:', err);
          loadGachaRemain();
          if (isMissingUserError(err)) {
            handleMissingUserSession();
            return;
          }
          if (cardSaved) {
            updateHome();
            showToast('卡牌已保存，但次数扣减失败: ' + getErrorMessage(err));
          } else {
            showToast('保存失败: ' + getErrorMessage(err));
          }
        }).finally(function() {
          appState.isDrawing = false;
        });
      }, 800);
    }).catch(function(err) {
      console.error('抽卡失败:', err);
      showToast('抽卡失败: ' + getErrorMessage(err));
    });
  }

  function loadCollection() {
    if (!appState.user) return;
    const userId = requireUserId();
    AssetLayer.listCards(userId).then(function(res) {
      const container = document.getElementById('collection-list');
      container.innerHTML = '';
      if (!res.data || !res.data.length) {
        container.innerHTML = '<div class="empty-state">还没有收藏，去抽卡吧！</div>';
        return;
      }
      const rarityOrder = { UR: 0, SSR: 1, SR: 2, R: 3, N: 4 };
      res.data.slice().sort(function(a, b) {
        return (rarityOrder[a.rarity] || 5) - (rarityOrder[b.rarity] || 5);
      }).forEach(function(card) {
        const item = createCardItem(card);
        const del = document.createElement('button');
        del.className = 'card-delete';
        del.textContent = '✕';
        del.title = '删除';
        del.onclick = function() {
          if (!confirm('确定删除 ' + card.name + ' ?')) return;
          AssetLayer.deleteCard(userId, card.id).then(function() {
            showToast('已删除');
            loadCollection();
            updateHome();
          });
        };
        item.appendChild(del);
        container.appendChild(item);
      });
    }).catch(function() {
      showToast('加载收藏失败');
    });
  }

  function renderMessages(messages) {
    const container = document.getElementById('messages');
    container.innerHTML = '';
    if (!messages.length) {
      container.innerHTML = '<div class="empty-state">还没有留言</div>';
      return;
    }
    messages.forEach(function(message) {
      const row = document.createElement('div');
      row.className = 'msg-row';
      const span = document.createElement('span');
      span.className = 'msg-content';
      const sender = '<span class="msg-sender">' + (appState.user.avatar || '😀') + ' ' + appState.user.name + '</span> ';
      span.innerHTML = sender + (message.type === 'mood' ? '今天的心情：' + message.content : message.content) + '  [' + formatDate(message.created_at) + ']';
      row.appendChild(span);
      const button = document.createElement('button');
      button.className = 'delete-btn';
      button.title = '删除';
      button.textContent = '🗑️';
      button.onclick = function() { deleteMessage(message.id); };
      row.appendChild(button);
      container.appendChild(row);
    });
  }

  function loadMessages() {
    if (!appState.user) return;
    const userId = requireUserId();
    SocialLayer.listMessages(userId).then(function(res) {
      renderMessages(res.data || []);
    }).catch(function() {
      showToast('加载留言失败');
    });
  }

  function sendMessage() {
    let userId;
    try {
      userId = requireUserId();
    } catch (err) {
      showToast(err.message);
      return;
    }
    const input = document.getElementById('userInput');
    const text = input.value.trim();
    if (!text) return;
    SocialLayer.createMessage(userId, 'text', text).then(function() {
      input.value = '';
      loadMessages();
    }).catch(function(err) {
      console.error('发送留言失败:', err);
      showToast('发送失败');
    });
  }

  function sendMood(mood) {
    let userId;
    try {
      userId = requireUserId();
    } catch (err) {
      showToast(err.message);
      return;
    }
    SocialLayer.createMessage(userId, 'mood', mood).then(loadMessages).catch(function() {
      showToast('发送失败');
    });
  }

  function deleteMessage(id) {
    if (!appState.user) return;
    SocialLayer.deleteMessage(requireUserId(), id).then(loadMessages).catch(function() {});
  }

  function bindEvents() {
    document.getElementById('btn-login').onclick = login;
    document.getElementById('login-name').onkeypress = function(e) {
      if (e.key === 'Enter') login();
    };
    document.getElementById('btn-add-friend').onclick = addFriend;
    document.getElementById('friend-id-input').onkeypress = function(e) {
      if (e.key === 'Enter') addFriend();
    };
    document.getElementById('btn-gacha').onclick = runGacha;
    document.getElementById('myBtn').onclick = function() {
      document.getElementById('myBtn').style.display = 'none';
      document.getElementById('inputArea').style.display = 'flex';
      document.getElementById('moodArea').style.display = 'flex';
      loadMessages();
    };
    document.getElementById('sendBtn').onclick = sendMessage;
    document.getElementById('userInput').onkeypress = function(e) {
      if (e.key === 'Enter') sendMessage();
    };
    document.querySelectorAll('.mood-btn').forEach(function(button) {
      button.onclick = function() {
        sendMood(button.getAttribute('data-mood'));
      };
    });
    document.querySelectorAll('.nav-item').forEach(function(button) {
      button.onclick = function() {
        const page = button.getAttribute('data-page');
        showPage(page);
        if (page === 'home') updateHome();
        if (page === 'friends') loadFriends();
        if (page === 'collection') loadCollection();
        if (page === 'gacha') loadGachaRemain();
        if (page === 'message') loadMessages();
      };
    });

  }

  function init() {
    hideLoading();
    renderAvatarPicker();
    bindEvents();
    restoreSession().then(function(user) {
      if (user) enterApp(user, '欢迎回来，' + user.name);
      else showLoginPage();
    });
  }

  init();
})();
