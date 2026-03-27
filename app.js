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
        this.renderChannelNav();
        
        // Auto-select first channel or keep current
        if (this.channels.length > 0) {
            const preserved = this.currentChannel ? this.channels.find(c => c.id === this.currentChannel.id) : null;
            this.selectChannel(preserved ? preserved.id : this.channels[0].id);
        }
    }

    renderChannelNav() {
        const nav = document.getElementById('channel-nav');
        if (!nav) return;

        nav.innerHTML = this.channels.map(channel => `
            <div class="nav-item ${this.currentChannel?.id === channel.id ? 'active' : ''}" 
                 data-channel-id="${channel.id}">
                <i data-lucide="monitor"></i>
                <span>${channel.name}</span>
            </div>
        `).join('');

        // Add click events to nav items
        nav.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => {
                this.selectChannel(item.getAttribute('data-channel-id'));
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    async selectChannel(channelId) {
        this.currentChannel = this.channels.find(c => c.id === channelId);
        if (!this.currentChannel) return;
        
        this.renderChannelNav();

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
            // Calculate immediate engagement rate (Likes + Comments) / Views
            const engagement = video.views > 0 ? (((video.likes + video.comments) / video.views) * 100).toFixed(1) : "0.0";
            
            return `
                <tr>
                    <td class="video-title" title="${video.title}">${video.title}</td>
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
    }
}

// Start the app
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
