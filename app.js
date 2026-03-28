/**
 * app.js - Main Application Logic
 * Manages UI state, rendering, and interactions.
 */

import { YouTubeService } from './youtube.js';

class App {
    constructor() {
        this.service = new YouTubeService();
        this.currentChannel = null;
        this.currentChannelId = null;
        this.channels = [];
        this.init();
    }

    async init() {
        // Initialize Lucide icons
        if (window.lucide) {
            window.lucide.createIcons();
        }

        // Setup Event Listeners
        this.setupEventListeners();
        this.setupMobileNav();
        this.setupSwipe();

        // Load initial data
        await this.loadChannels();
    }

    setupEventListeners() {
        // Auth Button
        const authBtn = document.getElementById('auth-btn');
        if (authBtn) {
            authBtn.addEventListener('click', async () => {
                if (!this.service.clientId || this.service.clientId.includes('YOUR_CLIENT_ID')) {
                    const id = prompt('Google Cloud Consoleで取得した「クライアントID」を入力してください：');
                    if (id) this.service.setClientId(id);
                    else return;
                }
                try {
                    await this.service.addAccount();
                } catch (e) {
                    alert('認証に失敗しました。詳細：' + e);
                }
            });
        }

        // Auth state change
        this.service.onAuthChange = (isAuth) => {
            this.updateAuthUI(isAuth);
            this.loadChannels();
        };

        // Reset Button
        const resetBtn = document.getElementById('reset-settings-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (confirm('保存されているすべてのアカウント設定をリセットしますか？')) {
                    this.service.logout();
                    localStorage.removeItem('yt_client_id');
                    alert('リセットしました。');
                    location.reload();
                }
            });
        }

        // Refresh Button
        document.getElementById('refresh-btn')?.addEventListener('click', () => {
            if (this.currentChannelId) this.selectChannel(this.currentChannelId, this.currentChannel.token);
        });

        // Modal Controls
        document.getElementById('modal-cancel-btn')?.addEventListener('click', () => this.hideModal());
        document.getElementById('modal-save-btn')?.addEventListener('click', () => this.saveScheduledTime());
        document.getElementById('modal-publish-btn')?.addEventListener('click', async () => {
            const modal = document.getElementById('upload-edit-modal');
            const videoId = modal.getAttribute('data-target-id');
            if (videoId && this.currentChannel && confirm('この動画を今すぐ公開しますか？')) {
                const success = await this.service.publishNow(videoId, this.currentChannel.token);
                if (success) {
                    this.hideModal();
                    this.updateScheduled(this.currentChannelId, this.currentChannel.token);
                } else {
                    alert('公開に失敗しました。');
                }
            }
        });
    }

    setupMobileNav() {
        const title = document.getElementById('current-channel-name');
        const overlay = document.getElementById('mobile-nav-overlay');
        
        if (title && overlay) {
            title.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    overlay.style.display = 'block';
                }
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) overlay.style.display = 'none';
            });
        }
    }

    setupSwipe() {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;

        document.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            this.handleSwipe(touchStartX, touchStartY, touchEndX, touchEndY);
        }, { passive: true });
    }

    handleSwipe(startX, startY, endX, endY) {
        const thresholdX = 50;
        const thresholdY = 80;
        
        const diffX = endX - startX;
        const diffY = endY - startY;

        if (Math.abs(diffX) > thresholdX && Math.abs(diffY) < thresholdY) {
            if (this.channels.length <= 1) return;
            const currentIndex = this.channels.findIndex(c => c.id === this.currentChannelId);
            if (currentIndex === -1) return;

            if (diffX < 0) {
                // Swipe Left -> Next
                const nextIndex = (currentIndex + 1) % this.channels.length;
                this.selectChannel(this.channels[nextIndex].id, this.channels[nextIndex].token, 'next');
            } else {
                // Swipe Right -> Previous
                const prevIndex = (currentIndex - 1 + this.channels.length) % this.channels.length;
                this.selectChannel(this.channels[prevIndex].id, this.channels[prevIndex].token, 'prev');
            }
        }
    }

    async loadChannels() {
        this.channels = await this.service.getChannels();
        
        if (this.channels.length > 0) {
            const lastId = localStorage.getItem('yt_current_channel_id');
            const preserved = lastId ? this.channels.find(c => c.id === lastId) : null;
            const target = preserved || this.channels[0];
            this.selectChannel(target.id, target.token);
        }
        this.renderChannelNav(this.channels);
    }

    renderChannelNav(channels) {
        // UI fail-safe: deduplicate by ID again before rendering
        const uniqueChannels = [];
        const seenIds = new Set();
        for (const c of channels) {
            if (!seenIds.has(c.id)) {
                seenIds.add(c.id);
                uniqueChannels.push(c);
            }
        }
        channels = uniqueChannels;

        const nav = document.getElementById('channel-nav');
        const mobileNavList = document.getElementById('mobile-nav-list');
        
        if (channels.length === 0 || (channels.length === 1 && channels[0].id === 'UC-EMPTY')) {
            const emptyHtml = `<div class="nav-item disabled" style="opacity:0.6; pointer-events:none;">
                <i data-lucide="alert-circle"></i>
                <span>チャンネル未作成</span>
            </div>`;
            if (nav) nav.innerHTML = emptyHtml;
            if (mobileNavList) mobileNavList.innerHTML = emptyHtml;
            
            // Show alert for first-time or failed logins
            if (this.channels.length > 0 && channels[0].id === 'UC-EMPTY') {
                alert('YouTubeチャンネルが見つかりませんでした。\n・正しいGoogleアカウントを選んでいるか\n・そのアカウントでYouTubeチャンネルを作成済みか\nを確認してください。');
            }
        } else {
            const navHtml = channels.map(channel => `
                <div class="nav-item ${channel.id === this.currentChannelId ? 'active' : ''}" data-id="${channel.id}" data-token="${channel.token}">
                    <i data-lucide="play-circle"></i>
                    <span>${channel.name}</span>
                </div>
            `).join('');

            if (nav) nav.innerHTML = navHtml;
            if (mobileNavList) mobileNavList.innerHTML = navHtml;
        }

        document.querySelectorAll('.nav-item').forEach(item => {
            if (item.classList.contains('disabled')) return;
            item.addEventListener('click', () => {
                const id = item.getAttribute('data-id');
                const token = item.getAttribute('data-token');
                this.selectChannel(id, token, 'next');
                const overlay = document.getElementById('mobile-nav-overlay');
                if (overlay) overlay.style.display = 'none';
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    async selectChannel(id, token, direction = null) {
        this.currentChannel = this.channels.find(c => c.id === id);
        this.currentChannelId = id;
        if (!this.currentChannel) return;

        localStorage.setItem('yt_current_channel_id', id);
        this.renderChannelNav(this.channels);

        const header = document.getElementById('current-channel-name');
        if (header) header.textContent = this.currentChannel.name;

        // Apply animation on mobile
        const main = document.querySelector('.main-content');
        if (main && window.innerWidth <= 768 && direction) {
            main.classList.remove('slide-in-right', 'slide-in-left');
            void main.offsetWidth; // Force reflow
            main.classList.add(direction === 'next' ? 'slide-in-right' : 'slide-in-left');
        }

        await Promise.all([
            this.updateStats(id, token),
            this.updateVideos(id, token),
            this.updateScheduled(id, token)
        ]);
    }

    async updateStats(channelId, token) {
        const stats = await this.service.getChannelStats(channelId, token);
        const subCountEl = document.getElementById('subscriber-count');
        if (subCountEl) {
            const currentVal = parseInt(subCountEl.textContent.replace(/,/g, '')) || 0;
            this.animateValue(subCountEl, currentVal, stats.subscriberCount, 1000);
        }
    }

    async updateVideos(channelId, token) {
        let videos = await this.service.getLatestVideos(channelId, token);
        const videoIds = videos.map(v => v.id).join(',');
        
        const analytics = await this.service.getAnalyticsForVideos(channelId, token, videoIds);
        
        const body = document.getElementById('video-performance-body');
        if (!body) return;

        body.innerHTML = videos.map(video => {
            const data = analytics[video.id] || { retention: 0 };
            const engagement = video.views > 0 ? (((video.likes + video.comments) / video.views) * 100).toFixed(2) : "0.00";
            const pubDate = new Date(video.publishedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            
            return `
                <tr>
                    <td class="video-title" title="${video.title}">${video.title}</td>
                    <td style="font-size: 0.75rem; color: var(--text-secondary);">${pubDate}</td>
                    <td>${video.views.toLocaleString()}</td>
                    <td>${video.likes.toLocaleString()}</td>
                    <td>${video.comments.toLocaleString()}</td>
                    <td><span class="rate-badge">${engagement}%</span></td>
                    <td><span class="rate-badge" style="background: rgba(255, 255, 255, 0.1); color: var(--text-secondary); border-color: rgba(255, 255, 255, 0.2);">${data.retention.toFixed(1)}%</span></td>
                </tr>
            `;
        }).join('');
    }

    async updateScheduled(channelId, token) {
        const scheduled = await this.service.getScheduledUploads(channelId, token);
        const list = document.getElementById('scheduled-uploads-list');
        if (!list) return;

        if (scheduled.length === 0) {
            list.innerHTML = '<p class="empty-msg">予約中の動画はありません</p>';
            return;
        }

        list.innerHTML = scheduled.map(video => `
            <div class="upload-item">
                <div class="upload-info">
                    <div class="video-title">${video.title}</div>
                    <div class="upload-time">
                        <i data-lucide="clock" style="width:12px; height:12px;"></i>
                        ${new Date(video.scheduledTime).toLocaleString()}
                    </div>
                </div>
                <button class="icon-btn btn-edit" data-id="${video.id}" data-time="${video.scheduledTime}">
                    <i data-lucide="edit-3"></i>
                </button>
            </div>
        `).join('');

        list.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                this.showModal(btn.getAttribute('data-id'), btn.getAttribute('data-time'));
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    showModal(videoId, currentTime) {
        const modal = document.getElementById('upload-edit-modal');
        const input = document.getElementById('publish-date');
        if (modal && input) {
            input.value = currentTime.substring(0, 16);
            modal.style.display = 'flex';
            modal.setAttribute('data-target-id', videoId);
        }
    }

    hideModal() {
        const modal = document.getElementById('upload-edit-modal');
        if (modal) modal.style.display = 'none';
    }

    async saveScheduledTime() {
        const modal = document.getElementById('upload-edit-modal');
        const input = document.getElementById('publish-date');
        const videoId = modal.getAttribute('data-target-id');
        
        if (videoId && input.value && this.currentChannel) {
            await this.service.updateScheduledTime(videoId, this.currentChannel.token, input.value);
            this.hideModal();
            this.updateScheduled(this.currentChannelId, this.currentChannel.token);
        }
    }

    updateAuthUI(isAuth) {
        const authBtn = document.getElementById('auth-btn');
        const authStatus = document.getElementById('auth-status');
        if (authBtn) {
            authBtn.textContent = isAuth ? 'アカウントを追加' : 'ログイン';
        }
        if (authStatus) {
            authStatus.textContent = isAuth ? '認証済み' : '未接続';
            authStatus.className = isAuth ? 'auth-status authenticated' : 'auth-status';
        }
    }

    animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            const value = Math.floor(progress * (end - start) + start);
            obj.innerHTML = value.toLocaleString();
            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };
        window.requestAnimationFrame(step);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
