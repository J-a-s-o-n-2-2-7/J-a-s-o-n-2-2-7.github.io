// ================================================================
// 文件名：topbar.js
// 说明：自包含的顶部栏组件，依赖 Supabase 认证
// 用法：Topbar.init('#容器选择器')
// ================================================================

(function (global) {
    'use strict';

    // ---------- 配置（请按需修改） ----------
    const CONFIG = {
        SUPABASE_URL: 'https://nosikdfacxkuaxfrmoqn.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_oKXNXCWRhkho-OQPXE9LwA_74bqI5h-',
        // 如果您的网站域名不是根路径，请修改此处（例如 '/myapp/'）
        BASE_PATH: '/'
    };

    // ---------- 初始化 Supabase 客户端 ----------
    if (!global._supabaseClient) {
        global._supabaseClient = global.supabase.createClient(
            CONFIG.SUPABASE_URL,
            CONFIG.SUPABASE_ANON_KEY
        );
    }
    const supabase = global._supabaseClient;

    // ---------- 辅助函数 ----------
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/[&<>"]/g, function (m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            return m;
        });
    }

    function escapeHtmlAttr(str) {
        if (!str) return '';
        return str.replace(/[&<>"]/g, function (m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            if (m === '"') return '&quot;';
            return m;
        });
    }

    function letterAvatar(name) {
        const ch = (name || 'U').trim().charAt(0).toUpperCase() || 'U';
        return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='%23e74c3c'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='white' font-size='16' font-family='Arial'%3E" + encodeURIComponent(ch) + "%3C/text%3E%3C/svg%3E";
    }

    // ---------- 样式注入（仅一次） ----------
    function injectStyles() {
        if (document.getElementById('topbar-component-style')) return;
        const style = document.createElement('style');
        style.id = 'topbar-component-style';
        style.textContent = `
            /* 顶部栏基础样式 */
            .topbar-component {
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: white;
                padding: 12px 24px;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
                position: sticky;
                top: 0;
                z-index: 200;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
            }
            .topbar-component .logo {
                font-size: 1.5rem;
                font-weight: 700;
                color: #e74c3c;
                text-decoration: none;
            }
            .topbar-component .auth-buttons {
                display: flex;
                gap: 16px;
                align-items: center;
            }
            .topbar-component .auth-btn {
                background: #e74c3c;
                color: white;
                border: none;
                border-radius: 30px;
                padding: 6px 20px;
                font-size: 14px;
                cursor: pointer;
                text-decoration: none;
                display: inline-block;
                transition: background 0.2s;
            }
            .topbar-component .auth-btn:hover {
                background: #c0392b;
                text-decoration: none;
            }
            .topbar-component .auth-btn.logout {
                background: #7f8c8d;
            }
            .topbar-component .auth-btn.logout:hover {
                background: #5a6a6a;
            }
            .topbar-component .user-email {
                font-size: 14px;
                color: #2c3e50;
                text-decoration: none;
            }
            .topbar-component .user-email:hover {
                text-decoration: underline;
            }
            .topbar-component .bell-icon {
                position: relative;
                display: inline-flex;
                align-items: center;
                text-decoration: none;
                color: #666;
                transition: color 0.2s;
            }
            .topbar-component .bell-icon:hover {
                color: #e74c3c;
            }
            .topbar-component .bell-icon svg {
                width: 20px;
                height: 20px;
            }
            .topbar-component .bell-icon sup {
                position: absolute;
                top: -8px;
                right: -12px;
                background-color: #e74c3c;
                color: white;
                font-size: 10px;
                font-weight: bold;
                min-width: 16px;
                height: 16px;
                border-radius: 20px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 0 4px;
                box-shadow: 0 0 2px rgba(0, 0, 0, 0.2);
                line-height: 1;
            }
            /* 头像下拉菜单 */
            .topbar-component .top-avatar-wrap {
                position: relative;
                display: inline-flex;
                align-items: center;
            }
            .topbar-component .top-avatar-menu {
                position: absolute;
                top: 100%;
                right: 0;
                min-width: 104px;
                background: #fff;
                border: 1px solid #eee;
                border-radius: 8px;
                box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
                padding: 6px;
                display: none;
                z-index: 300;
            }
            .topbar-component .top-avatar-wrap:hover .top-avatar-menu {
                display: block;
            }
            .topbar-component .top-avatar-menu .auth-btn.logout {
                display: block;
                width: 100%;
                text-align: center;
                border-radius: 6px;
                padding: 8px 0;
                box-sizing: border-box;
            }
            .topbar-component .top-avatar-menu .top-avatar-menu-link {
                display: block;
                padding: 6px 12px;
                color: #2c3e50;
                font-size: 13px;
                text-decoration: none;
                border-radius: 4px;
                transition: background 0.15s;
            }
            .topbar-component .top-avatar-menu .top-avatar-menu-link:hover {
                background: #f0f2f5;
                text-decoration: none;
            }
            .topbar-component .avatar-img {
                width: 30px;
                height: 30px;
                border-radius: 50%;
                object-fit: cover;
                display: block;
                cursor: pointer;
                flex-shrink: 0;
            }
            .topbar-component .admin-gear {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                margin-left: 8px;
                color: #666;
                text-decoration: none;
                font-size: 18px;
                cursor: pointer;
                transition: color 0.2s;
            }
            .topbar-component .admin-gear:hover {
                color: #e74c3c;
            }
            @media (max-width: 600px) {
                .topbar-component {
                    padding: 10px 16px;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .topbar-component .logo {
                    font-size: 1.2rem;
                }
                .topbar-component .auth-btn {
                    padding: 4px 14px;
                    font-size: 12px;
                }
                .topbar-component .user-email {
                    font-size: 12px;
                }
            }
            @media (max-width: 400px) {
                .topbar-component .auth-btn {
                    padding: 4px 10px;
                    font-size: 11px;
                }
                .topbar-component .user-email {
                    font-size: 11px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ---------- 核心逻辑 ----------
    let currentProfile = null;
    let currentUser = null;
    let unreadTimer = null;
    let containerElement = null;
    let authButtonsContainer = null;

    // 获取用户资料
    async function getProfile(userId) {
        const { data, error } = await supabase
            .from('profiles')
            .select('user_number, username, is_admin, can_speak, can_manage_users, can_manage_posts, is_cheater, user_tag, avatar_url, username_color')
            .eq('id', userId)
            .single();
        if (error) return null;
        return data;
    }

    // 获取未读通知数
    async function fetchUnreadCount() {
        if (!currentProfile) return;
        try {
            const { count, error } = await supabase.from('notifications').select('*', { count: 'exact', head: true })
                .eq('user_number', currentProfile.user_number).eq('read', false);
            if (!error && count !== null) {
                const badge = document.getElementById('bell-badge');
                if (badge) {
                    if (count > 0) {
                        badge.textContent = count > 99 ? '99+' : count;
                        badge.style.display = 'inline-flex';
                    } else {
                        badge.style.display = 'none';
                    }
                }
            }
        } catch (err) {
            console.error('[Topbar] 获取通知失败:', err);
        }
    }

    // 轮询通知
    function startUnreadPolling() {
        if (unreadTimer) clearInterval(unreadTimer);
        unreadTimer = setInterval(() => {
            if (currentProfile && document.visibilityState === 'visible') fetchUnreadCount();
        }, 30000);
    }
    function stopUnreadPolling() {
        if (unreadTimer) { clearInterval(unreadTimer); unreadTimer = null; }
    }

    // 渲染顶部栏
    async function renderTopbar() {
        if (!containerElement) return;

        try {
            const { data: { session } } = await supabase.auth.getSession();

            // 构造基础 HTML 结构（如果没有）
            if (!containerElement.querySelector('.topbar-component')) {
                containerElement.innerHTML = `
                    <div class="topbar-component">
                        <a href="${CONFIG.BASE_PATH}" class="logo">✨ Jason227</a>
                        <div class="auth-buttons" id="topbarAuthButtons">
                            <span style="font-size:14px; color:#aaa;">加载中...</span>
                        </div>
                    </div>
                `;
            }

            const authBtns = document.getElementById('topbarAuthButtons');
            if (!authBtns) return;

            if (session) {
                currentProfile = await getProfile(session.user.id);
                currentUser = session.user;

                // 检查是否被封禁
                if (currentProfile) {
                    const { data: banData, error: banErr } = await supabase
                        .from('profiles')
                        .select('is_banned')
                        .eq('id', session.user.id)
                        .single();
                    if (!banErr && banData && banData.is_banned === true) {
                        await supabase.auth.signOut();
                        location.reload();
                        return;
                    }
                }

                let displayName = currentProfile?.username || session.user.email || '用户';
                let html = '';

                // 头像区域（含下拉菜单）
                const avatarUrl = currentProfile?.avatar_url || letterAvatar(displayName);
                const userNumber = currentProfile?.user_number || '';
                html += `
                    <div class="top-avatar-wrap">
                        <a href="${CONFIG.BASE_PATH}user/${userNumber}" title="${escapeHtmlAttr(displayName)}">
                            <img src="${escapeHtmlAttr(avatarUrl)}" alt="头像" class="avatar-img" onerror="this.onerror=null;this.src='${letterAvatar(displayName)}'">
                        </a>
                        <div class="top-avatar-menu">
                            <a href="${CONFIG.BASE_PATH}user/${userNumber}" class="top-avatar-menu-link">👤 个人主页</a>
                            <button id="logoutBtnTopbar" class="auth-btn logout">登出</button>
                        </div>
                    </div>
                `;

                // 通知铃铛
                html += `
                    <a href="${CONFIG.BASE_PATH}user/notification" class="bell-icon" style="color:#666;">
                        <svg viewBox="0 0 448 512" width="20" height="20">
                            <path fill="currentColor" d="M224 0c-13.3 0-24 10.7-24 24l0 9.7C118.6 45.3 56 115.4 56 200l0 14.5c0 37.7-10 74.7-29 107.3L5.1 359.2C1.8 365 0 371.5 0 378.2 0 399.1 16.9 416 37.8 416l372.4 0c20.9 0 37.8-16.9 37.8-37.8 0-6.7-1.8-13.3-5.1-19L421 321.7c-19-32.6-29-69.6-29-107.3l0-14.5c0-84.6-62.6-154.7-144-166.3l0-9.7c0-13.3-10.7-24-24-24zM392.4 368l-336.9 0 12.9-22.1C91.7 306 104 260.6 104 214.5l0-14.5c0-66.3 53.7-120 120-120s120 53.7 120 120l0 14.5c0 46.2 12.3 91.5 35.5 131.4L392.4 368zM156.1 464c9.9 28 36.6 48 67.9 48s58-20 67.9-48l-135.8 0z"></path>
                        </svg>
                        <sup id="bell-badge" style="display:none;">0</sup>
                    </a>
                `;

                // 管理员入口
                if (currentProfile?.is_admin === true) {
                    html += `
                        <a href="${CONFIG.BASE_PATH}admin/user" title="进入管理后台" class="admin-gear">⚙️</a>
                    `;
                }

                authBtns.innerHTML = html;

                // 绑定登出事件
                document.getElementById('logoutBtnTopbar')?.addEventListener('click', async () => {
                    await supabase.auth.signOut();
                    location.reload();
                });

                // 获取未读通知并开始轮询
                await fetchUnreadCount();
                startUnreadPolling();

            } else {
                // 未登录状态
                currentProfile = null;
                currentUser = null;
                stopUnreadPolling();
                authBtns.innerHTML = `
                    <a href="${CONFIG.BASE_PATH}auth/login" class="auth-btn">登录</a>
                    <a href="${CONFIG.BASE_PATH}auth/register" class="auth-btn">注册</a>
                `;
            }
        } catch (err) {
            console.error('[Topbar] 渲染失败:', err);
            const authBtns = document.getElementById('topbarAuthButtons');
            if (authBtns) {
                authBtns.innerHTML = `
                    <a href="${CONFIG.BASE_PATH}auth/login" class="auth-btn">登录</a>
                    <a href="${CONFIG.BASE_PATH}auth/register" class="auth-btn">注册</a>
                `;
            }
        }
    }

    // ---------- 对外暴露 API ----------
    const Topbar = {
        // 初始化方法：传入容器选择器（如 '#topbar' 或 '.header'）
        init: function (selector) {
            const el = document.querySelector(selector);
            if (!el) {
                console.error('[Topbar] 未找到容器:', selector);
                return;
            }
            containerElement = el;
            injectStyles();
            renderTopbar();

            // 监听认证状态变化（如登录/登出）
            supabase.auth.onAuthStateChange((event, session) => {
                // 延迟一下确保状态已更新
                setTimeout(() => {
                    renderTopbar();
                }, 100);
            });

            // 页面可见性变化时刷新通知
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && currentProfile) {
                    fetchUnreadCount();
                }
            });

            console.log('[Topbar] 初始化成功');
        },
        // 手动刷新顶部栏（例如外部登录后调用）
        refresh: function () {
            renderTopbar();
        }
    };

    // 暴露到全局
    global.Topbar = Topbar;

})(window);