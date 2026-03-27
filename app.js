/**
 * app.js - Main Application Logic
 * Manages UI state, rendering, and interactions.
 */

import { YouTubeService } from './youtube.js';

class App {
    constructor() {
        this.service = new YouTubeService();
        this.currentChannel = null;
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

        // Load initial data
        await this.loadChannels();
    }

    setupEventListeners() {
        // Auth Button (Add/Switch Account)
        const authBtn = document.getElementById('auth-btn');
        if (authBtn) {
            authBtn.addEventListener('click', async () => {
                // Prompt for Client ID if missing
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
            if (this.currentChannel) this.selectChannel(this.currentChannel.id);
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
                    this.updateScheduled(this.currentChannel.id, this.currentChannel.token);
                } else {
                    alert('公開に失敗しました。');
                }
            }
        });
    }

    async loadChannels() {
        this.channels = await this.service.getChannels();
        
        // Auto-select first channel or keep current
        if (this.channels.length > 0) {
            const preserved = this.currentChannel ? this.channels.find(c => c.id === this.currentChannel.id) : null;
            this.selectChannel(preserved ? preserved.id : this.channels[0].id, preserved ? preserved.token : this.channels[0].token); // Updated
        }
        this.renderChannelNav(this.channels); // Updated
    }

    setupMobileNav() {
        const title = document.getElementById('current-channel-name');
        const overlay = document.getElementById('mobile-nav-overlay');
        
        if (title && overlay) { // Added null checks
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

    renderChannelNav(channels) { // Updated signature
        const nav = document.getElementById('channel-nav');
        const mobileNavList = document.getElementById('mobile-nav-list'); // Added
        
        const navHtml = channels.map(channel => `
            <div class="nav-item ${channel.id === this.currentChannelId ? 'active' : ''}" data-id="${channel.id}" data-token="${channel.token}">
                <i data-lucide="monitor"></i> <!-- Changed from play-circle to monitor for consistency -->
                <span>${channel.name}</span>
            </div>
        `).join('');

        if (nav) nav.innerHTML = navHtml; // Added null check
        if (mobileNavList) mobileNavList.innerHTML = navHtml; // Added

        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.getAttribute('data-id');
                const token = item.getAttribute('data-token');
                this.selectChannel(id, token);
                const overlay = document.getElementById('mobile-nav-overlay'); // Added
                if (overlay) overlay.style.display = 'none'; // Added
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    async selectChannel(id, token) { // Updated signature
        this.currentChannel = this.channels.find(c => c.id === id); // Updated
        this.currentChannelId = id; // Added
        if (!this.currentChannel) return;
        
        this.renderChannelNav(this.channels); // Updated

        const header = document.getElementById('current-channel-name');
        if (header) header.textContent = this.currentChannel.name;

        const token = this.currentChannel.token;
        await Promise.all([
            this.updateStats(channelId, token),
            this.updateVideos(channelId, token),
            this.updateScheduled(channelId, token)
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
        
        // Fetch detailed analytics for these videos
        const analytics = await this.service.getAnalyticsForVideos(channelId, token, videoIds);
        
        const body = document.getElementById('video-performance-body');
        if (!body) return;

        body.innerHTML = videos.map(video => {
            const data = analytics[video.id] || { retention: 0, swipeRate: 0 };
            // Calculate immediate engagement rate with more precision (fixed(2))
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

    // Modal Logic
    showModal(videoId, currentTime) {
        const modal = document.getElementById('upload-edit-modal');
        const input = document.getElementById('publish-date');
        if (modal && input) {
            input.value = currentTime.substring(0, 16); // format for datetime-local
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
        
        if (videoId && input.value) {
            await this.service.updateScheduledTime(videoId, input.value);
            this.hideModal();
            if (this.currentChannel) this.updateScheduled(this.currentChannel.id);
        }
    }

    // UI: Update Auth Status
    updateAuthUI(isAuth) {
        const authBtn = document.getElementById('auth-btn');
        const authStatus = document.getElementById('auth-status');
        if (authBtn) {
            authBtn.textContent = isAuth ? 'アカウントを追加' : 'ログイン';
            authBtn.className = 'btn btn-primary btn-sm'; // Keep primary for adding more
        }
        if (authStatus) {
            authStatus.textContent = isAuth ? '認証済み' : '未接続';
            authStatus.className = isAuth ? 'auth-status authenticated' : 'auth-status';
        }
    }

    // Utility: Number animation
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
        // Add Swipe Support for Mobile
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
        const thresholdX = 50; // Use small threshold for better sensitivity
        const thresholdY = 30; // Max vertical movement to count as horizontal swipe
        
        const diffX = endX - startX;
        const diffY = endY - startY;

        if (Math.abs(diffX) > thresholdX && Math.abs(diffY) < thresholdY) {
            if (this.channels.length <= 1) return;
            const currentIndex = this.channels.findIndex(c => c.id === this.currentChannelId);
            if (currentIndex === -1) return;

            if (diffX < 0) {
                // Swipe Left -> Next
                const nextIndex = (currentIndex + 1) % this.channels.length;
                this.selectChannel(this.channels[nextIndex].id, this.channels[nextIndex].token);
            } else {
                // Swipe Right -> Previous
                const prevIndex = (currentIndex - 1 + this.channels.length) % this.channels.length;
                this.selectChannel(this.channels[prevIndex].id, this.channels[prevIndex].token);
            }
        }
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
